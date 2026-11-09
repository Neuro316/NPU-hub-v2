// GET   /api/calendar/calendars           the caller's own mailboxes and the calendars each one can see
// PATCH /api/calendar/calendars {id, excluded}  include or exclude one calendar from the cache
//
// Scheduling agent, phase 3. Only calendars of connections the caller OWNS are listed or changed (a shared
// mailbox's calendars belong to its owner). Excluding a calendar deletes its cached events at once; the next
// calendar-sync run skips it. Until hub_234 is applied, GET answers tables_missing and PATCH 409.
import { NextResponse } from 'next/server'
import { withStaff, bad } from '@/lib/api-guard'
import { hasCalendarScopes, isMissingTable } from '@/lib/calendar/scopes'

export const dynamic = 'force-dynamic'

export const GET = withStaff(async (_req, ctx) => {
  const { data: conns, error } = await ctx.db.from('hub_mail_connections')
    .select('id, email_address, status, scopes').eq('owner_user_id', ctx.userId).neq('status', 'revoked').order('email_address')
  if (error) return NextResponse.json({ error: 'Mailboxes could not be loaded.' }, { status: 503 })
  const connections = ((conns ?? []) as any[]).map((c) => ({
    id: c.id as string, email_address: c.email_address as string, status: c.status as string, has_calendar: hasCalendarScopes(c.scopes),
  }))
  if (!connections.length) return NextResponse.json({ connections, calendars: [], tables_missing: false })

  const { data: cals, error: cErr } = await ctx.db.from('hub_calendar_calendars')
    .select('id, connection_id, summary, access_role, is_primary, excluded, last_synced_at, sync_error')
    .in('connection_id', connections.map((c) => c.id))
    .order('is_primary', { ascending: false }).order('summary')
  if (isMissingTable(cErr)) return NextResponse.json({ connections, calendars: [], tables_missing: true })
  if (cErr) return NextResponse.json({ error: 'Calendars could not be loaded.' }, { status: 503 })
  const email = new Map(connections.map((c) => [c.id, c.email_address]))
  const calendars = ((cals ?? []) as any[]).map((c) => ({
    id: c.id, connection_id: c.connection_id, connection_email: email.get(c.connection_id) ?? null,
    summary: c.summary, access_role: c.access_role, is_primary: !!c.is_primary, excluded: !!c.excluded,
    last_synced_at: c.last_synced_at, sync_error: c.sync_error,
  }))
  return NextResponse.json({ connections, calendars, tables_missing: false })
})

export const PATCH = withStaff(async (req, ctx) => {
  const body = await req.json().catch(() => null)
  const id = body?.id
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || typeof body?.excluded !== 'boolean') {
    return bad('Send { id, excluded: true | false }.')
  }
  const { data: cal, error } = await ctx.db.from('hub_calendar_calendars').select('id, connection_id').eq('id', id).maybeSingle()
  if (isMissingTable(error)) return NextResponse.json({ error: 'Calendar sync is not set up yet.' }, { status: 409 })
  if (error) return NextResponse.json({ error: 'The calendar could not be read. Try again.' }, { status: 503 })
  if (!cal) return NextResponse.json({ error: 'Calendar not found.' }, { status: 404 })
  const { data: conn } = await ctx.db.from('hub_mail_connections').select('owner_user_id').eq('id', (cal as any).connection_id).maybeSingle()
  if (!conn || (conn as any).owner_user_id !== ctx.userId) return NextResponse.json({ error: 'Calendar not found.' }, { status: 404 })

  const { error: uErr } = await ctx.db.from('hub_calendar_calendars').update({ excluded: body.excluded }).eq('id', id)
  if (uErr) return NextResponse.json({ error: 'The calendar could not be updated.' }, { status: 503 })
  let removed = 0
  if (body.excluded) {
    const { data: gone, error: dErr } = await ctx.db.from('hub_calendar_events').delete().eq('calendar_id', id).select('id')
    if (dErr) return NextResponse.json({ error: 'Excluded (the brief ignores it), but its cached events could not be removed. Try again.' }, { status: 503 })
    removed = gone?.length ?? 0
  }
  return NextResponse.json({ id, excluded: body.excluded, removed_events: removed })
})
