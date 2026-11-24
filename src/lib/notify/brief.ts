// src/lib/notify/brief.ts
// Server only (service role). Builds one person's 8 AM brief from counts, and sends the day's briefs.
//
// Reads ids and counts only: never a mail subject, a message body or a contact name. University tables
// (nr_bookings) are read only. Sends go through public.hub_sms_outbox (drained by /api/cron/sms-outbox through
// sendNotifySms: the person's own profile phone, the consent gate, the Primary line).
import type { SupabaseClient } from '@supabase/supabase-js'
import { isImportedLead, leadChannel, SCORECARD_CHANNELS } from '@/lib/metrics/collect'
import { resolvedLeads } from '@/lib/touch/first-touch'
import { briefDue, composeBrief, maySend, nyParts, type BriefInput, type NotificationType, type Settings } from './rules'
import { HUB_URL, loadSettings } from './settings'
import { isClosedColumn } from './board'

export { DEFAULT_OWNER, HUB_URL, loadSettings } from './settings'
/** The one org hub_metrics_daily describes (it has no org column). */
export const METRICS_ORG = '00000000-0000-0000-0000-000000000001'
const fail = (what: string, e: { code?: string } | null) => new Error(`${what} read: ${e?.code ?? 'unknown'}`)

/** People who get a brief: every recipient of a rule that is not off. */
export function briefRecipients(s: Settings): string[] {
  return Array.from(new Set(Object.values(s.rules).filter((r) => r.urgency !== 'off' && r.recipient).map((r) => r.recipient as string)))
}

const mine = (s: Settings, userId: string, t: NotificationType) => s.rules[t].recipient === userId && s.rules[t].urgency !== 'off'

/** New York midnight today and tomorrow, as instants. */
function nyDayBounds(now: Date): { start: string; end: string; date: string } {
  const { date } = nyParts(now)
  // the New York offset today (-04:00 or -05:00), from the difference between the wall clock and UTC
  const wall = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), nyParts(now).hour, nyParts(now).minute)
  const offsetMin = Math.round((wall - now.getTime()) / 60_000 / 15) * 15
  const start = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) - offsetMin * 60_000
  return { date, start: new Date(start).toISOString(), end: new Date(start + 86_400_000).toISOString() }
}

/** The counts for one person's brief. `since` is the last brief (or 24 hours ago, 72 on a Monday). */
export async function gatherBrief(db: SupabaseClient, orgId: string, userId: string, s: Settings, now: Date, since: string): Promise<BriefInput> {
  const day = nyDayBounds(now)
  const input: BriefInput = { hubUrl: HUB_URL, newLeads: 0, tasksDueToday: 0, tasksOverdue: 0, stuckOnboarding: 0, discoveryCallsToday: 0, coachingToday: 0, flagged: 0, privateMail: [], welcomeEmailProblems: 0 }

  if (mine(s, userId, 'new_lead')) {
    const { data, error } = await db.from('contacts').select('id, source, import_batch_id').eq('org_id', orgId).is('merged_into_id', null).is('archived_at', null).gte('created_at', since).limit(1000)
    if (error) throw fail('contacts', error)
    // an imported contact is never a new lead (isImportedLead)
    const leads = (data ?? []).filter((c: any) => SCORECARD_CHANNELS(leadChannel(c.source)) && !isImportedLead(c))
    // a lead marked No reply needed is not counted (resolvedLeads, the one speed to lead check)
    const resolved = await resolvedLeads(db, leads.map((c: any) => c.id), now.getTime())
    input.newLeads = leads.filter((c: any) => !resolved.has(c.id)).length
  }
  if (mine(s, userId, 'follow_up_task')) {
    const { data, error } = await db.from('tasks').select('due_date').eq('org_id', orgId).eq('assigned_to', userId).in('status', ['todo', 'in_progress'])
      .not('due_date', 'is', null).lt('due_date', day.end).limit(1000)
    if (error) throw fail('tasks', error)
    for (const t of (data ?? []) as any[]) { if (t.due_date < day.start) input.tasksOverdue++; else input.tasksDueToday++ }
  }
  // hub_metrics_daily has no org column (its numbers are Neuro Progeny's), so the stuck line is only built for
  // Neuro Progeny until metrics are per org (Running List q34). Any other org's brief leaves it out.
  if (orgId === METRICS_ORG && mine(s, userId, 'stuck_onboarding')) {
    const { data, error } = await db.from('hub_metrics_daily').select('date, value').eq('metric_key', 'onboarding_stuck').eq('dimension_key', '')
      .order('date', { ascending: false }).limit(1)
    if (error) throw fail('hub_metrics_daily', error)
    input.stuckOnboarding = Number((data?.[0] as any)?.value ?? 0)
  }
  if (mine(s, userId, 'todays_calls')) {
    const { data: routes } = await db.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', 'hub_booking_type_routes').maybeSingle()
    const map = ((routes as any)?.setting_value ?? {}) as Record<string, { kind?: string }>
    const lead = Object.keys(map).filter((k) => map[k]?.kind === 'lead'), coach = Object.keys(map).filter((k) => map[k]?.kind === 'activity')
    const count = async (types: string[]) => {
      if (!types.length) return 0
      const { data, error } = await db.from('nr_bookings').select('id').in('appointment_type_id', types).in('status', ['confirmed', 'arrived'])
        .gte('starts_at', day.start).lt('starts_at', day.end).limit(500)
      if (error) throw fail('nr_bookings', error)
      return data?.length ?? 0
    }
    input.discoveryCallsToday = await count(lead)
    input.coachingToday = await count(coach)
  }
  if (mine(s, userId, 'flagged_task')) {
    const { data: cols } = await db.from('kanban_columns').select('id, title').eq('org_id', orgId)
    const closed = new Set(((cols ?? []) as any[]).filter((c) => isClosedColumn(c.title)).map((c) => c.id))
    const { data, error } = await db.from('kanban_tasks').select('column_id').eq('org_id', orgId).eq('owner_id', userId).eq('priority', 'urgent').is('completed_at', null).limit(500)
    if (error) throw fail('kanban_tasks', error)
    input.flagged = ((data ?? []) as any[]).filter((t) => !closed.has(t.column_id)).length
  }
  if (mine(s, userId, 'private_mail')) {
    // the person's own mailboxes only, ids only (a subject is never selected), and only mail RECEIVED since the last
    // brief: old unread mail is not news, so it never repeats every morning
    const { data: boxes } = await db.from('hub_mail_connections').select('id').eq('owner_user_id', userId).eq('status', 'active')
    const ids = ((boxes ?? []) as any[]).map((b) => b.id)
    if (ids.length) {
      const { data, error } = await db.from('hub_mail_messages').select('id').in('connection_id', ids).eq('status', 'new').gt('received_at', since).limit(1000)
      if (error) throw fail('hub_mail_messages', error)
      input.privateMail = ((data ?? []) as any[]).map(() => ({}))
    }
  }
  return input
}

