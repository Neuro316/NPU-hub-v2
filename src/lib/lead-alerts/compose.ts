// src/lib/lead-alerts/compose.ts
// Pure: when a speed-to-lead alert is due, and the words it carries. No I/O, so the harness can assert both.
//
// Quiet hours are 8 PM to 8 AM Eastern. An alert raised inside them is due at the next 8 AM Eastern, except a
// booking that starts within the next 24 hours, which is due at once.
//
// The message carries only what the person submitted: their name, the source, what they did, their phone and
// email when known, and a link to the contact card. No answers, no notes, nothing inferred.

export type LeadSource = 'lead_device' | 'form' | 'booking' | 'university_signup' | 'test'

export const ALERT_TZ = 'America/New_York'
export const QUIET_START_HOUR = 20
export const QUIET_END_HOUR = 8
export const BOOKING_URGENT_MS = 24 * 60 * 60 * 1000

export interface LeadFacts {
  source: LeadSource
  name: string | null
  /** the device, form or appointment type name */
  label: string | null
  /** a lead device's result label, when it has one */
  outcome: string | null
  email: string | null
  phone: string | null
  /** a booking's start (ISO) */
  startsAt: string | null
  contactId: string | null
}

function wall(d: Date, tz = ALERT_TZ): { y: number; m: number; d: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(d)
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { y: n('year'), m: n('month'), d: n('day'), h: n('hour') % 24, mi: n('minute') }
}

/** The UTC instant of a wall-clock time in tz (DST-safe: the offset is read at the guessed instant, then rechecked). */
export function zonedTime(y: number, m: number, d: number, h: number, mi: number, tz = ALERT_TZ): Date {
  const target = Date.UTC(y, m - 1, d, h, mi)
  let t = target
  for (let i = 0; i < 2; i++) {
    const w = wall(new Date(t), tz)
    t += target - Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi)
  }
  return new Date(t)
}

export function inQuietHours(now: Date): boolean {
  const h = wall(now).h
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR
}

/** The next 8 AM Eastern at or after now. */
export function nextQuietEnd(now: Date): Date {
  const w = wall(now)
  const today = zonedTime(w.y, w.m, w.d, QUIET_END_HOUR, 0)
  if (w.h < QUIET_END_HOUR) return today
  // the calendar day after w, computed on a UTC noon so a DST change cannot skip or repeat it
  const next = new Date(Date.UTC(w.y, w.m - 1, w.d, 12) + 24 * 60 * 60 * 1000)
  return zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), QUIET_END_HOUR, 0)
}

/** When an alert raised now is sent. */
export function alertDueAt(source: LeadSource, now: Date, startsAt: Date | null): Date {
  if (!inQuietHours(now)) return now
  if (source === 'booking' && startsAt && startsAt.getTime() - now.getTime() <= BOOKING_URGENT_MS) return now
  return nextQuietEnd(now)
}

/** One line of untrusted text: control characters and runs of space collapsed, length capped. */
export function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return null
  return s.length > max ? `${s.slice(0, max - 3)}...` : s
}

const SOURCE_NAME: Record<LeadSource, string> = {
  lead_device: 'Lead device', form: 'Form', booking: 'Booking', university_signup: 'University sign-up', test: 'Test',
}

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { timeZone: ALERT_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    .format(d) + ' ET'
}

export function whatTheyDid(f: LeadFacts): string {
  const label = clean(f.label, 80)
  const outcome = clean(f.outcome, 60)
  switch (f.source) {
    case 'lead_device': return `Completed ${label ? `"${label}"` : 'a lead device'}${outcome ? ` (result: ${outcome})` : ''}`
    case 'form': return `Submitted ${label ? `the form "${label}"` : 'a form'}`
    case 'booking': return `Booked ${label ? `"${label}"` : 'a call'}${f.startsAt ? ` for ${when(f.startsAt)}` : ''}`
    case 'university_signup': return 'Created a University account'
    case 'test': return 'This is a test of your speed-to-lead alerts. No lead is attached.'
  }
}

export function contactLink(appUrl: string, contactId: string | null): string | null {
  if (!contactId || !/^[0-9a-f-]{36}$/i.test(contactId)) return null
  return `${appUrl.replace(/\/+$/, '')}/crm/contacts?id=${contactId}`
}

/** The SMS text. Plain, one fact per line. */
export function composeAlert(f: LeadFacts, appUrl: string): string {
  const lines = [
    `New lead: ${clean(f.name, 80) ?? 'Name not given'}`,
    `Source: ${SOURCE_NAME[f.source]}`,
    whatTheyDid(f),
  ]
  const phone = clean(f.phone, 30), email = clean(f.email, 120)
  if (phone) lines.push(`Phone: ${phone}`)
  if (email) lines.push(`Email: ${email}`)
  const link = contactLink(appUrl, f.contactId)
  lines.push(link ? `Card: ${link}` : 'Card: not created yet')
  return lines.join('\n')
}

/** The Slack text: the same lines, with Slack's three control characters escaped. */
export function composeSlack(f: LeadFacts, appUrl: string): string {
  return composeAlert(f, appUrl).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
