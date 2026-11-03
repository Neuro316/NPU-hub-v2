// src/lib/metrics/dates.ts
// Growth Dashboard days are America/New_York calendar days, as YYYY-MM-DD strings.

export const TZ = 'America/New_York'
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

/** The New York day an instant falls on. */
export function nyDay(iso: string | Date): string {
  return fmt.format(typeof iso === 'string' ? new Date(iso) : iso)
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000)
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

export const monthStart = (day: string) => `${day.slice(0, 7)}-01`
export function daysInMonth(day: string): number {
  const [y, m] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** A UTC instant safely before the New York day starts / after it ends (for query bounds). */
export const queryFrom = (day: string) => `${addDays(day, -1)}T00:00:00Z`
export const queryTo = (day: string) => `${addDays(day, 2)}T00:00:00Z`

export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))

/** Hour and minute in New York, and the weekday (0 = Sunday). */
export function nyClock(now: Date): { day: string; hour: number; minute: number; weekday: number } {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' }).formatToParts(now)
  const get = (t: string) => p.find(x => x.type === t)?.value ?? ''
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { day: nyDay(now), hour: Number(get('hour')), minute: Number(get('minute')), weekday }
}