/** When the person's last brief went out, or a default lookback. */
export async function lastBriefAt(db: SupabaseClient, orgId: string, userId: string, now: Date): Promise<string> {
  const { data } = await db.from('hub_brief_runs').select('created_at').eq('org_id', orgId).eq('user_id', userId).eq('mode', 'live')
    .order('created_at', { ascending: false }).limit(1)
  const back = nyParts(now).weekday === 1 ? 72 : 24
  return (data?.[0] as any)?.created_at ?? new Date(now.getTime() - back * 3_600_000).toISOString()
}

/**
 * The day's briefs for one org. Sends only when mode is live and it is a weekday between 08:05 and 08:59 New York
 * time; each person at most once per New York date (hub_brief_runs is unique on org, user and date, and the row is
 * claimed BEFORE the text is queued, so a second run that day queues nothing).
 */
export async function sendBriefs(db: SupabaseClient, orgId: string, now: Date): Promise<Record<string, number>> {
  const counts: Record<string, number> = { recipients: 0, queued: 0, already: 0, skipped: 0 }
  const s = await loadSettings(db, orgId)
  if (!maySend(s.mode) || !briefDue(now)) return { ...counts, skipped: 1 }
  const date = nyParts(now).date
  for (const userId of briefRecipients(s)) {
    counts.recipients++
    const since = await lastBriefAt(db, orgId, userId, now)
    const brief = composeBrief(await gatherBrief(db, orgId, userId, s, now, since))
    const { data: claim, error } = await db.from('hub_brief_runs').insert({ org_id: orgId, user_id: userId, brief_date: date, mode: 'live', line_count: brief.lines.length })
      .select('id').single()
    if (error?.code === '23505') { counts.already++; continue }
    if (error || !claim) throw new Error(`brief claim: ${error?.code ?? 'unknown'}`)
    const { data: q, error: qErr } = await db.from('hub_sms_outbox').insert({ org_id: orgId, user_id: userId, source: 'hub-brief', body: brief.text }).select('id').single()
    if (qErr) throw new Error(`brief queue: ${qErr.code ?? 'unknown'}`)
    await db.from('hub_brief_runs').update({ outbox_id: (q as any)?.id ?? null }).eq('id', (claim as any).id)
    counts.queued++
  }
  return counts
}
