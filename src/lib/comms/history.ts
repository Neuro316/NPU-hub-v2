// src/lib/comms/history.ts
// Server only (service role): every touch with one contact, for the contact card's Communications section.
// Reads ids, times, directions, statuses and one-line summaries. NEVER selects a body: no crm_messages.body, no
// call transcript, no message_sends.rendered_body or subject. University tables (nr_bookings, profiles,
// nr_booking_leads) are read only.
//
// The contact is this contact plus every contact merged into it (merged_into_id), matched by their emails and
// phones AND the alternates a merge records in custom_fields (alt_emails: emails, alt_phones: E.164 phones).
import type { SupabaseClient } from '@supabase/supabase-js'
import { toE164 } from '@/lib/phone'
import { EVENT_TITLE, type EventType } from '@/lib/lifecycle/rules'
import { inboundEmail, outboundEmail, sortTouches, touch, MAILBOX_COLUMNS, type Mailbox, type Touch, type Viewer } from './privacy'
import { withAlso } from '@/lib/mail/access'

const LIMIT = 200
const fail = (what: string, e: { code?: string } | null) => new Error(`${what} read: ${e?.code ?? 'unknown'}`)
const uniq = <T,>(xs: T[]) => Array.from(new Set(xs.filter((x) => x !== null && x !== undefined && x !== ''))) as T[]
const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)

