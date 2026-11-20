// src/lib/touchpoints/detect.ts
// The "waiting on us" detector (Running List q35, Part 1). Server only (service role). READS ONLY: it finds the
// situations; queue.ts records them and keeps the board cards. University tables are never written.
//
// Each situation is keyed contact id + situation + the triggering record id, so it is raised at most once. Every
// detail holds ids and times only: never a subject, a body, a message text or an address.
//
//   booking_link_not_booked  a booking link (hub_resource_links on a 'booking_link' resource, not revoked) shared more
//                            than 48 h ago, and no University booking (hub_booking_syncs) for the contact since.
//   inbound_no_reply         the contact's email (hub_mail_messages.from_address = their address) reached a connected
//                            mailbox more than 24 h ago and that mailbox has sent them nothing since (hub_mail_sent,
//                            metadata only). Reads id, mailbox, thread, sender and received time; never subject or body.
//   text_no_reply            the contact's latest text (crm_messages in their conversations) is inbound, more than 24 h
//                            old, with no outbound since.
//   coursework_quiet         in the Enrolled pipeline at a stage that is not Completed, and no University activity for
//                            7 days, by the same activity sources as the lifecycle inactive_5d scan (clientActivityTimes).
//   discovery_no_followup    a discovery call held (lifecycle booking_held or coaching_held, or a synced discovery
//                            booking that has ended) more than 48 h ago, and no touch since by the one touch rule.
import type { SupabaseClient } from '@supabase/supabase-js'
import { firstTouches } from '@/lib/touch/first-touch'
import { clientActivityTimes } from '@/lib/lifecycle/scan'
import { bookingComplete } from '@/lib/bookings/placement'
import { loadPipelines, loadPositions, findPipeline } from '@/lib/pipelines/positions'
import { CLEARED, THRESHOLDS, key, type SituationKind } from './rules'

export interface Found {
  contactId: string
  kind: SituationKind
  key: string
  triggerId: string
  /** when they started waiting on us */
  since: string
  /** ids and times only */
  detail: Record<string, string | number | null>
}
export interface Contact { id: string; email: string | null }
export interface DetectDeps {
  db: SupabaseClient
  orgId: string
  now: number
  /** the oldest time looked at: LOOKBACK_DAYS ago, or earlier when an open situation started earlier (so it can clear) */
  from: number
  enrolledPipeline: string
  /** the org's contacts that may be raised (not test, not staff, not merged or archived), by id */
  contacts: Map<string, Contact>
}
export interface Detection { found: Found[]; resolved: Map<string, string> }

const iso = (t: number) => new Date(t).toISOString()
const fail = (what: string, e: { code?: string } | null) => new Error(`${what} read: ${e?.code ?? 'unknown'}`)
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase()

function emailIndex(contacts: Map<string, Contact>): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const c of Array.from(contacts.values())) { const e = lower(c.email); if (e.includes('@')) m.set(e, [...(m.get(e) ?? []), c.id]) }
  return m
}

async function bookingLinks(d: DetectDeps, out: Detection) {
  const { db, orgId, now } = d
  const { data: res, error } = await db.from('hub_resources').select('id').eq('org_id', orgId).eq('kind', 'booking_link')
  if (error) throw fail('hub_resources', error)
  const ids = ((res ?? []) as any[]).map((r) => r.id)
  if (!ids.length) return
  const { data: links, error: lErr } = await db.from('hub_resource_links').select('id, contact_id, created_at, revoked_at')
    .eq('org_id', orgId).in('resource_id', ids).is('revoked_at', null).gte('created_at', iso(d.from))
  if (lErr) throw fail('hub_resource_links', lErr)
  const mine = ((links ?? []) as any[]).filter((l) => d.contacts.has(l.contact_id))
  if (!mine.length) return
  const { data: books, error: bErr } = await db.from('hub_booking_syncs').select('contact_id, first_synced_at').eq('org_id', orgId)
    .in('contact_id', Array.from(new Set(mine.map((l) => l.contact_id))))
  if (bErr) throw fail('hub_booking_syncs', bErr)
  for (const l of mine) {
    const k = key(l.contact_id, 'booking_link_not_booked', l.id)
    const booked = ((books ?? []) as any[]).some((b) => b.contact_id === l.contact_id && Date.parse(b.first_synced_at) >= Date.parse(l.created_at))
    if (booked) { out.resolved.set(k, CLEARED.booking_link_not_booked); continue }
    if (now - Date.parse(l.created_at) < THRESHOLDS.booking_link_not_booked) continue
    out.found.push({ contactId: l.contact_id, kind: 'booking_link_not_booked', key: k, triggerId: l.id, since: l.created_at, detail: { link_id: l.id, shared_at: l.created_at } })
  }
}

