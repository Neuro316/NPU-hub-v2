// src/lib/calendar/scopes.ts
// The two read-only Google Calendar scopes the scheduling agent (phase 3) asks for when a mailbox owner
// reconnects with "Connect calendar". The token is the mail connection's own refresh token (hub_216, Vault).
// Pure: no I/O, so it can be imported anywhere.

export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
]

/** A connection "has calendar" when its stored scopes include both calendar scopes. */
export function hasCalendarScopes(scopes: unknown): boolean {
  return Array.isArray(scopes) && CALENDAR_SCOPES.every((s) => scopes.includes(s))
}

/** PostgREST / Postgres codes for "that table is not there" (hub_234 not applied yet). */
export function isMissingTable(error: { code?: string | null } | null | undefined): boolean {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01')
}
