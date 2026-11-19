// src/lib/touch/first-touch.ts
// THE touch rule (Running List q41, decision c12, 2026-11-18). The speed to lead tiles, the self-booked tile and the
// lifecycle lead_no_touch_24h event (and the closing of its task) all call firstTouches, so they cannot disagree.
//
// A touch is something that actually reached the lead, at or after `since`:
//   text      an outbound message in the lead's conversations that the provider accepted (queued, sending, sent or
//             delivered); a failed, undelivered or scheduled message is not a touch
//   call      an outbound call to the lead
//   engine    a marketing or service send (campaign, confirmation) with status 'sent', not a dry run, with a sent time;
//             dry runs, skips, suppressions, failures and bounces are not touches
//   campaign  a legacy campaign email (email_sends with a campaign) marked sent, delivered, opened or clicked
//   confirm   a pipeline stage email to the client (stage_email_sends, recipient 'client') marked sent; the copy sent
//             to staff is not a touch
//   booking   a booking link shared with the lead from the contact card (hub_resource_links on a 'booking_link'
//             resource), not revoked
//   reply     an email to the lead's address from ANY connected mailbox, private ones included. METADATA ONLY: the
//             touch reads hub_mail_sent's recipient address and sent time and nothing else. It never reads a
//             subject, a body or hub_mail_messages, and it never reports which mailbox sent it, so a private
//             mailbox's details stay owner-only.
// Reads only; nothing is written.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface TouchLead { id: string; email: string | null; since: string }
export type TouchKind = 'text' | 'call' | 'engine' | 'campaign' | 'confirm' | 'booking' | 'reply'
export interface Touch { contactId: string; at: number; kind: TouchKind }

export const TEXT_SENT = ['queued', 'sending', 'sent', 'delivered']
export const CAMPAIGN_EMAIL_SENT = ['sent', 'delivered', 'opened', 'clicked']
/** The only columns the reply touch ever selects from hub_mail_sent. */
export const MAIL_SENT_COLUMNS = 'to_address, sent_at'

const CHUNK = 200
const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '')
const fail = (what: string, e: { code?: string } | null) => new Error(`${what} read failed: ${e?.code ?? 'unknown'}`)

async function inChunks(ids: string[], q: (chunk: string[]) => PromiseLike<{ data: any; error: any }>, label: string): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await q(ids.slice(i, i + CHUNK))
    if (error) throw fail(label, error)
    out.push(...(data ?? []))
  }
  return out
}

/** Pure: the earliest touch per lead at or after that lead's own `since`. */
export function earliestTouches(leads: TouchLead[], touches: Touch[]): Map<string, number> {
  const since = new Map(leads.map((l) => [l.id, Date.parse(l.since)]))
  const out = new Map<string, number>()
  for (const t of touches) {
    const s = since.get(t.contactId)
    if (s === undefined || Number.isNaN(t.at) || Number.isNaN(s) || t.at < s) continue
    if (!out.has(t.contactId) || t.at < out.get(t.contactId)!) out.set(t.contactId, t.at)
  }
  return out
}

/** Every touch to these leads, from every source in the rule above. */
export async function loadTouches(db: SupabaseClient, leads: TouchLead[]): Promise<Touch[]> {
  const ids = Array.from(new Set(leads.map((l) => l.id)))
  if (!ids.length) return []
  const earliest = new Date(Math.min(...leads.map((l) => Date.parse(l.since)).filter((n) => !Number.isNaN(n)))).toISOString()
  const touches: Touch[] = []
  const add = (contactId: string | null | undefined, at: string | null | undefined, kind: TouchKind) => {
    if (contactId && at) touches.push({ contactId, at: Date.parse(at), kind })
  }

  // text: outbound messages in the lead's conversations that the provider took
  const convs = await inChunks(ids, (ch) => db.from('conversations').select('id, contact_id').in('contact_id', ch), 'conversations')
  const convContact = new Map<string, string>(convs.map((c) => [c.id, c.contact_id]))
  const msgs = await inChunks(Array.from(convContact.keys()), (ch) => db.from('crm_messages').select('conversation_id, sent_at, created_at')
    .eq('direction', 'outbound').in('status', TEXT_SENT).in('conversation_id', ch), 'crm_messages')
  for (const m of msgs) add(convContact.get(m.conversation_id), m.sent_at ?? m.created_at, 'text')

  // call: outbound calls
  const calls = await inChunks(ids, (ch) => db.from('call_logs').select('contact_id, started_at, created_at')
    .eq('direction', 'outbound').in('contact_id', ch), 'call_logs')
  for (const c of calls) add(c.contact_id, c.started_at ?? c.created_at, 'call')

  // engine: campaign and confirmation sends that actually went out
  const sends = await inChunks(ids, (ch) => db.from('message_sends').select('contact_id, sent_at')
    .eq('status', 'sent').eq('dry_run', false).not('sent_at', 'is', null).gte('sent_at', earliest).in('contact_id', ch), 'message_sends')
  for (const s of sends) add(s.contact_id, s.sent_at, 'engine')

  // campaign: legacy campaign emails
  const emails = await inChunks(ids, (ch) => db.from('email_sends').select('contact_id, sent_at')
    .not('campaign_id', 'is', null).in('status', CAMPAIGN_EMAIL_SENT).not('sent_at', 'is', null).in('contact_id', ch), 'email_sends')
  for (const e of emails) add(e.contact_id, e.sent_at, 'campaign')

  // confirm: stage emails to the client
  const stage = await inChunks(ids, (ch) => db.from('stage_email_sends').select('contact_id, sent_at')
    .eq('recipient', 'client').eq('status', 'sent').not('sent_at', 'is', null).in('contact_id', ch), 'stage_email_sends')
  for (const s of stage) add(s.contact_id, s.sent_at, 'confirm')

  // booking: booking links shared with the lead
  const { data: bookingRes, error: rErr } = await db.from('hub_resources').select('id').eq('kind', 'booking_link')
  if (rErr) throw fail('hub_resources', rErr)
  const bookingIds = new Set(((bookingRes ?? []) as any[]).map((r) => r.id as string))
  if (bookingIds.size) {
    const links = await inChunks(ids, (ch) => db.from('hub_resource_links').select('contact_id, resource_id, created_at')
      .is('revoked_at', null).in('contact_id', ch), 'hub_resource_links')
    for (const l of links) if (bookingIds.has(l.resource_id)) add(l.contact_id, l.created_at, 'booking')
  }

  // reply: any connected mailbox, metadata only (recipient address and sent time)
  const byEmail = new Map<string, string[]>()
  for (const l of leads) { const e = lower(l.email); if (e.includes('@')) byEmail.set(e, [...(byEmail.get(e) ?? []), l.id]) }
  const addrs = Array.from(byEmail.keys())
  if (addrs.length) {
    const sent = await inChunks(addrs, (ch) => db.from('hub_mail_sent').select(MAIL_SENT_COLUMNS).in('to_address', ch).gte('sent_at', earliest), 'hub_mail_sent')
    for (const m of sent) for (const id of byEmail.get(lower(m.to_address)) ?? []) add(id, m.sent_at, 'reply')
  }
  return touches
}

/** The first touch per lead at or after its own `since`. A lead with no touch is absent from the map. */
export async function firstTouches(db: SupabaseClient, leads: TouchLead[]): Promise<Map<string, number>> {
  return earliestTouches(leads, await loadTouches(db, leads))
}
