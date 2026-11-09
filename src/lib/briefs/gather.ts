// src/lib/briefs/gather.ts
// Reads what the morning brief says, for ONE recipient (the configured owner). Read-only: nothing here writes.
//
//   meetings   hub_calendar_events of the recipient's own included calendars on the target ET date
//              (busy or not; all-day only when it has attendees), with a prep note per Hub contact attendee
//   awaiting   hub_mail_messages category 'scheduling', not done, in mailboxes the recipient may see
//   leads      contacts of the NPU org created in the last 24 hours, minus test records
//   urgent     hub_mail_messages priority 'urgent', not done, received in the last 7 days
//
// Mailboxes the recipient may see follow canSee in src/lib/mail/google.ts: their own, plus shared ones in the
// org when they are a superadmin. Calendar tables missing (hub_234 not applied) means no meetings, not an error.
// Never logs content: codes only.
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPositions } from '@/lib/pipelines/positions'
import { TEST_TAG } from '@/lib/lead-alerts/sources'
import { isMissingTable } from '@/lib/calendar/scopes'
import type { BriefData, BriefMeeting, PrepNote } from './compose'
import { externalAttendees, nameCandidates, normName, titleMentionsName } from './match'
import { etDayBounds, etDayLabel, etShortDate, etTime } from './time'

const MAX_MEETINGS = 25
const MAX_PREP_CONTACTS = 15

const like = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)
const fullName = (c: any) => [c?.first_name, c?.last_name].map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).join(' ')

interface Contact { id: string; name: string; email: string | null }

async function recipientScope(db: SupabaseClient, orgId: string, userId: string) {
  const [{ data: prof }, { data: conns, error }] = await Promise.all([
    db.from('profiles').select('email, role').eq('id', userId).maybeSingle(),
    db.from('hub_mail_connections').select('id, org_id, owner_user_id, email_address, visibility, status').neq('status', 'revoked'),
  ])
  if (error) throw new Error(`connections_read_${error.code ?? 'unknown'}`)
  const superadmin = (prof as any)?.role === 'superadmin'
  const rows = (conns ?? []) as any[]
  const owned = rows.filter((c) => c.owner_user_id === userId)
  const visible = rows.filter((c) => c.owner_user_id === userId || (superadmin && c.visibility === 'shared' && c.org_id === orgId))
  const own = [String((prof as any)?.email ?? ''), ...owned.map((c) => String(c.email_address))].map((e) => e.trim().toLowerCase()).filter(Boolean)
  return { ownedIds: owned.map((c) => c.id as string), visibleIds: visible.map((c) => c.id as string), own }
}

async function contactByEmail(db: SupabaseClient, orgId: string, email: string): Promise<Contact | null> {
  const { data, error } = await db.from('contacts').select('id, first_name, last_name, email')
    .eq('org_id', orgId).ilike('email', like(email)).is('merged_into_id', null).order('created_at', { ascending: true }).limit(1)
  if (error || !data?.length) return null
  const c = data[0] as any
  return { id: c.id, name: fullName(c) || email, email: c.email ?? null }
}

/** A title names exactly one contact (first + last on word boundaries), who is not the recipient. */
async function contactByTitle(db: SupabaseClient, orgId: string, title: string, own: string[]): Promise<Contact | null> {
  const found = new Map<string, Contact>()
  for (const [a, b] of nameCandidates(title)) {
    const { data, error } = await db.from('contacts').select('id, first_name, last_name, email')
      .eq('org_id', orgId).ilike('first_name', like(a)).ilike('last_name', like(b)).is('merged_into_id', null).limit(3)
    if (error) continue
    for (const c of (data ?? []) as any[]) {
      const name = fullName(c)
      if (!titleMentionsName(title, name)) continue
      if (c.email && own.includes(String(c.email).toLowerCase())) continue
      found.set(c.id, { id: c.id, name, email: c.email ?? null })
    }
    if (found.size > 1) return null
  }
  return found.size === 1 ? Array.from(found.values())[0] : null
}

