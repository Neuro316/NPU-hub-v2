// src/lib/drafts/support.ts
// Support email drafts (Running List q10, Cameron's decision 2026-11-18). Server only (service role).
// For each recent hub_mail_messages row triaged participant_support, in an org whose org_settings 'hub_drafts_mode'
// is 'on', and only when ALL hold (plan B2 and A1):
//   - no hub_drafts row for that message yet (one draft per message, ever)
//   - the sender is not ours (a connected mailbox, @neuroprogeny.com) and not an automated sender
//   - nobody has replied in that thread from that mailbox since it arrived (hub_mail_sent)
//   - read from Gmail now, in memory only: not a thank-you, and not clinical, legal, financial or crisis
// it composes a reply and saves it as a Gmail draft (drafts.create) IN THE ORIGINAL THREAD, IN THE MAILBOX THE EMAIL
// ARRIVED IN, with In-Reply-To and References. The Hub stores a pointer (draft id, draft message id, thread id) and a
// shape of counts, never a subject, a body or the draft text. A hard stop stores needs_person with the class, and
// makes no draft. The Hub never sends.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ModelClient } from '@/lib/agent/model'
import type { MessageForTriage } from '@/lib/mail/gmail'
import { compose, loadVoice } from './compose'
import { buildReplyMime, createDraft, deleteDraft, type GmailCall } from './gmail-drafts'
import { DRAFT_CATEGORIES, draftsOn, replySubject, senderSkip, shapeOf, type SkipReason } from './rules'

export const LOOKBACK_HOURS = 72
export const MAX_PER_RUN = 10
/** The ONLY columns read from hub_mail_messages: no subject, no summary, no body (the body is read from Gmail in memory). */
export const MESSAGE_COLUMNS = 'id, connection_id, gmail_message_id, gmail_thread_id, from_address, received_at'

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

export async function runSupportDrafts(d: SupportDeps): Promise<SupportOut> {
  const { db, orgId, now } = d
  const out: SupportOut = { mode: await draftsMode(db, orgId), drafted: 0, needs_person: 0, skipped: {}, failed: 0 }
  if (out.mode !== 'on') return out
  const skip = (r: SkipReason | string) => { out.skipped[r] = (out.skipped[r] ?? 0) + 1 }

  const { data: boxes, error } = await db.from('hub_mail_connections').select('id, email_address, status').eq('org_id', orgId)
  if (error) throw fail('hub_mail_connections', error)
  const active = ((boxes ?? []) as any[]).filter((b) => b.status === 'active')
  const ours = ((boxes ?? []) as any[]).map((b) => lower(b.email_address))
  if (!active.length) return out
  const boxEmail = new Map(active.map((b) => [b.id as string, b.email_address as string]))

  const { data: msgs, error: mErr } = await db.from('hub_mail_messages').select(MESSAGE_COLUMNS)
    .in('connection_id', Array.from(boxEmail.keys())).in('category', DRAFT_CATEGORIES)
    .gte('received_at', new Date(now - LOOKBACK_HOURS * 3_600_000).toISOString()).order('received_at', { ascending: true }).limit(200)
  if (mErr) throw fail('hub_mail_messages', mErr)
  const list = (msgs ?? []) as any[]
  if (!list.length) return out
  const { data: done, error: dErr } = await db.from('hub_drafts').select('source_id').eq('source_table', 'hub_mail_messages').in('source_id', list.map((m) => m.id))
  if (dErr) throw fail('hub_drafts read', dErr)
  const seen = new Set(((done ?? []) as any[]).map((r) => r.source_id as string))

  let voice: Awaited<ReturnType<typeof loadVoice>> | null = null
  let worked = 0
  for (const m of list) {
    if (worked >= MAX_PER_RUN) break
    if (seen.has(m.id)) { skip('already_drafted'); continue }
    const who = senderSkip(m.from_address, ours)
    if (who) { skip(who); continue }
    const { data: replied } = await db.from('hub_mail_sent').select('id').eq('connection_id', m.connection_id).eq('gmail_thread_id', m.gmail_thread_id)
      .gt('sent_at', m.received_at).limit(1)
    if (replied?.length) { skip('already_replied'); continue }

    worked++
    const base = { org_id: orgId, connection_id: m.connection_id, gmail_thread_id: m.gmail_thread_id, kind: 'support', source_table: 'hub_mail_messages', source_id: m.id }
    try {
      const box = await d.mailbox(m.connection_id)
      const msg = await box.read(m.gmail_message_id)   // body in memory only
      const { data: c } = await db.from('contacts').select('id, first_name').eq('org_id', orgId).ilike('email', lower(m.from_address).replace(/[\\%_]/g, (x) => '\\' + x)).is('merged_into_id', null).limit(1)
      const contact = (c as any[] | null)?.[0] ?? null
      voice = voice ?? await loadVoice(db, orgId)
      const r = await compose(d.model, 'support', { fromName: msg.fromName, fromAddress: msg.fromAddress, subject: msg.subject, body: msg.body, firstName: contact?.first_name ?? null }, voice)
      if (!r.ok && 'stop' in r) {
        if (await record(db, { ...base, contact_id: contact?.id ?? null, status: 'needs_person', reason: r.stop })) out.needs_person++
        continue
      }
      if (!r.ok) {
        await record(db, { ...base, contact_id: contact?.id ?? null, status: 'skipped', reason: r.skip })
        skip(r.skip)
        continue
      }
      const raw = buildReplyMime({ from: boxEmail.get(m.connection_id)!, to: msg.fromAddress ?? m.from_address, subject: replySubject(msg.subject), text: r.draft.body,
        inReplyTo: msg.rfcMessageId ?? null, references: msg.references ?? null })
      const made = await createDraft(box.gmail, raw, m.gmail_thread_id)
      const ok = await record(db, { ...base, contact_id: contact?.id ?? null, status: 'drafted', gmail_draft_id: made.draftId, gmail_draft_message_id: made.messageId,
        draft_shape: shapeOf(r.draft.body, contact?.first_name ?? null) })
      if (!ok) { await deleteDraft(box.gmail, made.draftId); skip('already_drafted'); continue }
      out.drafted++
    } catch (e: any) {
      out.failed++
      console.error(`[drafts] message ${m.id} failed: ${String(e?.code ?? e?.message ?? 'error').slice(0, 40)}`)
    }
  }
  return out
}
