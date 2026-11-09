// src/lib/calendar/sync.ts
// Scheduling agent, phase 3: a read-only cache of the next 14 days of Google Calendar events for every active Hub
// mail connection that was granted the two calendar scopes (src/lib/calendar/scopes.ts). Called every 15 minutes
// by /api/cron/calendar-sync. The cache feeds the morning brief's prep notes.
//
// Stored per event: id, start, end, all-day, title, attendee emails, busy. NEVER a description, location,
// conference data or body: the events.list `fields=` mask does not even fetch them.
// Purge: events that ended more than 7 days ago are deleted every run.
// Read-only at Google. Touches only hub_calendar_calendars / hub_calendar_events (hub_234). Never reads or writes the
// University's calendar tables (nr_*).
//
// Logs and results carry connection/calendar ids, counts and short codes only.
import type { SupabaseClient } from '@supabase/supabase-js'
import { accessTokenFor, refreshTokenFor, MailError } from '@/lib/mail/google'
import { zonedTime } from '@/lib/lead-alerts/compose'
import { hasCalendarScopes, isMissingTable } from './scopes'

export const WINDOW_PAST_MS = 24 * 3600_000
export const WINDOW_FUTURE_MS = 14 * 24 * 3600_000
export const PURGE_AFTER_MS = 7 * 24 * 3600_000
const MAX_PAGES = 10
const API = 'https://www.googleapis.com/calendar/v3'

export interface CalendarSyncResult {
  connection_id: string
  calendars: number
  events: number
  deleted: number
  errors: string[]
}

class CalError extends Error { constructor(readonly code: string) { super(code) } }

async function gget(token: string, url: string): Promise<any> {
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  } catch {
    throw new CalError('network')
  }
  if (!res.ok) throw new CalError(`http_${res.status}`)
  return res.json().catch(() => { throw new CalError('bad_json') })
}

const trunc = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

const ACCESS_ROLES = ['owner', 'writer', 'reader', 'freeBusyReader']

interface GCal { google_calendar_id: string; summary: string | null; access_role: string | null; is_primary: boolean }

async function listCalendars(token: string): Promise<GCal[]> {
  const out: GCal[] = []
  let page: string | undefined
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams({ minAccessRole: 'reader', maxResults: '250', fields: 'items(id,summary,accessRole,primary),nextPageToken' })
    if (page) q.set('pageToken', page)
    const j = await gget(token, `${API}/users/me/calendarList?${q}`)
    for (const it of Array.isArray(j?.items) ? j.items : []) {
      const id = typeof it?.id === 'string' ? it.id : ''
      if (!id || id.length > 300) continue
      out.push({
        google_calendar_id: id,
        summary: trunc(it.summary, 200),
        access_role: ACCESS_ROLES.includes(it.accessRole) ? it.accessRole : null,
        is_primary: it.primary === true,
      })
    }
    page = typeof j?.nextPageToken === 'string' ? j.nextPageToken : undefined
    if (!page) return out
  }
  throw new CalError('too_many_calendar_pages')
}

/** A Google date ('YYYY-MM-DD', all-day) or dateTime as an instant. All-day dates are read as ET midnight. */
function instant(v: any): { iso: string; allDay: boolean } | null {
  if (typeof v?.dateTime === 'string') {
    const t = Date.parse(v.dateTime)
    return Number.isNaN(t) ? null : { iso: new Date(t).toISOString(), allDay: false }
  }
  if (typeof v?.date === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.date)
    return m ? { iso: zonedTime(+m[1], +m[2], +m[3], 0, 0).toISOString(), allDay: true } : null
  }
  return null
}

export interface EventRow {
  google_event_id: string
  starts_at: string
  ends_at: string
  all_day: boolean
  title: string | null
  attendee_emails: string[]
  busy: boolean
}