async function prepFor(db: SupabaseClient, orgId: string, contacts: Contact[], mailboxIds: string[]): Promise<Map<string, PrepNote>> {
  const out = new Map<string, PrepNote>()
  if (!contacts.length) return out
  let stagesBy = new Map<string, string[]>()
  try {
    const pos = await loadPositions(db, orgId, { contactIds: contacts.map((c) => c.id) })
    for (const p of pos) {
      const list = stagesBy.get(p.contact_id) ?? []
      list.push(`${p.pipeline_name}: ${p.stage_name}`)
      stagesBy.set(p.contact_id, list)
    }
  } catch {
    stagesBy = new Map()
  }
  await Promise.all(contacts.map(async (c) => {
    const [{ data: bk }, mail] = await Promise.all([
      db.from('hub_booking_syncs').select('answers').eq('org_id', orgId).eq('contact_id', c.id).order('starts_at', { ascending: false }).limit(1),
      c.email && mailboxIds.length
        ? db.from('hub_mail_messages').select('subject, received_at').in('connection_id', mailboxIds).ilike('from_address', like(c.email))
          .order('received_at', { ascending: false }).limit(1)
        : Promise.resolve({ data: [] as any[] }),
    ])
    const answers = Array.isArray((bk as any)?.[0]?.answers) ? ((bk as any)[0].answers as any[]) : []
    const m = ((mail as any)?.data ?? [])[0]
    out.set(c.id, {
      name: c.name,
      stages: stagesBy.get(c.id) ?? [],
      answers: answers
        .filter((a) => a && typeof a.answer === 'string' && a.answer.trim())
        .map((a) => ({ label: String(a.label ?? a.key ?? ''), answer: String(a.answer) })),
      lastEmail: m ? { subject: m.subject ?? null, date: m.received_at ? etShortDate(m.received_at) : '' } : null,
    })
  }))
  return out
}

async function meetingsFor(db: SupabaseClient, orgId: string, date: string, scope: Awaited<ReturnType<typeof recipientScope>>): Promise<BriefMeeting[]> {
  if (!scope.ownedIds.length) return []
  const { data: cals, error: cErr } = await db.from('hub_calendar_calendars').select('id')
    .in('connection_id', scope.ownedIds).eq('excluded', false)
  if (isMissingTable(cErr)) return []
  if (cErr) throw new Error(`calendars_read_${cErr.code ?? 'unknown'}`)
  const calIds = ((cals ?? []) as any[]).map((c) => c.id as string)
  if (!calIds.length) return []
  const { start, end } = etDayBounds(date)
  const { data: evs, error } = await db.from('hub_calendar_events').select('google_event_id, starts_at, ends_at, all_day, title, attendee_emails')
    .in('calendar_id', calIds).lt('starts_at', end.toISOString()).gt('ends_at', start.toISOString()).order('starts_at').limit(200)
  if (isMissingTable(error)) return []
  if (error) throw new Error(`events_read_${error.code ?? 'unknown'}`)

  // one meeting per event, even when it sits on several of the recipient's calendars
  const seen = new Set<string>()
  const events = ((evs ?? []) as any[]).filter((e) => {
    if (e.all_day && !(e.attendee_emails ?? []).length) return false
    const k1 = `id:${e.google_event_id}`, k2 = `at:${e.starts_at}|${normName(String(e.title ?? ''))}`
    if (seen.has(k1) || seen.has(k2)) return false
    seen.add(k1); seen.add(k2)
    return true
  }).slice(0, MAX_MEETINGS)

  // who each meeting is with: attendee emails first, the title only when no attendee is a contact
  const byEmail = new Map<string, Contact | null>()
  const people: Contact[][] = []
  for (const e of events) {
    const found: Contact[] = []
    for (const email of externalAttendees(e.attendee_emails ?? [], scope.own)) {
      if (!byEmail.has(email)) byEmail.set(email, await contactByEmail(db, orgId, email))
      const c = byEmail.get(email)
      if (c && !found.some((x) => x.id === c.id)) found.push(c)
    }
    if (!found.length && e.title) {
      const c = await contactByTitle(db, orgId, String(e.title), scope.own)
      if (c) found.push(c)
    }
    people.push(found)
  }
  const unique = new Map<string, Contact>()
  people.forEach((list) => list.forEach((c) => { if (unique.size < MAX_PREP_CONTACTS || unique.has(c.id)) unique.set(c.id, c) }))
  const notes = await prepFor(db, orgId, Array.from(unique.values()), scope.visibleIds)

  return events.map((e, i) => ({
    time: e.all_day ? 'All day' : etTime(e.starts_at),
    title: e.title ?? null,
    prep: people[i].map((c) => notes.get(c.id)).filter((p): p is PrepNote => !!p),
  }))
}