/** The ONLY columns the inbound check reads from hub_mail_messages: no subject, no body, no summary. */
export const INBOUND_COLUMNS = 'id, connection_id, gmail_thread_id, from_address, received_at'

async function inboundMail(d: DetectDeps, out: Detection) {
  const { db, orgId, now } = d
  const byEmail = emailIndex(d.contacts)
  const { data: boxes, error } = await db.from('hub_mail_connections').select('id').eq('org_id', orgId)
  if (error) throw fail('hub_mail_connections', error)
  const boxIds = ((boxes ?? []) as any[]).map((b) => b.id)
  if (!boxIds.length || !byEmail.size) return
  const since = iso(d.from)
  const { data: msgs, error: mErr } = await db.from('hub_mail_messages').select(INBOUND_COLUMNS).in('connection_id', boxIds).gte('received_at', since)
  if (mErr) throw fail('hub_mail_messages', mErr)
  const theirs = ((msgs ?? []) as any[]).filter((m) => byEmail.has(lower(m.from_address)))
  if (!theirs.length) return
  const addrs = Array.from(new Set(theirs.map((m) => lower(m.from_address))))
  const { data: sent, error: sErr } = await db.from('hub_mail_sent').select('connection_id, to_address, sent_at').in('connection_id', boxIds).in('to_address', addrs).gte('sent_at', since)
  if (sErr) throw fail('hub_mail_sent', sErr)
  // per address and mailbox: the first message after our last reply is the one they are waiting on
  const groups = new Map<string, any[]>()
  for (const m of theirs) { const g = `${lower(m.from_address)}|${m.connection_id}`; groups.set(g, [...(groups.get(g) ?? []), m]) }
  for (const [g, list] of Array.from(groups.entries())) {
    const [addr, box] = g.split('|')
    const lastReply = ((sent ?? []) as any[]).filter((s) => s.connection_id === box && lower(s.to_address) === addr).reduce((t, s) => Math.max(t, Date.parse(s.sent_at) || 0), 0)
    const sorted = list.slice().sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at))
    for (const contactId of byEmail.get(addr) ?? []) {
      for (const m of sorted) if (Date.parse(m.received_at) <= lastReply) out.resolved.set(key(contactId, 'inbound_no_reply', m.id), CLEARED.inbound_no_reply)
      const waiting = sorted.find((m) => Date.parse(m.received_at) > lastReply)
      if (!waiting || now - Date.parse(waiting.received_at) < THRESHOLDS.inbound_no_reply) continue
      out.found.push({ contactId, kind: 'inbound_no_reply', key: key(contactId, 'inbound_no_reply', waiting.id), triggerId: waiting.id, since: waiting.received_at,
        detail: { message_id: waiting.id, mailbox_id: waiting.connection_id, thread_id: waiting.gmail_thread_id, received_at: waiting.received_at } })
    }
  }
}

async function texts(d: DetectDeps, out: Detection) {
  const { db, orgId, now } = d
  const { data: convs, error } = await db.from('conversations').select('id, contact_id').eq('org_id', orgId).gte('last_message_at', iso(d.from))
  if (error) throw fail('conversations', error)
  const mine = ((convs ?? []) as any[]).filter((c) => d.contacts.has(c.contact_id))
  if (!mine.length) return
  const byConv = new Map(mine.map((c) => [c.id as string, c.contact_id as string]))
  const { data: msgs, error: mErr } = await db.from('crm_messages').select('id, conversation_id, direction, created_at').in('conversation_id', Array.from(byConv.keys()))
    .gte('created_at', iso(d.from))
  if (mErr) throw fail('crm_messages', mErr)
  const byContact = new Map<string, any[]>()
  for (const m of (msgs ?? []) as any[]) { const c = byConv.get(m.conversation_id)!; byContact.set(c, [...(byContact.get(c) ?? []), m]) }
  for (const [contactId, list] of Array.from(byContact.entries())) {
    const sorted = list.slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    const lastOut = sorted.filter((m) => m.direction === 'outbound').reduce((t, m) => Math.max(t, Date.parse(m.created_at)), 0)
    for (const m of sorted) if (m.direction === 'inbound' && Date.parse(m.created_at) <= lastOut) out.resolved.set(key(contactId, 'text_no_reply', m.id), CLEARED.text_no_reply)
    const last = sorted[sorted.length - 1]
    if (!last || last.direction !== 'inbound' || now - Date.parse(last.created_at) < THRESHOLDS.text_no_reply) continue
    const first = sorted.find((m) => m.direction === 'inbound' && Date.parse(m.created_at) > lastOut)!
    out.found.push({ contactId, kind: 'text_no_reply', key: key(contactId, 'text_no_reply', first.id), triggerId: first.id, since: first.created_at,
      detail: { message_id: first.id, received_at: first.created_at } })
  }
}