/** Pure: one Google event to the row we keep, or null (cancelled, malformed). Only whitelisted fields are read. */
export function toEventRow(it: any): EventRow | null {
  const id = typeof it?.id === 'string' ? it.id : ''
  if (!id || id.length > 1024 || it?.status === 'cancelled') return null
  const s = instant(it.start), e = instant(it.end)
  if (!s || !e) return null
  const ends = Date.parse(e.iso) < Date.parse(s.iso) ? s.iso : e.iso
  const emails = Array.from(new Set((Array.isArray(it.attendees) ? it.attendees : [])
    .map((a: any) => (typeof a?.email === 'string' ? a.email.trim().toLowerCase() : ''))
    .filter((x: string) => x && x.length <= 320))) as string[]
  return {
    google_event_id: id,
    starts_at: s.iso,
    ends_at: ends,
    all_day: s.allDay,
    title: trunc(it.summary, 300),
    attendee_emails: emails.slice(0, 100),
    busy: it.status !== 'cancelled' && it.transparency !== 'transparent',
  }
}

async function listEvents(token: string, calendarId: string, timeMin: string, timeMax: string): Promise<EventRow[]> {
  const out: EventRow[] = []
  let page: string | undefined
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams({
      timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
      fields: 'items(id,status,start,end,summary,attendees/email,transparency),nextPageToken',
    })
    if (page) q.set('pageToken', page)
    const j = await gget(token, `${API}/calendars/${encodeURIComponent(calendarId)}/events?${q}`)
    for (const it of Array.isArray(j?.items) ? j.items : []) {
      const row = toEventRow(it)
      if (row) out.push(row)
    }
    page = typeof j?.nextPageToken === 'string' ? j.nextPageToken : undefined
    if (!page) return out
  }
  throw new CalError('too_many_event_pages')
}

const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))
const dbCode = (prefix: string, e: { code?: string | null } | null) => `${prefix}_${e?.code ?? 'unknown'}`.slice(0, 60)

/** Sync one calendar's window. Returns counts; throws CalError on a Google or write failure. */
async function syncCalendar(db: SupabaseClient, token: string, calId: string, googleId: string, now: Date): Promise<{ events: number; deleted: number }> {
  const timeMin = new Date(now.getTime() - WINDOW_PAST_MS).toISOString()
  const timeMax = new Date(now.getTime() + WINDOW_FUTURE_MS).toISOString()
  const rows = await listEvents(token, googleId, timeMin, timeMax)
  // the same event id can come back twice (rare, across pages); keep the last
  const byId = new Map<string, EventRow>()
  rows.forEach((r) => byId.set(r.google_event_id, r))
  const list = Array.from(byId.values())
  const stamp = new Date().toISOString()
  for (const g of chunks(list, 200)) {
    const { error } = await db.from('hub_calendar_events')
      .upsert(g.map((r) => ({ ...r, calendar_id: calId, updated_at: stamp })), { onConflict: 'calendar_id,google_event_id' })
    if (error) throw new CalError(dbCode('event_write', error))
  }
  // events in the window that Google no longer returns (deleted, cancelled, moved out) go
  const { data: have, error: hErr } = await db.from('hub_calendar_events').select('id, google_event_id')
    .eq('calendar_id', calId).gt('ends_at', timeMin).lt('starts_at', timeMax)
  if (hErr) throw new CalError(dbCode('event_read', hErr))
  const gone = ((have ?? []) as any[]).filter((r) => !byId.has(r.google_event_id)).map((r) => r.id as string)
  for (const g of chunks(gone, 200)) {
    const { error } = await db.from('hub_calendar_events').delete().in('id', g)
    if (error) throw new CalError(dbCode('event_delete', error))
  }
  return { events: list.length, deleted: gone.length }
}

