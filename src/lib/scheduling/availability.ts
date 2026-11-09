// src/lib/scheduling/availability.ts
// Pure: the bookable-slot generator for the scheduling reply drafts. No I/O and no imports, so
// scripts/scheduling/availability-check.mjs runs it directly (node --experimental-strip-types).
// availability-load.ts reads the rows (read-only) and the hub_sched_check verdicts, then calls this.
//
// A slot is offered only when ALL of these hold (the rule check is passed in as `isAllowed`):
//   - on one of the next HORIZON_DAYS business days (Mon to Fri), starting the next business day, never today
//   - on the 30-minute grid in the owner's zone
//   - the meeting sits inside a University availability window (merged with `extra` overrides)
//   - the meeting plus its buffer overlaps no `block` override
//   - the meeting plus its buffer overlaps no busy interval: busy from a University busy-cache snapshot counts
//     only when that snapshot's [window_from, window_to] covers the slot; the Hub's own busy events always count
//     (ruled: they only ever remove slots)
//   - hub_sched_check(owner, category, start, end).allowed
// Picking spreads across days first (one per day, earliest first), then fills from the earliest left.

export type SchedCategory = 'one_on_one' | 'podcast' | 'in_person' | 'group_coaching' | 'team_familiar'

export const HORIZON_DAYS = 10
export const GRID_MINUTES = 30
export const MAX_SLOTS = 3

/** Meeting length and the free time required after it, in minutes. */
export const DURATIONS: Record<SchedCategory, { minutes: number; bufferAfter: number }> = {
  one_on_one: { minutes: 30, bufferAfter: 10 },
  podcast: { minutes: 60, bufferAfter: 0 },
  in_person: { minutes: 60, bufferAfter: 0 },
  team_familiar: { minutes: 30, bufferAfter: 0 },
  group_coaching: { minutes: 60, bufferAfter: 0 },
}

export interface WindowRow {
  /** as nr_availability_windows stores them; 0 and 7 are both read as Sunday, 1 = Monday */
  weekdays: number[]
  start_time: string
  end_time: string
  timezone: string
}
export interface OverrideRow { kind: 'block' | 'extra' | string; starts_at: string; ends_at: string }
export interface BusySnapshot { window_from: string; window_to: string; busy: { start: string; end: string }[] }
export interface Interval { start: string; end: string }

export interface AvailabilityInput {
  now: string
  tz: string
  category: SchedCategory
  windows: WindowRow[]
  overrides: OverrideRow[]
  snapshots: BusySnapshot[]
  hubBusy: Interval[]
}

export interface Slot { start: string; end: string; date: string }

// ─── zone arithmetic ─────────────────────────────────────────────────────────
const FMT = new Map<string, Intl.DateTimeFormat>()
function fmt(tz: string): Intl.DateTimeFormat {
  let f = FMT.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    })
    FMT.set(tz, f)
  }
  return f
}

interface Wall { y: number; m: number; d: number; h: number; mi: number }
export function wallOf(ms: number, tz: string): Wall {
  const parts = fmt(tz).formatToParts(new Date(ms))
  const n = (k: string) => Number(parts.find((p) => p.type === k)?.value)
  return { y: n('year'), m: n('month'), d: n('day'), h: n('hour') % 24, mi: n('minute') }
}

const pad = (n: number) => String(n).padStart(2, '0')
const dateOf = (w: Wall) => `${w.y}-${pad(w.m)}-${pad(w.d)}`

function parseDate(date: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) throw new Error('bad_date')
  return { y: +m[1], m: +m[2], d: +m[3] }
}

/** The instant of a wall-clock time in `tz`, or null when that wall time does not exist (spring-forward gap). */
export function zonedMs(date: string, h: number, mi: number, tz: string): number | null {
  const p = parseDate(date)
  const target = Date.UTC(p.y, p.m - 1, p.d, h, mi)
  let t = target
  for (let i = 0; i < 3; i++) {
    const w = wallOf(t, tz)
    const diff = target - Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi)
    if (diff === 0) return t
    t += diff
  }
  const w = wallOf(t, tz)
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi) === target ? t : null
}

export function addDays(date: string, n: number): string {
  const p = parseDate(date)
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d, 12) + n * 86_400_000)
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** ISO weekday of a calendar date: 1 = Monday .. 7 = Sunday. */
export function isoWeekday(date: string): number {
  const p = parseDate(date)
  return ((new Date(Date.UTC(p.y, p.m - 1, p.d, 12)).getUTCDay() + 6) % 7) + 1
}

export function localDate(ms: number, tz: string): string {
  return dateOf(wallOf(ms, tz))
}

/** The next `n` Mon to Fri dates in `tz`, starting the day after today (today is never included). */
export function businessDays(now: string, tz: string, n = HORIZON_DAYS): string[] {
  const out: string[] = []
  let d = localDate(Date.parse(now), tz)
  while (out.length < n) {
    d = addDays(d, 1)
    if (isoWeekday(d) <= 5) out.push(d)
  }
  return out
}

function hm(t: string): { h: number; mi: number } | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''))
  if (!m) return null
  const h = +m[1], mi = +m[2]
  return h <= 24 && mi < 60 ? { h, mi } : null
}

// ─── intervals ───────────────────────────────────────────────────────────────
interface Iv { s: number; e: number }