/** custom_fields.alt_emails / alt_phones, set by contact merges: an array of strings, anything else is none. */
function altList(customFields: unknown, key: 'alt_emails' | 'alt_phones'): string[] {
  const v = customFields && typeof customFields === 'object' ? (customFields as Record<string, unknown>)[key] : null
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export interface Subject { ids: string[]; orgId: string; emails: string[]; phones: string[] }

/** The contact and every contact merged into it, with their emails and E.164 phones. */
export async function subjectFor(db: SupabaseClient, contactId: string): Promise<Subject | null> {
  const { data: c, error } = await db.from('contacts').select('id, org_id, email, phone, custom_fields').eq('id', contactId).maybeSingle()
  if (error) throw fail('contacts', error)
  if (!c) return null
  const { data: merged, error: mErr } = await db.from('contacts').select('id, email, phone, custom_fields').eq('merged_into_id', contactId).limit(50)
  if (mErr) throw fail('merged contacts', mErr)
  const all = [c, ...(merged ?? [])] as any[]
  const emails = all.flatMap((x) => [x.email, ...altList(x.custom_fields, 'alt_emails')])
  const phones = all.flatMap((x) => [x.phone, ...altList(x.custom_fields, 'alt_phones')])
  return {
    ids: uniq(all.map((x) => x.id as string)),
    orgId: (c as any).org_id,
    emails: uniq(emails.map((e) => String(e ?? '').trim().toLowerCase()).filter((e) => e.includes('@'))),
    phones: uniq(phones.map((p) => (p ? toE164(String(p)) : '')).filter((p) => /^\+\d{10,15}$/.test(p))),
  }
}

async function names(db: SupabaseClient, table: 'team_profiles' | 'team_members' | 'profiles', key: string, ids: string[]): Promise<Map<string, string>> {
  const list = uniq(ids)
  if (!list.length) return new Map()
  const col = table === 'profiles' ? 'full_name' : 'display_name'
  const { data, error } = await db.from(table).select(`${key}, ${col}`).in(key, list)
  if (error) throw fail(table, error)
  return new Map((data ?? []).map((r: any) => [r[key] as string, (r[col] as string) || null]).filter(([, v]) => v) as [string, string][])
}

async function mail(db: SupabaseClient, viewer: Viewer, s: Subject): Promise<Touch[]> {
  if (!s.emails.length) return []
  const { data: boxes, error } = await withAlso(MAILBOX_COLUMNS, (cols) => db.from('hub_mail_connections').select(cols).eq('org_id', s.orgId))
  if (error) throw fail('hub_mail_connections', error)
  const box = new Map(((boxes ?? []) as Mailbox[]).map((b) => [b.id, b]))
  if (!box.size) return []
  const ids = Array.from(box.keys())
  const out: Touch[] = []
  for (const e of s.emails) {
    const { data, error: mErr } = await db.from('hub_mail_messages').select('id, connection_id, subject, summary, category, received_at')
      .in('connection_id', ids).ilike('from_address', likeExact(e)).order('received_at', { ascending: false }).limit(LIMIT)
    if (mErr) throw fail('hub_mail_messages', mErr)
    for (const m of (data ?? []) as any[]) if (m.received_at && box.has(m.connection_id)) out.push(inboundEmail(viewer, box.get(m.connection_id)!, m))
  }
  // hub_236: absent before it is applied, so a missing table is no rows, not an error
  const { data: sent, error: sErr } = await db.from('hub_mail_sent').select('id, connection_id, sent_at')
    .in('connection_id', ids).in('to_address', s.emails).order('sent_at', { ascending: false }).limit(LIMIT)
  if (!sErr) for (const x of (sent ?? []) as any[]) if (box.has(x.connection_id)) out.push(outboundEmail(viewer, box.get(x.connection_id)!, x))
  return out
}

async function texts(db: SupabaseClient, s: Subject): Promise<Touch[]> {
  const { data: convs, error } = await db.from('conversations').select('id').in('contact_id', s.ids)
  if (error) throw fail('conversations', error)
  const rows: any[] = []
  const cols = 'id, direction, status, sent_by, sent_at, created_at, msg_type, from_e164, to_e164'
  if (convs?.length) {
    const { data, error: mErr } = await db.from('crm_messages').select(cols).in('conversation_id', convs.map((c: any) => c.id))
      .order('created_at', { ascending: false }).limit(LIMIT)
    if (mErr) throw fail('crm_messages', mErr)
    rows.push(...(data ?? []))
  }
  // texts on a conversation that is not linked to the contact, matched by the contact's phones
  for (const [col, ph] of s.phones.flatMap((p) => [['from_e164', p], ['to_e164', p]] as const)) {
    const { data, error: pErr } = await db.from('crm_messages').select(cols).eq('org_id', s.orgId).eq(col, ph)
      .order('created_at', { ascending: false }).limit(LIMIT)
    if (pErr) throw fail('crm_messages', pErr)
    rows.push(...(data ?? []))
  }
  const seen = new Set<string>()
  const list = rows.filter((m) => !seen.has(m.id) && seen.add(m.id))
  const who = await names(db, 'team_profiles', 'user_id', list.map((m) => m.sent_by))
  return list.map((m) => {
    const out = m.direction === 'outbound'
    const what = m.msg_type && m.msg_type !== 'sms' ? String(m.msg_type).toUpperCase() : 'Text'
    const status = m.status && !['received', 'sent', 'delivered'].includes(m.status) ? ` (${m.status})` : ''
    return touch({ id: `text:${m.id}`, type: 'text', direction: out ? 'out' : 'in', at: m.sent_at ?? m.created_at,
      who: out ? who.get(m.sent_by) ?? null : null, summary: `${what} ${out ? 'sent' : 'received'}${status}` })
  })
}

async function calls(db: SupabaseClient, s: Subject): Promise<Touch[]> {
  const cols = 'id, direction, status, started_at, created_at, duration_seconds, ai_summary, team_member_id'
  const rows: any[] = []
  const { data, error } = await db.from('call_logs').select(cols).in('contact_id', s.ids).order('created_at', { ascending: false }).limit(LIMIT)
  if (error) throw fail('call_logs', error)
  rows.push(...(data ?? []))
  for (const [col, ph] of s.phones.flatMap((p) => [['from_number', p], ['to_number', p]] as const)) {
    const { data: more, error: pErr } = await db.from('call_logs').select(cols).eq('org_id', s.orgId).eq(col, ph).limit(LIMIT)
    if (pErr) throw fail('call_logs', pErr)
    rows.push(...(more ?? []))
  }
  const seen = new Set<string>()
  const list = rows.filter((c) => !seen.has(c.id) && seen.add(c.id))
  const who = await names(db, 'team_members', 'id', list.map((c) => c.team_member_id))
  return list.map((c) => {
    const mins = c.duration_seconds ? `${Math.max(1, Math.round(c.duration_seconds / 60))} min` : ''
    const head = [c.direction === 'outbound' ? 'Call out' : 'Call in', c.status && c.status !== 'completed' ? c.status : '', mins].filter(Boolean).join(', ')
    const ai = String(c.ai_summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
    return touch({ id: `call:${c.id}`, type: 'call', direction: c.direction === 'outbound' ? 'out' : 'in', at: c.started_at ?? c.created_at,
      who: who.get(c.team_member_id) ?? null, summary: ai ? `${head}: ${ai}` : head })
  })
}

async function meetings(db: SupabaseClient, s: Subject): Promise<Touch[]> {
  const { data: syncs, error } = await db.from('hub_booking_syncs').select('booking_id, appointment_type, starts_at, status').in('contact_id', s.ids).limit(LIMIT)
  if (error) throw fail('hub_booking_syncs', error)
  const typeOf = new Map(((syncs ?? []) as any[]).map((b) => [b.booking_id, b.appointment_type as string]))
  // University bookings by the guest's profile or booking lead (coaching sessions are not synced), read only
  const profileIds: string[] = [], leadIds: string[] = []
  for (const e of s.emails) {
    const [{ data: p, error: pErr }, { data: l, error: lErr }] = await Promise.all([
      db.from('profiles').select('id').ilike('email', likeExact(e)).limit(5),
      db.from('nr_booking_leads').select('id').eq('org_id', s.orgId).ilike('email', likeExact(e)).limit(5),
    ])
    if (pErr) throw fail('profiles', pErr)
    if (lErr) throw fail('nr_booking_leads', lErr)
    profileIds.push(...(p ?? []).map((x: any) => x.id)); leadIds.push(...(l ?? []).map((x: any) => x.id))
  }
  const cols = 'id, appointment_type_id, facilitator_id, starts_at, status'
  const rows: any[] = []
  const byIds = async (col: 'id' | 'participant_id' | 'lead_id', ids: string[]) => {
    if (!ids.length) return
    const { data, error: bErr } = await db.from('nr_bookings').select(cols).in(col, uniq(ids)).order('starts_at', { ascending: false }).limit(LIMIT)
    if (bErr) throw fail('nr_bookings', bErr)
    rows.push(...(data ?? []))
  }
  await byIds('id', Array.from(typeOf.keys()))
  await byIds('participant_id', profileIds)
  await byIds('lead_id', leadIds)
  const seen = new Set<string>()
  const list = rows.filter((b) => !seen.has(b.id) && seen.add(b.id))
  const typeIds = uniq(list.map((b) => b.appointment_type_id))
  const typeName = new Map<string, string>()
  if (typeIds.length) {
    const { data: types, error: tErr } = await db.from('nr_appointment_types').select('id, name').in('id', typeIds)
    if (tErr) throw fail('nr_appointment_types', tErr)
    for (const t of (types ?? []) as any[]) typeName.set(t.id, t.name)
  }
  const who = await names(db, 'profiles', 'id', list.map((b) => b.facilitator_id))
  const STATUS: Record<string, string> = { confirmed: 'booked', arrived: 'held', no_show: 'missed', cancelled: 'cancelled', released: 'released', payment_failed: 'payment failed' }
  return list.map((b) => touch({ id: `booking:${b.id}`, type: 'meeting', direction: null, at: b.starts_at, who: who.get(b.facilitator_id) ?? null,
    summary: `${typeName.get(b.appointment_type_id) ?? typeOf.get(b.id) ?? 'Booking'}, ${STATUS[b.status] ?? b.status}` }))
}

async function campaigns(db: SupabaseClient, s: Subject): Promise<Touch[]> {
  const [{ data: logs, error }, { data: sends, error: sErr }] = await Promise.all([
    db.from('send_log').select('id, campaign_id, message_send_id, channel, decision, mode, step, reason, created_at').in('contact_id', s.ids)
      .order('created_at', { ascending: false }).limit(LIMIT),
    db.from('message_sends').select('id, channel, status, dry_run, skip_reason, sent_at, claimed_at').in('contact_id', s.ids).limit(LIMIT),
  ])
  if (error) throw fail('send_log', error)
  if (sErr) throw fail('message_sends', sErr)
  const campIds = uniq(((logs ?? []) as any[]).map((l) => l.campaign_id))
  const campName = new Map<string, string>()
  if (campIds.length) {
    const { data, error: cErr } = await db.from('funnel_campaigns').select('id, name').in('id', campIds)
    if (cErr) throw fail('funnel_campaigns', cErr)
    for (const c of (data ?? []) as any[]) campName.set(c.id, c.name)
  }
  const logged = new Set(((logs ?? []) as any[]).map((l) => l.message_send_id).filter(Boolean))
  const chan = (c: string) => (c === 'sms' ? 'text' : 'email')
  // send_log.decision is the send gate's: allow (sent, or would send in a dry run) or deny (skipped, with the reason)
  const verdict = (l: any) => l.decision === 'allow'
    ? (l.mode === 'dry_run' ? 'would send (dry run)' : 'sent')
    : `skipped${l.reason ? ` (${String(l.reason).replace(/_/g, ' ')})` : ''}${l.mode === 'dry_run' ? ', dry run' : ''}`
  const out: Touch[] = ((logs ?? []) as any[]).map((l) => touch({
    id: `send_log:${l.id}`, type: 'campaign', direction: 'out', at: l.created_at, who: null,
    summary: `${campName.get(l.campaign_id) ?? 'Campaign'}${l.step ? `, step ${l.step}` : ''}: ${chan(l.channel)} ${verdict(l)}`,
  }))
  for (const m of (sends ?? []) as any[]) {
    if (logged.has(m.id)) continue
    out.push(touch({ id: `send:${m.id}`, type: 'campaign', direction: 'out', at: m.sent_at ?? m.claimed_at, who: null,
      summary: `Campaign ${chan(m.channel)} ${m.status}${m.dry_run ? ' (dry run)' : ''}${m.skip_reason ? `, ${m.skip_reason}` : ''}` }))
  }
  return out.filter((t) => t.at)
}

/** Superadmins only: the lifecycle engine's dry-run rows, as muted "would have" rows. Never queried for anyone else. */
async function lifecycle(db: SupabaseClient, viewer: Viewer, s: Subject): Promise<Touch[]> {
  if (!viewer.isSuperadmin) return []
  const { data, error } = await db.from('hub_lifecycle_events').select('id, event_type, occurred_at, mode').in('contact_id', s.ids).eq('mode', 'dry_run')
    .order('occurred_at', { ascending: false }).limit(LIMIT)
  if (error) return [] // absent before hub_237: no rows
  return ((data ?? []) as any[]).map((e) => touch({ id: `lifecycle:${e.id}`, type: 'lifecycle', direction: null, at: e.occurred_at, who: null,
    summary: `Would have: ${EVENT_TITLE[e.event_type as EventType] ?? e.event_type}`, muted: true }))
}

export async function loadCommunications(db: SupabaseClient, viewer: Viewer, s: Subject): Promise<Touch[]> {
  const parts = await Promise.all([mail(db, viewer, s), texts(db, s), calls(db, s), meetings(db, s), campaigns(db, s), lifecycle(db, viewer, s)])
  return sortTouches(parts.flat().filter((t) => t.at)).slice(0, 500)
}