async function awaitingFor(db: SupabaseClient, mailboxIds: string[]): Promise<BriefData['awaiting']> {
  if (!mailboxIds.length) return { count: 0, items: [] }
  const { data, count, error } = await db.from('hub_mail_messages').select('from_name, from_address, subject', { count: 'exact' })
    .in('connection_id', mailboxIds).eq('category', 'scheduling').neq('status', 'done')
    .order('received_at', { ascending: false }).limit(5)
  if (error) throw new Error(`awaiting_read_${error.code ?? 'unknown'}`)
  return {
    count: count ?? data?.length ?? 0,
    items: ((data ?? []) as any[]).map((m) => ({ from: m.from_name || m.from_address || null, subject: m.subject ?? null })),
  }
}

async function leadsFor(db: SupabaseClient, orgId: string, now: Date): Promise<BriefData['leads']> {
  const { data, error } = await db.from('contacts').select('first_name, last_name, tags')
    .eq('org_id', orgId).gte('created_at', new Date(now.getTime() - 24 * 3600_000).toISOString())
    .is('merged_into_id', null).order('created_at', { ascending: false }).limit(500)
  if (error) throw new Error(`leads_read_${error.code ?? 'unknown'}`)
  const real = ((data ?? []) as any[]).filter((c) => !(Array.isArray(c.tags) && c.tags.includes(TEST_TAG)))
  return { count: real.length, names: real.slice(0, 5).map((c) => fullName(c) || 'Name not given') }
}

async function urgentFor(db: SupabaseClient, mailboxIds: string[], now: Date): Promise<BriefData['urgent']> {
  if (!mailboxIds.length) return { count: 0, subjects: [] }
  const { data, count, error } = await db.from('hub_mail_messages').select('subject', { count: 'exact' })
    .in('connection_id', mailboxIds).eq('priority', 'urgent').neq('status', 'done')
    .gte('received_at', new Date(now.getTime() - 7 * 24 * 3600_000).toISOString())
    .order('received_at', { ascending: false }).limit(5)
  if (error) throw new Error(`urgent_read_${error.code ?? 'unknown'}`)
  return { count: count ?? data?.length ?? 0, subjects: ((data ?? []) as any[]).map((m) => m.subject ?? null) }
}

/** Everything the brief for `date` (ET, YYYY-MM-DD) says, for this recipient. */
export async function gatherBrief(db: SupabaseClient, orgId: string, userId: string, date: string, day: BriefData['day'], now: Date): Promise<BriefData> {
  const scope = await recipientScope(db, orgId, userId)
  const [meetings, awaiting, leads, urgent] = await Promise.all([
    meetingsFor(db, orgId, date, scope),
    awaitingFor(db, scope.visibleIds),
    leadsFor(db, orgId, now),
    urgentFor(db, scope.visibleIds, now),
  ])
  return { dayLabel: etDayLabel(date), day, meetings, awaiting, leads, urgent }
}