async function coursework(d: DetectDeps, out: Detection) {
  const { db, orgId, now } = d
  const pipelines = await loadPipelines(db, orgId)
  const p = findPipeline(pipelines, d.enrolledPipeline)
  if (!p) return
  const positions = (await loadPositions(db, orgId, { pipelineId: p.id, pipelines }))
    .filter((x) => !/complet/i.test(x.stage_name) && d.contacts.has(x.contact_id))
  for (const pos of positions) {
    const email = lower(d.contacts.get(pos.contact_id)?.email)
    if (!email.includes('@')) continue
    const { data: prof, error } = await db.from('profiles').select('id').ilike('email', email.replace(/[\\%_]/g, (c) => '\\' + c)).limit(1)
    if (error) throw fail('profiles', error)
    const userId = (prof as any[] | null)?.[0]?.id
    if (!userId) continue
    const times = await clientActivityTimes(db, userId, now)
    // quiet time counts from the latest activity, or from the move into this stage when there has been none since
    const last = Math.max(Date.parse(pos.moved_at) || 0, ...times)
    if (!last) continue
    const anchor = iso(last)
    const k = key(pos.contact_id, 'coursework_quiet', anchor)
    if (now - last < THRESHOLDS.coursework_quiet) { out.resolved.set(`${pos.contact_id}:coursework_quiet:*before:${anchor}`, CLEARED.coursework_quiet); continue }
    out.found.push({ contactId: pos.contact_id, kind: 'coursework_quiet', key: k, triggerId: anchor, since: anchor, detail: { last_activity_at: anchor, stage_id: pos.stage_id } })
  }
}

async function discovery(d: DetectDeps, out: Detection) {
  const { db, orgId, now } = d
  const from = iso(d.from)
  const held = new Map<string, { contactId: string; at: string }>()
  const { data: ev, error } = await db.from('hub_lifecycle_events').select('contact_id, source_id, occurred_at').eq('org_id', orgId)
    .in('event_type', ['booking_held', 'coaching_held']).gte('occurred_at', from)
  if (error) throw fail('hub_lifecycle_events', error)
  for (const e of (ev ?? []) as any[]) if (e.contact_id && e.source_id) held.set(String(e.source_id), { contactId: e.contact_id, at: e.occurred_at })
  const { data: bk, error: bErr } = await db.from('hub_booking_syncs').select('booking_id, contact_id, appointment_type, starts_at, ends_at, status')
    .eq('org_id', orgId).not('contact_id', 'is', null).gte('starts_at', from)
  if (bErr) throw fail('hub_booking_syncs', bErr)
  for (const b of (bk ?? []) as any[]) {
    if (!/discovery/i.test(b.appointment_type ?? '') || held.has(b.booking_id)) continue
    if (bookingComplete(b, new Date(now))) held.set(b.booking_id, { contactId: b.contact_id, at: b.ends_at ?? b.starts_at })
  }
  const list = Array.from(held.entries()).filter(([, h]) => d.contacts.has(h.contactId))
  if (!list.length) return
  for (const [bookingId, h] of list) {
    const k = key(h.contactId, 'discovery_no_followup', bookingId)
    const touch = (await firstTouches(db, [{ id: h.contactId, email: d.contacts.get(h.contactId)?.email ?? null, since: h.at }])).get(h.contactId)
    if (touch !== undefined) { out.resolved.set(k, CLEARED.discovery_no_followup); continue }
    if (now - Date.parse(h.at) < THRESHOLDS.discovery_no_followup) continue
    out.found.push({ contactId: h.contactId, kind: 'discovery_no_followup', key: k, triggerId: bookingId, since: h.at, detail: { booking_id: bookingId, held_at: h.at } })
  }
}

export const DETECTORS: Record<SituationKind, (d: DetectDeps, out: Detection) => Promise<void>> = {
  booking_link_not_booked: bookingLinks,
  inbound_no_reply: inboundMail,
  text_no_reply: texts,
  coursework_quiet: coursework,
  discovery_no_followup: discovery,
}

export async function detect(d: DetectDeps): Promise<Detection> {
  const out: Detection = { found: [], resolved: new Map() }
  for (const k of Object.keys(DETECTORS) as SituationKind[]) await DETECTORS[k](d, out)
  return out
}

/** A coursework situation clears when activity came after its anchor: the resolved marker carries the newest anchor. */
export function courseworkCleared(resolved: Map<string, string>, contactId: string, openAnchor: string): string | null {
  const prefix = `${contactId}:coursework_quiet:*before:`
  for (const [k, reason] of Array.from(resolved.entries())) if (k.startsWith(prefix) && Date.parse(k.slice(prefix.length)) > Date.parse(openAnchor)) return reason
  return null
}
