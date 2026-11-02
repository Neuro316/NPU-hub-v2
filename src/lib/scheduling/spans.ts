// src/lib/scheduling/spans.ts
// The recurring-block span model (hub_219), as pure functions shared by the API's
// validation and the Rules page's summary and preview. The database function
// public.hub_sched_recurring_blocked is the authority; this mirrors it for display.
//
//   span length  from == to → 8 days (both ends included, e.g. Wed..Wed); otherwise
//                the days from `from` forward to the next `to` (Wed..Tue = 7)
//   spans        start on anchor_date, then every interval_weeks weeks; none before it
//   offsets      0 = first day of the span ... length - 1 = last day

export const WEEKDAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const WEEKDAY_LONG = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const REPEATS = ['weekly', 'every_other_week', 'custom'] as const
export type Repeat = (typeof REPEATS)[number]

export function intervalFor(repeat: Repeat, n: number): number {
  return repeat === 'weekly' ? 1 : repeat === 'every_other_week' ? 2 : n
}

export function spanLength(from: number, to: number): number {
  return from === to ? 8 : ((to - from + 7) % 7) + 1
}

/** Each day of the span: its offset and ISO weekday. */
export function spanDays(from: number, to: number): { offset: number; weekday: number }[] {
  return Array.from({ length: spanLength(from, to) }, (_, offset) => ({ offset, weekday: ((from - 1 + offset) % 7) + 1 }))
}

/** ISO weekdays that occur in the span (for limiting the day chips). */
export function weekdaysInSpan(from: number, to: number): number[] {
  return Array.from(new Set(spanDays(from, to).map(d => d.weekday)))
}

// dates as YYYY-MM-DD, computed in UTC so no time zone shifts the day
const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
export const addDays = (d: string, n: number) => new Date(toUtc(d) + n * 86_400_000).toISOString().slice(0, 10)
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000)
export const isoWeekday = (d: string) => ((new Date(toUtc(d)).getUTCDay() + 6) % 7) + 1

/** True when `date` starts a regular span of the block (on or after the anchor). */
export function isRegularSpanStart(anchor: string, intervalWeeks: number, date: string): boolean {
  const diff = daysBetween(anchor, date)
  return diff >= 0 && diff % (7 * intervalWeeks) === 0
}

export interface SpanBlock {
  anchor_date: string | null
  interval_weeks: number
  from_weekday: number
  to_weekday: number
  days: number[]
  all_day: boolean
  start_time: string | null
  end_time: string | null
  per_day_times: boolean
  day_times: { span_offset: number; all_day: boolean; start_time: string | null; end_time: string | null }[]
}
export interface SpanOverride { date: string; kind: string }

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '')

/** What is blocked on one day of a span, e.g. "all day" or "15:00–16:00". */
export function dayTimes(b: SpanBlock, offset: number): string {
  const row = b.per_day_times ? b.day_times.find(d => d.span_offset === offset) : undefined
  const all = row ? row.all_day : b.all_day
  const s = row ? row.start_time : b.start_time
  const e = row ? row.end_time : b.end_time
  return all || !s || !e ? 'all day' : `${hhmm(s)}–${hhmm(e)}`
}

const fmt = (d: string) => new Date(toUtc(d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const fmtShort = (d: string) => new Date(toUtc(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** The next `count` spans starting on or after `today`: regular ones minus skip_span, plus add_span. */
export function nextSpans(b: SpanBlock, overrides: SpanOverride[], today: string, count: number) {
  if (!b.anchor_date) return []
  const len = spanLength(b.from_weekday, b.to_weekday)
  const step = 7 * b.interval_weeks
  const notOver = (s: string) => daysBetween(today, addDays(s, len - 1)) >= 0
  const skipped = new Set(overrides.filter(o => o.kind === 'skip_span').map(o => o.date))
  const starts = new Set(overrides.filter(o => o.kind === 'add_span' && notOver(o.date)).map(o => o.date))
  // regular spans from the first one that has not ended, enough to cover the skipped ones
  const k0 = Math.max(0, Math.floor((daysBetween(b.anchor_date, today) - (len - 1)) / step))
  for (let k = k0; k < k0 + count + skipped.size + 1; k++) {
    const s = addDays(b.anchor_date, k * step)
    if (notOver(s) && !skipped.has(s)) starts.add(s)
  }
  return Array.from(starts).sort().slice(0, count).map(start => ({
    start,
    end: addDays(start, len - 1),
    extra: !isRegularSpanStart(b.anchor_date!, b.interval_weeks, start),
    blocked: spanDays(b.from_weekday, b.to_weekday)
      .filter(d => b.days.includes(d.weekday))
      .map(d => ({ date: addDays(start, d.offset), offset: d.offset, label: `${fmt(addDays(start, d.offset))} ${dayTimes(b, d.offset)}` })),
  }))
}

/** "Every other week, Wed Nov 4 to Wed Nov 11, then Nov 18 to Nov 25, ..." */
export function summary(b: SpanBlock, repeat: Repeat, overrides: SpanOverride[], today: string): string {
  const how = repeat === 'weekly' ? 'Every week' : repeat === 'every_other_week' ? 'Every other week' : `Every ${b.interval_weeks} weeks`
  const spans = nextSpans(b, overrides, today, 3)
  if (!spans.length) return `${how}, ${WEEKDAY_LONG[b.from_weekday]} to ${WEEKDAY_LONG[b.to_weekday]}. Set a starting date to see the dates.`
  const [first, ...rest] = spans
  return `${how}, ${fmt(first.start)} to ${fmt(first.end)}${rest.map(s => `, then ${fmtShort(s.start)} to ${fmtShort(s.end)}`).join('')}, ...`
}
