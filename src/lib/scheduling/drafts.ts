// src/lib/scheduling/drafts.ts
// Scheduling reply DRAFTS (scheduling agent). Ships switched OFF: the cron runs this only when
// org_settings 'hub_sched_agent' has drafts 'on' (src/lib/briefs/config.ts). The superadmin test route runs it
// for one message regardless, and that path also only ever creates a draft.
//
// HARD RULES, all enforced here:
//   - NEVER sends. The only Gmail write is POST /users/me/drafts. Nothing is forwarded or attached.
//   - The draft goes to ONE address: the message's sender (or their same-domain Reply-To), chosen in
//     draft-compose.ts, from the mailbox the message arrived in, in that thread.
//   - Never writes to an nr_* table, never reads nr_calendar_tokens or any University credential
//     (availability-load.ts reads windows, overrides and the busy cache with SELECT only).
//   - Logs and results carry ids, counts and short codes only: never content, subjects, names, emails or tokens.
//
// Per message (category scheduling, status new, draft_status null, received since cfg.since, oldest first):
//   flagged       no draft_only reply rule for the mailbox, sensitive-looking triage, or the sender is one of the
//                 owner's own mailboxes
//   link_drafted  a new prospect (no contact in the org) asking for a one_on_one: the Discovery Call link
//   drafted       2 to 3 open times
//   exception     no open time: an exception request is filed and the owner is texted
//   no_slot       no open time and the exception request could not be filed
//   error         anything failed; draft_note has the short code
import type { SupabaseClient } from '@supabase/supabase-js'
import { accessTokenFor, refreshTokenFor, MailError } from '@/lib/mail/google'
import { readSchedAgentConfig, type SchedAgentConfig } from '@/lib/briefs/config'
import { discoveryBookingUrl } from '@/lib/marketing/checkout-link'
import { sendNotifySms } from '@/lib/notify-sms'
import { businessDays, slotLabel, zonedMs, type SchedCategory } from './availability'
import { AvailabilityError, SCHED_ORG, SCHED_OWNER, SCHED_TZ, findAvailability } from './availability-load'
import {
  buildRfc2822, base64url, chooseRecipient, draftCategory, exceptionSms, firstName, isSensitive, linkText, slotsText,
} from './draft-compose'

export const DRAFTS_PER_RUN = 10
/** A row claimed by a run that died is retried after this long. */
const CLAIM_STALE_MS = 30 * 60_000
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const HUB_ORIGIN = 'https://hub.neuroprogeny.com'
const DRAFT_ID = /^[A-Za-z0-9_-]{1,100}$/

export const MESSAGE_COLUMNS =
  'id, connection_id, gmail_message_id, gmail_thread_id, from_address, from_name, subject, summary, suggested_action, ' +
  'received_at, category, status, draft_status, gmail_draft_id, drafted_at'

export type DraftStatus = 'drafted' | 'link_drafted' | 'flagged' | 'exception' | 'no_slot' | 'error'

export interface DraftOutcome { message_id: string; draft_status: DraftStatus | null; gmail_draft_id: string | null; note: string | null }

/** hub_234 not applied: a column or table PostgREST does not know. */
export function isMissingSchema(error: { code?: string | null } | null | undefined): boolean {
  return !!error && ['PGRST204', 'PGRST205', '42703', '42P01'].includes(String(error.code ?? ''))
}

interface MessageRow {
  id: string
  connection_id: string
  gmail_message_id: string
  gmail_thread_id: string
  from_address: string | null
  from_name: string | null
  subject: string | null
  summary: string | null
  suggested_action: string | null
  received_at: string | null
  category: string | null
  status: string
  draft_status: string | null
  gmail_draft_id: string | null
  drafted_at: string | null
}

interface Mailbox { id: string; email_address: string; owner_user_id: string; status: string }

class DraftError extends Error { constructor(readonly code: string) { super(code) } }
const codeOf = (e: unknown) =>
  e instanceof DraftError || e instanceof AvailabilityError || e instanceof MailError ? (e as any).code as string : 'unknown'
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)

