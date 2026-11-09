// src/lib/briefs/time.ts
// Pure: Eastern-time arithmetic for the morning brief. No I/O and no imports, so
// scripts/briefs/brief-check.mjs runs it directly (node --experimental-strip-types).
//
// The brief goes out when the America/New_York wall clock reads 8 o'clock, in EST and in EDT alike.

export const BRIEF_TZ = 'America/New_York'
export const MORNING_HOUR = 8

interface Wall { y: number; m: number; d: number; h: number; mi: number }

function wall(t: Date): Wall {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRIEF_TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(t)
  const n = (k: string) => Number(parts.find((p) => p.type === k)?.value)
  return { y: n('year'), m: n('month'), d: n('day'), h: n('hour') % 24, mi: n('minute') }
}

/** The UTC instant of an ET wall-clock time (DST-safe: offset read at the guess, then rechecked). */
export function etInstant(y: number, m: number, d: number, h = 0, mi = 0): Date {
  const target = Date.UTC(y, m - 1, d, h, mi)
  let t = target
  for (let i = 0; i < 2; i++) {
    const w = wall(new Date(t))
    t += target - Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi)
  }
  return new Date(t)
}

/** The ET hour (0-23) at this instant. */
export function etHour(t: Date): number {
  return wall(t).h
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The ET calendar date at this instant, as YYYY-MM-DD. */
export function etDate(t: Date): string {
  const w = wall(t)
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`
}

function parseDate(date: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) throw new Error('bad_date')
  return { y: +m[1], m: +m[2], d: +m[3] }
}

/** YYYY-MM-DD plus n calendar days (computed on UTC noon, so DST cannot skip or repeat a day). */
export function addDays(date: string, n: number): string {
  const p = parseDate(date)
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d, 12) + n * 86400_000)
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** [start, end) of an ET calendar day as UTC instants. 23 or 25 hours long on DST days. */
export function etDayBounds(date: string): { start: Date; end: Date } {
  const p = parseDate(date)
  const n = parseDate(addDays(date, 1))
  return { start: etInstant(p.y, p.m, p.d), end: etInstant(n.y, n.m, n.d) }
}

/** True only during the 8 o'clock ET hour: never earlier. */
export function isMorningSendHour(t: Date): boolean {
  return etHour(t) === MORNING_HOUR
}

const tidy = (s: string) => s.replace(/[  ]/g, ' ')

/** "9:30 AM" in ET. */
export function etTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return tidy(new Intl.DateTimeFormat('en-US', { timeZone: BRIEF_TZ, hour: 'numeric', minute: '2-digit' }).format(d))
}

/** "Nov 3" in ET. */
export function etShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return tidy(new Intl.DateTimeFormat('en-US', { timeZone: BRIEF_TZ, month: 'short', day: 'numeric' }).format(d))
}

/** "Mon, Nov 9" for an ET calendar date. */
export function etDayLabel(date: string): string {
  const p = parseDate(date)
  return tidy(new Intl.DateTimeFormat('en-US', { timeZone: BRIEF_TZ, weekday: 'short', month: 'short', day: 'numeric' })
    .format(etInstant(p.y, p.m, p.d, 12)))
}
