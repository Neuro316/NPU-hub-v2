// src/lib/drafts/support.ts
// Reply drafts (Running List q10, Cameron's decision 2026-11-18; every email a person would answer, Shane 2026-11-23).
// Server only (service role). For each recent hub_mail_messages row triaged participant_support, lead, scheduling or
// partner_outreach (DRAFT_CATEGORIES), in an org whose org_settings 'hub_drafts_mode' is 'on', and only when ALL hold
// (plan B2 and A1):
//   - no hub_drafts row for that message yet (one draft per message, ever)
//   - the sender is not ours (a connected mailbox, @neuroprogeny.com) and not an automated sender
//   - nobody has replied in that thread from that mailbox since it arrived (hub_mail_sent)
//   - read from Gmail now, in memory only: not a thank-you, and not clinical, legal, financial or crisis
// it composes a reply and saves it as a Gmail draft (drafts.create) IN THE ORIGINAL THREAD, IN THE MAILBOX THE EMAIL
// ARRIVED IN, with In-Reply-To and References, signed with the first name of that mailbox's owner. The Hub stores a
// pointer (draft id, draft message id, thread id) and a shape of counts, never a subject, a body or the draft text. A
// hard stop stores needs_person with the class, and makes no draft. The Hub never sends.
//
// draftOnDemand runs the SAME pipeline (draftMessage) for one message, from the review pane's Draft a reply: superadmin,
// the mailbox rule (loadVisible), drafting mode on, any category but NO_DRAFT_CATEGORIES. Every draft keeps kind 'support'.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ModelClient } from '@/lib/agent/model'
import type { MessageForTriage } from '@/lib/mail/gmail'
import { loadVisible } from '@/lib/mail/google'
import type { StaffContext } from '@/lib/api-guard'
import { compose, loadVoice, type Voice } from './compose'
import { buildReplyMime, createDraft, deleteDraft, type GmailCall } from './gmail-drafts'
import { DEFAULT_SIGNER, DRAFT_CATEGORIES, NO_DRAFT_CATEGORIES, STOP_TEXT, draftsOn, hardStop, replySubject, senderSkip, shapeOf, type SkipReason, type StopClass } from './rules'

export const LOOKBACK_HOURS = 72
export const MAX_PER_RUN = 10
/** The ONLY columns read from hub_mail_messages: no subject, no summary, no body (the body is read from Gmail in memory). */
export const MESSAGE_COLUMNS = 'id, connection_id, gmail_message_id, gmail_thread_id, from_address, received_at, category'

export interface Mailbox { gmail: GmailCall; read: (gmailMessageId: string) => Promise<MessageForTriage> }
export interface SupportDeps {
  db: SupabaseClient
  orgId: string
  now: number
  model: ModelClient
  /** the Gmail access of ONE connection, by its id (its own token) */
  mailbox: (connectionId: string) => Promise<Mailbox>
}
export interface SupportOut { mode: 'on' | 'off'; drafted: number; needs_person: number; skipped: Record<string, number>; failed: number }

const fail = (what: string, e: { code?: string } | null) => new Error(`${what}: ${e?.code ?? 'unknown'}`)
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function draftsMode(db: SupabaseClient, orgId: string): Promise<'on' | 'off'> {
  const { data, error } = await db.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', 'hub_drafts_mode').maybeSingle()
  if (error) return 'off'
  return draftsOn((data as any)?.setting_value) ? 'on' : 'off'
}

async function record(db: SupabaseClient, row: Record<string, unknown>): Promise<boolean> {
  const { error } = await db.from('hub_drafts').insert(row)
  if (error?.code === '23505') return false
  if (error) throw fail('hub_drafts write', error)
  return true
}

/** The first name of a mailbox's owner: their team_profiles display_name in the org, else profiles full_name. */
export async function signerFor(db: SupabaseClient, orgId: string, ownerUserId: string | null | undefined): Promise<string> {
  if (!ownerUserId) return DEFAULT_SIGNER
  const first = (s: unknown) => String(s ?? '').trim().split(/\s+/)[0] ?? ''
  const { data: tp } = await db.from('team_profiles').select('display_name').eq('org_id', orgId).eq('user_id', ownerUserId).maybeSingle()
  const fromTeam = first((tp as any)?.display_name)
  if (fromTeam) return fromTeam
  const { data: p } = await db.from('profiles').select('full_name').eq('id', ownerUserId).maybeSingle()
  return first((p as any)?.full_name) || DEFAULT_SIGNER
}