// ─── Gmail: two calls, read headers and create a draft ───────────────────────
async function gmailFetch(token: string, path: string, init?: RequestInit): Promise<{ status: number; data: any }> {
  let res: Response
  try {
    res = await fetch(`${GMAIL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
      cache: 'no-store',
    })
  } catch {
    throw new DraftError('gmail_network')
  }
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

interface ReplyHeaders { messageId: string | null; subject: string | null; from: string | null; replyTo: string | null; threadId: string }

async function replyHeaders(token: string, gmailMessageId: string): Promise<ReplyHeaders> {
  const q = new URLSearchParams({ format: 'metadata' })
  for (const h of ['Message-ID', 'Subject', 'From', 'Reply-To']) q.append('metadataHeaders', h)
  const { status, data } = await gmailFetch(token, `/messages/${encodeURIComponent(gmailMessageId)}?${q}`)
  if (status === 404) throw new DraftError('message_gone')
  if (status !== 200) throw new DraftError(`gmail_get_${status}`)
  const headers: { name?: string; value?: string }[] = data.payload?.headers ?? []
  const h = (n: string) => headers.find((x) => String(x.name ?? '').toLowerCase() === n)?.value ?? null
  return { messageId: h('message-id'), subject: h('subject'), from: h('from'), replyTo: h('reply-to'), threadId: String(data.threadId ?? '') }
}

async function createDraft(token: string, raw: string, threadId: string): Promise<string> {
  const { status, data } = await gmailFetch(token, '/drafts', {
    method: 'POST',
    body: JSON.stringify({ message: { raw: base64url(raw), threadId } }),
  })
  if (status !== 200) throw new DraftError(`gmail_draft_${status}`)
  const id = String(data?.id ?? '')
  if (!DRAFT_ID.test(id)) throw new DraftError('gmail_draft_id')
  return id
}

// ─── the pipeline for one message ────────────────────────────────────────────
interface Ctx { ownAddresses: string[]; now: string }

async function finalize(db: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from('hub_mail_messages').update(patch).eq('id', id)
  if (error) {
    console.error(`[sched-drafts] message ${id} state not saved: ${error.code ?? 'unknown'}`)
    throw new DraftError(`save_${error.code ?? 'unknown'}`)
  }
}

const outcome = (id: string, s: DraftStatus | null, draft: string | null, note: string | null): DraftOutcome =>
  ({ message_id: id, draft_status: s, gmail_draft_id: draft, note })

async function flag(db: SupabaseClient, m: MessageRow, note: string): Promise<DraftOutcome> {
  await finalize(db, m.id, { draft_status: 'flagged', draft_note: note, drafted_at: new Date().toISOString() })
  return outcome(m.id, 'flagged', null, note)
}

async function decideAndDraft(db: SupabaseClient, m: MessageRow, box: Mailbox, ctx: Ctx): Promise<DraftOutcome> {
  // 1. the mailbox's reply rule must allow drafts
  const { data: rule, error: rErr } = await db.from('hub_sched_reply_rules').select('mode').eq('connection_id', box.id).maybeSingle()
  if (rErr) throw new DraftError(`reply_rule_${rErr.code ?? 'unknown'}`)
  if (!rule || (rule as any).mode !== 'draft_only') return flag(db, m, 'reply_rule')

  // 2. who it is from
  const sender = String(m.from_address ?? '').trim().toLowerCase()
  if (!sender) return flag(db, m, 'no_sender')
  if (ctx.ownAddresses.includes(sender)) return flag(db, m, 'own_address')

  // 3. anything that reads personal, legal, financial or clinical is the owner's to answer
  if (isSensitive(m.summary, m.suggested_action, m.subject)) return flag(db, m, 'sensitive')

  // 4. the category
  const { data: trusted, error: tErr } = await db.from('hub_sched_trusted_senders').select('id')
    .eq('owner_user_id', SCHED_OWNER).eq('active', true).eq('sender_address', sender).limit(1)
  if (tErr) throw new DraftError(`trusted_${tErr.code ?? 'unknown'}`)
  const category: SchedCategory = draftCategory({ trustedSender: (trusted?.length ?? 0) > 0, subject: m.subject, summary: m.summary })
  const first = firstName(m.from_name)

  // 5. a new prospect asking for a call gets the Discovery Call link
  let body: string | null = null
  let status: DraftStatus = 'drafted'
  if (category === 'one_on_one') {
    const { data: contacts, error: cErr } = await db.from('contacts').select('id')
      .eq('org_id', SCHED_ORG).ilike('email', escapeLike(sender)).is('merged_into_id', null).limit(1)
    if (cErr) throw new DraftError(`contact_${cErr.code ?? 'unknown'}`)
    if (!contacts?.length) {
      let url: string | null
      try { url = await discoveryBookingUrl(db, SCHED_ORG) } catch { throw new DraftError('booking_url_read') }
      if (url) { body = linkText(first, url); status = 'link_drafted' }
    }
  }

  // 6. otherwise open times; none means an exception request and a text to the owner
  if (!body) {
    const avail = await findAvailability(db, category, ctx.now)
    if (!avail.slots.length) return fileException(db, m, category, first, avail.firstRuleValid, ctx.now)
    body = slotsText(first, avail.slots.map((s) => slotLabel(s.start, SCHED_TZ)))
  }

  // 7. the draft, in the thread, from the mailbox it arrived in, to the sender only
  const token = await accessTokenFor(await refreshTokenFor(db, box.id))
  const hdr = await replyHeaders(token, m.gmail_message_id)
  const to = chooseRecipient(hdr.from, hdr.replyTo)
  if (!to) throw new DraftError('no_recipient')
  if (ctx.ownAddresses.includes(to)) return flag(db, m, 'own_address')
  const raw = buildRfc2822({ from: box.email_address, to, subject: hdr.subject ?? m.subject, messageId: hdr.messageId, body })
  const draftId = await createDraft(token, raw, hdr.threadId || m.gmail_thread_id)
  try {
    await finalize(db, m.id, { draft_status: status, gmail_draft_id: draftId, drafted_at: new Date().toISOString(), draft_note: null, status: 'seen' })
  } catch (e) {
    // The draft exists in Gmail; record what we can so it is not drafted twice.
    console.error(`[sched-drafts] message ${m.id} drafted (draft ${draftId}) but the row was not updated`)
    throw e
  }
  return outcome(m.id, status, draftId, null)
}

async function fileException(
  db: SupabaseClient, m: MessageRow, category: SchedCategory, first: string | null,
  firstRuleValid: { start: string; end: string } | null, now: string,
): Promise<DraftOutcome> {
  let start = firstRuleValid?.start, end = firstRuleValid?.end
  if (!start || !end) {
    const day = businessDays(now, SCHED_TZ)[0]
    const s = zonedMs(day, 9, 0, SCHED_TZ) ?? Date.parse(now) + 86_400_000
    start = new Date(s).toISOString(); end = new Date(s + 30 * 60_000).toISOString()
  }
  const { error } = await db.from('hub_sched_exception_requests').insert({
    owner_user_id: SCHED_OWNER,
    category,
    requested_starts_at: start,
    requested_ends_at: end,
    requester_name: String(m.from_name ?? '').slice(0, 200),
    requester_email: String(m.from_address ?? '').toLowerCase().slice(0, 320),
    note: 'No open time in the next 10 business days (agent)',
    source: 'agent',
    check_reason: 'no_slot',
  })
  if (error) {
    const note = `exception_${error.code ?? 'unknown'}`
    await finalize(db, m.id, { draft_status: 'no_slot', draft_note: note, drafted_at: new Date().toISOString() })
    return outcome(m.id, 'no_slot', null, note)
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || HUB_ORIGIN
  let smsNote = 'sms_failed'
  try {
    const r = await sendNotifySms({ user_id: SCHED_OWNER, org_id: SCHED_ORG, body: exceptionSms(first, appUrl) })
    smsNote = r.sent ? 'sms_sent' : `sms_${r.reason ?? r.error_code ?? 'not_sent'}`
  } catch {
    smsNote = 'sms_failed'
  }
  const note = smsNote.replace(/[^\w-]/g, '').slice(0, 60)
  await finalize(db, m.id, { draft_status: 'exception', draft_note: note, drafted_at: new Date().toISOString() })
  return outcome(m.id, 'exception', null, note)
}

/** Runs one message end to end; any failure becomes draft_status 'error' with a short code. */
async function processMessage(db: SupabaseClient, m: MessageRow, box: Mailbox, ctx: Ctx): Promise<DraftOutcome> {
  try {
    return await decideAndDraft(db, m, box, ctx)
  } catch (e) {
    const note = codeOf(e).replace(/[^\w-]/g, '').slice(0, 60) || 'unknown'
    console.error(`[sched-drafts] message ${m.id} failed: ${note}`)
    await db.from('hub_mail_messages').update({ draft_status: 'error', draft_note: note, drafted_at: new Date().toISOString() }).eq('id', m.id)
    return outcome(m.id, 'error', null, note)
  }
}

async function ownerMailboxes(db: SupabaseClient): Promise<Mailbox[]> {
  const { data, error } = await db.from('hub_mail_connections').select('id, email_address, owner_user_id, status').eq('owner_user_id', SCHED_OWNER)
  if (error) throw new DraftError(`connections_${error.code ?? 'unknown'}`)
  return (data ?? []) as Mailbox[]
}

/** Claims the row (drafted_at as the claim mark), so two overlapping runs cannot both draft it. */
async function claim(db: SupabaseClient, id: string, now: string): Promise<boolean> {
  const stale = new Date(Date.parse(now) - CLAIM_STALE_MS).toISOString()
  const { data, error } = await db.from('hub_mail_messages').update({ drafted_at: now })
    .eq('id', id).is('draft_status', null).or(`drafted_at.is.null,drafted_at.lt.${stale}`).select('id')
  return !error && (data?.length ?? 0) === 1
}

// ─── the cron job ────────────────────────────────────────────────────────────
export interface SchedDraftsRun {
  skipped?: string
  considered: number
  outcomes: { message_id: string; draft_status: DraftStatus | null; note: string | null }[]
}

export async function runSchedDrafts(db: SupabaseClient, deadline: number, cfg?: SchedAgentConfig): Promise<SchedDraftsRun> {
  const config = cfg ?? (await readSchedAgentConfig(db))
  if (!config.drafts || !config.since) return { skipped: 'drafts_off', considered: 0, outcomes: [] }

  const boxes = await ownerMailboxes(db)
  const active = boxes.filter((b) => b.status === 'active')
  if (!active.length) return { skipped: 'no_mailbox', considered: 0, outcomes: [] }
  const now = new Date().toISOString()
  const stale = new Date(Date.parse(now) - CLAIM_STALE_MS).toISOString()

  const { data, error } = await db.from('hub_mail_messages').select(MESSAGE_COLUMNS)
    .in('connection_id', active.map((b) => b.id))
    .eq('category', 'scheduling').eq('status', 'new').is('draft_status', null)
    .gte('received_at', config.since)
    .or(`drafted_at.is.null,drafted_at.lt.${stale}`)
    .order('received_at', { ascending: true }).limit(DRAFTS_PER_RUN)
  if (error) {
    if (isMissingSchema(error)) return { skipped: 'columns_missing', considered: 0, outcomes: [] }
    throw new Error(`hub_mail_messages read failed: ${error.code ?? 'unknown'}`)
  }
  const rows = (data ?? []) as unknown as MessageRow[]
  const ctx: Ctx = { ownAddresses: boxes.map((b) => String(b.email_address ?? '').toLowerCase()).filter(Boolean), now }
  const byId = new Map(active.map((b) => [b.id, b]))
  const outcomes: SchedDraftsRun['outcomes'] = []
  for (const m of rows) {
    if (Date.now() > deadline) break
    if (!(await claim(db, m.id, new Date().toISOString()))) continue
    const o = await processMessage(db, m, byId.get(m.connection_id)!, ctx)
    outcomes.push({ message_id: o.message_id, draft_status: o.draft_status, note: o.note })
  }
  console.info(`[sched-drafts] considered=${rows.length} handled=${outcomes.length}`)
  return { considered: rows.length, outcomes }
}

// ─── the superadmin test: one message, even when drafts are off (still never sends) ───
export type TestResult =
  | { ok: true; draft_status: DraftStatus | null; gmail_draft_id: string | null; note: string | null }
  | { ok: false; status: number; error: string }

export async function testDraftOne(db: SupabaseClient, messageId: string): Promise<TestResult> {
  const { data, error } = await db.from('hub_mail_messages').select(MESSAGE_COLUMNS).eq('id', messageId).maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return { ok: false, status: 409, error: 'The draft columns are not in the database yet (hub_234).' }
    return { ok: false, status: 500, error: 'The message could not be read.' }
  }
  const m = data as unknown as MessageRow | null
  if (!m) return { ok: false, status: 404, error: 'Not found.' }
  if (m.category !== 'scheduling') return { ok: false, status: 400, error: 'Only scheduling messages can be drafted.' }
  if (m.gmail_draft_id) return { ok: true, draft_status: m.draft_status as DraftStatus, gmail_draft_id: m.gmail_draft_id, note: 'already_drafted' }

  let boxes: Mailbox[]
  try { boxes = await ownerMailboxes(db) } catch { return { ok: false, status: 500, error: 'The mailboxes could not be read.' } }
  const box = boxes.find((b) => b.id === m.connection_id && b.status === 'active')
  if (!box) return { ok: false, status: 400, error: 'Drafts are only made in the scheduling owner\'s active mailboxes.' }

  // A test run starts from a clean state for this one message (it never had a Gmail draft, checked above).
  const now = new Date().toISOString()
  const { error: rErr } = await db.from('hub_mail_messages')
    .update({ draft_status: null, draft_note: null, drafted_at: now }).eq('id', m.id).is('gmail_draft_id', null)
  if (rErr) return { ok: false, status: 500, error: 'The message could not be prepared.' }
  const ctx: Ctx = { ownAddresses: boxes.map((b) => String(b.email_address ?? '').toLowerCase()).filter(Boolean), now }
  const o = await processMessage(db, m, box, ctx)
  return { ok: true, draft_status: o.draft_status, gmail_draft_id: o.gmail_draft_id, note: o.note }
}
