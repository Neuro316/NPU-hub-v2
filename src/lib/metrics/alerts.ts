// src/lib/metrics/alerts.ts
// Growth Dashboard texts to Cameron (Step 5). The Hub has no push channel (gap G12), so
// every alert is a text through public.hub_sms_outbox, drained by /api/cron/sms-outbox.
//   monday_scorecard        Monday 08:05 New York: last week's lead metrics vs target (Phase 1
//                           sales, Phase 2/3 conversion, coaching load, core revenue, leads, booked
//                           calls, shows) and the biggest funnel drop-off
//   no_leads_48h            no new scorecard lead in 48 hours (at most once a day)
//   speed_to_lead           today's median speed to lead is over 60 minutes (once a day)
//   cron_failed:<job>       a job's last two finished runs failed (once per failure streak).
//                           Jobs the existing watchdog already covers are left to it.
// Each alert is claimed in hub_metric_alerts (primary key alert_key + period_key) before it
// is queued, so an hourly check never texts the same thing twice. No contact details or
// message content are logged.
import type { SupabaseClient } from '@supabase/supabase-js'
import { EXPECTED_JOBS } from '@/lib/marketing/watchdog'
import { summarize, biggestDropOff, FUNNEL } from './summary'
import { addDays, monthStart, nyClock, nyDay } from './dates'
import { COACHING_HOURS_PER_MONTH, COMMITTED_WEEKS } from './registry'
import { leadChannel, SCORECARD_CHANNELS } from './collect'
import { loadTestFilter } from './test-filter'

export const RECIPIENT = '22456608-5f7d-495e-af02-7037fea125cc' // Cameron's Hub profile (the watchdog's default recipient)
const NP_ORG = '00000000-0000-0000-0000-000000000001'
export const SPEED_TO_LEAD_LIMIT_MIN = 60

const n0 = (v: number | null | undefined) => Math.round(v ?? 0).toLocaleString('en-US')
const usd = (v: number | null | undefined) => `$${Math.round(v ?? 0).toLocaleString('en-US')}`
const hrs = (v: number | null | undefined) => { const r = Math.round((v ?? 0) * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1) }
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** Claims the alert, then queues the text; a failed queue releases the claim for a retry. */
async function sendOnce(db: SupabaseClient, alertKey: string, periodKey: string, body: string, detail: Record<string, unknown>): Promise<boolean> {
  const claim = await db.from('hub_metric_alerts').insert({ alert_key: alertKey, period_key: periodKey, detail })
  if (claim.error) {
    if (claim.error.code === '23505') return false // already sent for this period
    throw new Error(`alert claim failed: ${claim.error.code}`)
  }
  const q = await db.from('hub_sms_outbox').insert({ org_id: NP_ORG, user_id: RECIPIENT, body, source: alertKey === 'monday_scorecard' ? 'growth-scorecard' : 'growth-alert' }).select('id')
  if (q.error || (q.data?.length ?? 0) !== 1) {
    await db.from('hub_metric_alerts').delete().eq('alert_key', alertKey).eq('period_key', periodKey)
    throw new Error(`outbox insert failed: ${q.error?.code ?? 'no row'}`)
  }
  return true
}

export async function mondayScorecardText(db: SupabaseClient, today: string): Promise<string> {
  const to = addDays(today, -1), from = addDays(today, -7) // last Monday to Sunday
  const [s, month, cohorts] = await Promise.all([
    summarize(db, from, to, today),
    summarize(db, monthStart(today), today, today),       // coaching this month runs to the month's end
    summarize(db, addDays(today, -90), to, today),        // Phase 1 cohorts of the last 90 days
  ])
  const m = s.metrics
  const tgt = (t: { target?: number; status?: string } | undefined, f: (v: number) => string) =>
    t?.target != null ? ` / ${f(t.target)} target${t.status ? ` (${t.status})` : ''}` : ''
  const line = (label: string, key: string, money = false) => {
    const t = m[key], f = money ? usd : n0
    return `${label}: ${f(t?.value)}${tgt(t, f)}`
  }
  const conv = cohorts.metrics.phase23_conversion
  const convText = conv?.value == null ? 'no Phase 1 buyers yet'
    : `${Math.round(conv.value)}%${tgt(conv, v => `${Math.round(v)}%`)}`
  const booked = month.metrics.coaching_hours_booked
  const cap = booked?.target ?? COACHING_HOURS_PER_MONTH
  const committed = month.metrics.coaching_committed_hours?.value ?? 0
  const drop = biggestDropOff(Object.fromEntries(FUNNEL.map(([k]) => [k, m[k]?.value ?? 0])))
  return [
    `NP scorecard, ${fmtDay(from)}–${fmtDay(to)}`,
    line('Phase 1 sales', 'phase1_sales'),
    `Phase 2/3 conversion (90-day cohorts): ${convText}`,
    `Coaching: ${hrs(booked?.value)} of ${hrs(cap)} hours booked, ${hrs(committed)} committed in the next ${COMMITTED_WEEKS} weeks`,
    line('Core revenue', 'core_revenue', true),
    line('Leads', 'leads'),
    line('Booked calls', 'booked_calls'),
    line('Shows', 'shows'),
    drop ? `Biggest drop-off: ${drop}` : 'Biggest drop-off: not enough data',
    'Hub › Analytics for detail',
  ].join('\n')
}