async function syncConnection(db: SupabaseClient, conn: { id: string }, now: Date, deadline: number): Promise<CalendarSyncResult> {
  const out: CalendarSyncResult = { connection_id: conn.id, calendars: 0, events: 0, deleted: 0, errors: [] }
  let token: string
  try {
    token = await accessTokenFor(await refreshTokenFor(db, conn.id))
  } catch (e) {
    const code = `token_${e instanceof MailError ? e.code : 'error'}`.slice(0, 60)
    out.errors.push(code)
    await db.from('hub_calendar_calendars').update({ sync_error: code }).eq('connection_id', conn.id)
    return out
  }

  // 1. the calendar list
  let listed: GCal[]
  try {
    listed = await listCalendars(token)
  } catch (e) {
    const code = `list_${e instanceof CalError ? e.code : 'error'}`.slice(0, 60)
    out.errors.push(code)
    await db.from('hub_calendar_calendars').update({ sync_error: code }).eq('connection_id', conn.id)
    return out
  }
  if (listed.length) {
    // `excluded` is not in the payload, so an upsert never changes it; a new row takes the default (false)
    const { error } = await db.from('hub_calendar_calendars')
      .upsert(listed.map((c) => ({ ...c, connection_id: conn.id })), { onConflict: 'connection_id,google_calendar_id' })
    if (error) { out.errors.push(dbCode('calendar_write', error)); return out }
  }
  const { data: mine, error: mErr } = await db.from('hub_calendar_calendars')
    .select('id, google_calendar_id, excluded').eq('connection_id', conn.id)
  if (mErr) { out.errors.push(dbCode('calendar_read', mErr)); return out }
  const listedIds = new Set(listed.map((c) => c.google_calendar_id))
  const dropped = ((mine ?? []) as any[]).filter((r) => !listedIds.has(r.google_calendar_id)).map((r) => r.id as string)
  if (dropped.length) {
    // their events go with them (on delete cascade)
    const { error } = await db.from('hub_calendar_calendars').delete().in('id', dropped)
    if (error) out.errors.push(dbCode('calendar_delete', error))
  }

  // 2. events of each included calendar
  for (const c of ((mine ?? []) as any[]).filter((r) => listedIds.has(r.google_calendar_id) && !r.excluded)) {
    if (Date.now() > deadline) { out.errors.push('deadline'); break }
    out.calendars++
    try {
      const r = await syncCalendar(db, token, c.id, c.google_calendar_id, now)
      out.events += r.events
      out.deleted += r.deleted
      await db.from('hub_calendar_calendars').update({ last_synced_at: new Date().toISOString(), sync_error: null }).eq('id', c.id)
    } catch (e) {
      const code = (e instanceof CalError ? e.code : 'error').slice(0, 60)
      out.errors.push(`cal:${code}`)
      await db.from('hub_calendar_calendars').update({ sync_error: code }).eq('id', c.id)
    }
  }
  return out
}

/** One cron run. Tolerates hub_234 not being applied: returns { skipped: 'tables_missing' }. */
export async function runCalendarSync(db: SupabaseClient, deadline: number, now = new Date()): Promise<{ skipped?: string; purged: number; connections: CalendarSyncResult[] }> {
  const probe = await db.from('hub_calendar_calendars').select('id').limit(1)
  if (isMissingTable(probe.error)) return { skipped: 'tables_missing', purged: 0, connections: [] }
  if (probe.error) throw new Error(dbCode('probe', probe.error))

  const { data: conns, error } = await db.from('hub_mail_connections').select('id, scopes').eq('status', 'active')
  if (error) throw new Error(dbCode('connections_read', error))
  const results: CalendarSyncResult[] = []
  for (const c of ((conns ?? []) as any[]).filter((r) => hasCalendarScopes(r.scopes))) {
    if (Date.now() > deadline) break
    try {
      results.push(await syncConnection(db, { id: c.id }, now, deadline))
    } catch (e) {
      results.push({ connection_id: c.id, calendars: 0, events: 0, deleted: 0, errors: [`error_${(e as Error)?.name ?? 'Error'}`] })
    }
  }

  const { data: purged, error: pErr } = await db.from('hub_calendar_events').delete()
    .lt('ends_at', new Date(now.getTime() - PURGE_AFTER_MS).toISOString()).select('id')
  if (pErr) console.error(`[calendar-sync] purge failed: ${pErr.code ?? 'unknown'}`)
  return { purged: purged?.length ?? 0, connections: results }
}