function merge(list: Iv[]): Iv[] {
  const sorted = list.filter((x) => x.e > x.s).sort((a, b) => a.s - b.s)
  const out: Iv[] = []
  for (const x of sorted) {
    const last = out[out.length - 1]
    if (last && x.s <= last.e) last.e = Math.max(last.e, x.e)
    else out.push({ s: x.s, e: x.e })
  }
  return out
}

const overlaps = (a: Iv, b: Iv) => a.s < b.e && b.s < a.e
const toIv = (i: { start: string; end: string }): Iv | null => {
  const s = Date.parse(i.start), e = Date.parse(i.end)
  return Number.isFinite(s) && Number.isFinite(e) && e > s ? { s, e } : null
}

function windowIntervals(windows: WindowRow[], dates: string[]): Iv[] {
  const out: Iv[] = []
  if (!dates.length) return out
  // one day either side, so a window in another zone that lands on a horizon date is not missed
  const all = [addDays(dates[0], -1), ...dates.map((d) => d), addDays(dates[dates.length - 1], 1)]
  for (const w of windows) {
    const s = hm(w.start_time), e = hm(w.end_time)
    if (!s || !e || !w.timezone) continue
    const days = new Set((w.weekdays ?? []).map((x) => (Number(x) === 0 ? 7 : Number(x))))
    for (const d of all) {
      if (!days.has(isoWeekday(d))) continue
      let a: number | null, b: number | null
      try { a = zonedMs(d, s.h, s.mi, w.timezone); b = zonedMs(d, e.h, e.mi, w.timezone) } catch { continue }
      if (a != null && b != null && b > a) out.push({ s: a, e: b })
    }
  }
  return out
}

// ─── the generator ───────────────────────────────────────────────────────────
export interface Candidates {
  /** inside windows, not blocked, not busy: in time order */
  free: Slot[]
  /** inside windows and not blocked, busy ignored (for the exception request's requested time) */
  ignoringBusy: Slot[]
}

export function candidateSlots(input: AvailabilityInput): Candidates {
  const dur = DURATIONS[input.category]
  if (!dur) return { free: [], ignoringBusy: [] }
  const dates = businessDays(input.now, input.tz)
  const nowMs = Date.parse(input.now)

  const ov = (kind: string) => input.overrides.filter((o) => o.kind === kind)
    .map((o) => toIv({ start: o.starts_at, end: o.ends_at })).filter((x): x is Iv => !!x)
  const extras = ov('extra')
  const blocks = ov('block')
  const open = merge([...windowIntervals(input.windows, dates), ...extras])
  const hubBusy = input.hubBusy.map(toIv).filter((x): x is Iv => !!x)
  const snaps = input.snapshots.map((sn) => {
    const cover = toIv({ start: sn.window_from, end: sn.window_to })
    const busy = (Array.isArray(sn.busy) ? sn.busy : []).map((b) => (b && typeof b === 'object' ? toIv(b) : null)).filter((x): x is Iv => !!x)
    return cover ? { cover, busy } : null
  }).filter((x): x is { cover: Iv; busy: Iv[] } => !!x)

  const free: Slot[] = []
  const ignoringBusy: Slot[] = []
  for (const date of dates) {
    for (let minute = 0; minute < 24 * 60; minute += GRID_MINUTES) {
      const s = zonedMs(date, Math.floor(minute / 60), minute % 60, input.tz)
      if (s == null || s <= nowMs) continue
      const meeting: Iv = { s, e: s + dur.minutes * 60_000 }
      const occupied: Iv = { s, e: meeting.e + dur.bufferAfter * 60_000 }
      if (!open.some((w) => w.s <= meeting.s && meeting.e <= w.e)) continue
      if (blocks.some((b) => overlaps(b, occupied))) continue
      const slot: Slot = { start: new Date(meeting.s).toISOString(), end: new Date(meeting.e).toISOString(), date }
      ignoringBusy.push(slot)
      if (hubBusy.some((b) => overlaps(b, occupied))) continue
      const covering = snaps.filter((sn) => sn.cover.s <= occupied.s && occupied.e <= sn.cover.e)
      if (covering.some((sn) => sn.busy.some((b) => overlaps(b, occupied)))) continue
      free.push(slot)
    }
  }
  return { free, ignoringBusy }
}

/** Up to `max` slots: one per day first (earliest day, earliest time), then the earliest left over. Time order. */
export function pickSpread(slots: Slot[], max = MAX_SLOTS): Slot[] {
  const sorted = slots.slice().sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  const picked: Slot[] = []
  const days = new Set<string>()
  for (const s of sorted) {
    if (picked.length >= max) break
    if (!days.has(s.date)) { picked.push(s); days.add(s.date) }
  }
  for (const s of sorted) {
    if (picked.length >= max) break
    if (picked.indexOf(s) >= 0) continue
    if (picked.some((p) => Date.parse(p.start) < Date.parse(s.end) && Date.parse(s.start) < Date.parse(p.end))) continue
    picked.push(s)
  }
  return picked.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}

/** The whole pure pipeline: candidates, the rule verdicts, the spread. */
export function findSlots(input: AvailabilityInput, isAllowed: (s: Slot) => boolean = () => true, max = MAX_SLOTS): Slot[] {
  return pickSpread(candidateSlots(input).free.filter(isAllowed), max)
}

/** "Tue, Nov 11 at 10:00 AM" in `tz`, plain spaces only. */
export function slotLabel(iso: string, tz: string): string {
  const d = new Date(iso)
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(d)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d)
  return `${day} at ${time}`.replace(/[   ]/g, ' ')
}