export async function runAlerts(db: SupabaseClient, now: Date): Promise<Record<string, unknown>> {
  const clock = nyClock(now)
  const today = clock.day
  const sent: string[] = []

  // Monday 08:05 New York (the hourly run at :05 lands on it in both EST and EDT)
  if (clock.weekday === 1 && clock.hour === 8) {
    const body = await mondayScorecardText(db, today)
    if (await sendOnce(db, 'monday_scorecard', today, body, { week_ending: addDays(today, -1) })) sent.push('monday_scorecard')
  }

  // no new scorecard lead in 48 hours
  const filter = await loadTestFilter(db)
  const since = new Date(now.getTime() - 48 * 3_600_000).toISOString()
  const { data: recent, error } = await db.from('contacts').select('id, email, phone, tags, source').is('merged_into_id', null).gte('created_at', since).limit(1000)
  if (error) throw new Error(`contacts read failed: ${error.code}`)
  const leads48 = (recent ?? []).filter(c => !filter.isTestContact(c) && SCORECARD_CHANNELS(leadChannel(c.source))).length
  if (leads48 === 0 && await sendOnce(db, 'no_leads_48h', today, 'NP alert: no new leads in the last 48 hours. Hub › Analytics › Acquisition.', { leads48 })) sent.push('no_leads_48h')

  // today's median speed to lead
  const { data: stl } = await db.from('hub_metrics_daily').select('value').eq('date', today).eq('metric_key', 'speed_to_lead').eq('dimension_key', '').maybeSingle()
  const { count: stlN } = await db.from('hub_metrics_daily').select('date', { count: 'exact', head: true }).eq('date', today).eq('metric_key', 'speed_to_lead').eq('dimension_key', 'item')
  if (stl && Number(stl.value) > SPEED_TO_LEAD_LIMIT_MIN) {
    const body = `NP alert: speed to lead today is ${Math.round(Number(stl.value))} min (median of ${stlN ?? 0} new lead${stlN === 1 ? '' : 's'}), over the ${SPEED_TO_LEAD_LIMIT_MIN} min limit. Hub › Analytics › Acquisition.`
    if (await sendOnce(db, 'speed_to_lead', today, body, { minutes: Math.round(Number(stl.value)), n: stlN ?? 0 })) sent.push('speed_to_lead')
  }

  // any cron failing twice in a row (the watchdog already texts for its own jobs)
  const watched = new Set(EXPECTED_JOBS.map(j => j.job))
  const { data: runs, error: runErr } = await db.from('job_runs').select('id, job, started_at, finished_at, ok')
    .not('finished_at', 'is', null).gte('started_at', new Date(now.getTime() - 7 * 86_400_000).toISOString())
    .order('started_at', { ascending: false }).limit(2000)
  if (runErr) throw new Error(`job_runs read failed: ${runErr.code}`)
  const byJob = new Map<string, any[]>()
  for (const r of runs ?? []) byJob.set(r.job, [...(byJob.get(r.job) ?? []), r])
  for (const [job, list] of Array.from(byJob.entries())) {
    if (watched.has(job) || list.length < 2 || list[0].ok || list[1].ok) continue
    let i = 0
    while (i + 1 < list.length && !list[i + 1].ok) i++
    const streakStart = list[i] // the oldest failure in the current streak
    const key = `cron_failed:${job}`.toLowerCase().replace(/[^a-z0-9_:.-]/g, '-')
    const body = `NP alert: the ${job} job has failed ${i + 1} times in a row (last at ${new Date(list[0].finished_at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' })}). Hub › Analytics › Operations health.`
    if (await sendOnce(db, key, String(streakStart.id).slice(0, 40), body, { job, failures: i + 1 })) sent.push(key)
  }
  return { sent, leads48, speed_to_lead_today: stl ? Number(stl.value) : null, day: nyDay(now) }
}