/**
 * The facts a task may use, built by code: for a lead and for scheduling, the org's booking links (hub_resources, kind
 * booking_link); for scheduling, the mailbox owner's allowed windows from the Rules page (hub_sched_category_windows and
 * hub_sched_settings, the tables the scheduling route reads, owner_user_id = the owner).
 */
export async function composeExtras(db: SupabaseClient, orgId: string, category: string | null, ownerUserId: string | null): Promise<string | null> {
  if (category !== 'lead' && category !== 'scheduling') return null
  const parts: string[] = []
  const { data: links } = await db.from('hub_resources').select('name, url').eq('org_id', orgId).eq('kind', 'booking_link').is('archived_at', null).limit(5)
  const ls = ((links ?? []) as any[]).filter((l) => typeof l.url === 'string' && /^https:\/\//.test(l.url))
  parts.push(ls.length ? 'Booking links (offer the discovery call link to a lead):\n' + ls.map((l) => `- ${String(l.name ?? 'Booking link').slice(0, 80)}: ${l.url}`).join('\n')
    : 'No booking link is set up: say the calendar link will follow, never invent one.')
  if (category === 'scheduling' && ownerUserId) {
    const [{ data: wins }, { data: st }] = await Promise.all([
      db.from('hub_sched_category_windows').select('category, day_kind, start_time, end_time').eq('owner_user_id', ownerUserId).order('category'),
      db.from('hub_sched_settings').select('timezone').eq('owner_user_id', ownerUserId).maybeSingle(),
    ])
    const tz = String((st as any)?.timezone ?? 'America/New_York')
    const hm = (t: unknown) => String(t ?? '').slice(0, 5)
    const ws = ((wins ?? []) as any[]).map((w) => `- ${String(w.category).replace(/_/g, ' ')}, ${String(w.day_kind).replace(/_/g, ' ')} days: ${hm(w.start_time)} to ${hm(w.end_time)}`)
    parts.push(ws.length ? `Allowed meeting windows from the Rules page (times in ${tz}; offer two or three times inside the window for that kind of meeting, never more than three):\n${ws.join('\n')}`
      : 'No meeting windows are set on the Rules page: offer the booking link instead of times.')
  }
  return parts.join('\n\n')
}

interface Box { id: string; email_address: string; owner_user_id: string | null; status: string }
/** One org's mailboxes, our addresses, and the voice and signers, loaded once and shared by every message. */
export interface Env { orgId: string; boxes: Map<string, Box>; ours: string[]; voice: Voice | null; signers: Map<string, string> }
export async function orgEnv(db: SupabaseClient, orgId: string): Promise<Env> {
  const { data: boxes, error } = await db.from('hub_mail_connections').select('id, email_address, status, owner_user_id').eq('org_id', orgId)
  if (error) throw fail('hub_mail_connections', error)
  const all = (boxes ?? []) as Box[]
  return { orgId, boxes: new Map(all.filter((b) => b.status === 'active').map((b) => [b.id, b])), ours: all.map((b) => lower(b.email_address)), voice: null, signers: new Map() }
}

/** Why this message gets no draft before any Gmail or model call, or null. */
export async function screen(db: SupabaseClient, m: any, env: Env): Promise<SkipReason | null> {
  const who = senderSkip(m.from_address, env.ours)
  if (who) return who
  const { data: replied } = await db.from('hub_mail_sent').select('id').eq('connection_id', m.connection_id).eq('gmail_thread_id', m.gmail_thread_id)
    .gt('sent_at', m.received_at).limit(1)
  return replied?.length ? 'already_replied' : null
}

export interface OneOut { status: 'drafted' | 'needs_person' | 'skipped'; reason: string | null }
/** The pipeline for ONE message (cron and Draft a reply alike). The hard stop and the thanks-only skip run in compose,
 *  before any model call. Throws a short code on a Gmail or model failure. */
export async function draftMessage(d: SupportDeps, m: any, env: Env, pre: { mb: Mailbox; msg: MessageForTriage } | null = null): Promise<OneOut> {
  const { db } = d
  const box = env.boxes.get(m.connection_id)!
  const base = { org_id: env.orgId, connection_id: m.connection_id, gmail_thread_id: m.gmail_thread_id, kind: 'support', source_table: 'hub_mail_messages', source_id: m.id }
  const mb = pre?.mb ?? await d.mailbox(m.connection_id)
  const msg = pre?.msg ?? await mb.read(m.gmail_message_id)   // body in memory only
  const { data: c } = await db.from('contacts').select('id, first_name').eq('org_id', env.orgId).ilike('email', lower(m.from_address).replace(/[\\%_]/g, (x) => '\\' + x)).is('merged_into_id', null).limit(1)
  const contact = (c as any[] | null)?.[0] ?? null
  env.voice = env.voice ?? await loadVoice(db, env.orgId)
  const ownerKey = box.owner_user_id ?? ''
  if (!env.signers.has(ownerKey)) env.signers.set(ownerKey, await signerFor(db, env.orgId, box.owner_user_id))
  const signer = env.signers.get(ownerKey)!
  const category = m.category ?? null
  const extra = await composeExtras(db, env.orgId, category, box.owner_user_id)
  const r = await compose(d.model, 'support', { fromName: msg.fromName, fromAddress: msg.fromAddress, subject: msg.subject, body: msg.body, firstName: contact?.first_name ?? null,
    category, signer, extra }, env.voice)
  if (!r.ok && 'stop' in r) {
    const ok = await record(db, { ...base, contact_id: contact?.id ?? null, status: 'needs_person', reason: r.stop })
    return ok ? { status: 'needs_person', reason: r.stop } : { status: 'skipped', reason: 'already_drafted' }
  }
  if (!r.ok) {
    await record(db, { ...base, contact_id: contact?.id ?? null, status: 'skipped', reason: r.skip })
    return { status: 'skipped', reason: r.skip }
  }
  const raw = buildReplyMime({ from: box.email_address, to: msg.fromAddress ?? m.from_address, subject: replySubject(msg.subject), text: r.draft.body,
    inReplyTo: msg.rfcMessageId ?? null, references: msg.references ?? null })
  const made = await createDraft(mb.gmail, raw, m.gmail_thread_id)
  const ok = await record(db, { ...base, contact_id: contact?.id ?? null, status: 'drafted', gmail_draft_id: made.draftId, gmail_draft_message_id: made.messageId,
    draft_shape: shapeOf(r.draft.body, contact?.first_name ?? null, signer) })
  if (!ok) { await deleteDraft(mb.gmail, made.draftId); return { status: 'skipped', reason: 'already_drafted' } }
  return { status: 'drafted', reason: null }
}

export async function runSupportDrafts(d: SupportDeps): Promise<SupportOut> {
  const { db, orgId, now } = d
  const out: SupportOut = { mode: await draftsMode(db, orgId), drafted: 0, needs_person: 0, skipped: {}, failed: 0 }
  if (out.mode !== 'on') return out
  const skip = (r: SkipReason | string) => { out.skipped[r] = (out.skipped[r] ?? 0) + 1 }

  const env = await orgEnv(db, orgId)
  if (!env.boxes.size) return out
  const { data: msgs, error: mErr } = await db.from('hub_mail_messages').select(MESSAGE_COLUMNS)
    .in('connection_id', Array.from(env.boxes.keys())).in('category', DRAFT_CATEGORIES)
    .gte('received_at', new Date(now - LOOKBACK_HOURS * 3_600_000).toISOString()).order('received_at', { ascending: true }).limit(200)
  if (mErr) throw fail('hub_mail_messages', mErr)
  const list = (msgs ?? []) as any[]
  if (!list.length) return out
  const { data: done, error: dErr } = await db.from('hub_drafts').select('source_id').eq('source_table', 'hub_mail_messages').in('source_id', list.map((m) => m.id))
  if (dErr) throw fail('hub_drafts read', dErr)
  const seen = new Set(((done ?? []) as any[]).map((r) => r.source_id as string))

  let worked = 0
  for (const m of list) {
    if (worked >= MAX_PER_RUN) break
    if (seen.has(m.id)) { skip('already_drafted'); continue }
    const why = await screen(db, m, env)
    if (why) { skip(why); continue }
    worked++
    try {
      const r = await draftMessage(d, m, env)
      if (r.status === 'drafted') out.drafted++
      else if (r.status === 'needs_person') out.needs_person++
      else skip(r.reason ?? 'skipped')
    } catch (e: any) {
      out.failed++
      console.error(`[drafts] message ${m.id} failed: ${String(e?.code ?? e?.message ?? 'error').slice(0, 40)}`)
    }
  }
  return out
}

const SKIP_TEXT: Record<string, string> = {
  own_sender: 'This email came from one of our own addresses, so no draft was written.',
  automated_sender: 'This email came from an automated sender, so no draft was written.',
  no_sender: 'This email has no sender address to reply to.',
  already_replied: 'Someone has already replied in this thread from this mailbox.',
  already_drafted: 'This email already has a draft.',
  thanks_only: 'This reads as a thank-you with nothing to answer, so no draft was written.',
  invalid: 'The draft did not pass the checks, so it was not saved. Try again or reply in Gmail.',
}

/**
 * Draft a reply, from the review pane: the cron's pipeline for one message. Superadmin only; the mailbox rule decides
 * (a message the caller may not see is 404); drafting mode must be on (409); never for NO_DRAFT_CATEGORIES.
 */
export async function draftOnDemand(ctx: Pick<StaffContext, 'db' | 'userId' | 'isSuperadmin' | 'orgIds'>, messageId: unknown, deps: { model: ModelClient; mailbox: SupportDeps['mailbox']; now: number }):
  Promise<{ status: number; body: Record<string, unknown> }> {
  const { db } = ctx
  if (!ctx.isSuperadmin) return { status: 403, body: { error: 'Drafts are for superadmins.' } }
  if (typeof messageId !== 'string' || !UUID.test(messageId)) return { status: 404, body: { error: 'Not found.' } }
  const { data: m } = await db.from('hub_mail_messages').select(MESSAGE_COLUMNS).eq('id', messageId).maybeSingle()
  const box = m ? await loadVisible(ctx as StaffContext, (m as any).connection_id) : null
  if (!m || !box) return { status: 404, body: { error: 'Not found.' } }
  if (NO_DRAFT_CATEGORIES.includes(String((m as any).category ?? ''))) return { status: 400, body: { error: 'This kind of email is never drafted.' } }
  if ((await draftsMode(db, box.org_id)) !== 'on') return { status: 409, body: { error: 'Drafting is off for this organization, so no draft was written.' } }
  const { data: had } = await db.from('hub_drafts').select('id').eq('source_table', 'hub_mail_messages').eq('source_id', messageId).limit(1)
  if ((had as any[] | null)?.length) return { status: 409, body: { error: SKIP_TEXT.already_drafted } }
  const env = await orgEnv(db, box.org_id)
  if (!env.boxes.has((m as any).connection_id)) return { status: 409, body: { error: 'This mailbox is not connected right now. Reconnect it in Settings, Mailboxes.' } }
  const why = await screen(db, m, env)
  if (why) return { status: 422, body: { error: SKIP_TEXT[why] ?? 'No draft was written.' } }
  // the email is screened here first, before any model call (as Redraft does); compose screens it again
  const mb = await deps.mailbox((m as any).connection_id)
  const msg = await mb.read((m as any).gmail_message_id)   // body in memory only
  const early = hardStop(msg.subject, msg.body)
  if (early) {
    const { error } = await db.from('hub_drafts').insert({ org_id: box.org_id, connection_id: (m as any).connection_id, gmail_thread_id: (m as any).gmail_thread_id, kind: 'support',
      source_table: 'hub_mail_messages', source_id: messageId, status: 'needs_person', reason: early })
    if (error) return { status: error.code === '23505' ? 409 : 500, body: { error: error.code === '23505' ? SKIP_TEXT.already_drafted : 'The result could not be saved.' } }
    return { status: 200, body: { status: 'needs_person', message: `No draft: this needs a person (${STOP_TEXT[early]}).` } }
  }
  const r = await draftMessage({ db, orgId: box.org_id, now: deps.now, model: deps.model, mailbox: deps.mailbox }, m, env, { mb, msg })
  if (r.status === 'drafted') return { status: 200, body: { status: 'drafted' } }
  if (r.status === 'needs_person') return { status: 200, body: { status: 'needs_person', message: `No draft: this needs a person (${STOP_TEXT[r.reason as StopClass] ?? 'flagged'}).` } }
  return { status: 200, body: { status: null, message: SKIP_TEXT[r.reason ?? ''] ?? 'No draft was written.' } }
}
