// GET   /api/mail/connections                          mailboxes the caller may see
// PATCH /api/mail/connections {id, visibility}          owner only
// PATCH /api/mail/connections {id, add_viewer}          owner only: list a staff member in also_visible_to (hub_249)
// PATCH /api/mail/connections {id, remove_viewer}       owner only: take them off the list
// Superadmin only. Private rows are returned to their owner and to the users the owner listed (ownerEquivalent,
// src/lib/mail/access.ts), and nobody else. The also-visible-to list, and the staff to choose from, are returned to the
// OWNER only; a listed user sees the mailbox but can never change the list (isOwner). Each list change is logged in
// job_runs (job 'mailbox-also-visible-to': who, mailbox, user, added or removed).
import { NextResponse } from 'next/server'
import { withStaff, forbidden, bad } from '@/lib/api-guard'
import { listVisible, loadVisible, CONNECTION_COLUMNS, type MailConnectionRow } from '@/lib/mail/google'
import { isOwner } from '@/lib/mail/access'
import { changeList, staffOf, view, type Person } from '@/lib/mail/also-visible'

export const dynamic = 'force-dynamic'

export const GET = withStaff(async (_req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('Mailboxes are managed by superadmins.')
  const rows = await listVisible(ctx)
  if (!rows) return NextResponse.json({ error: 'Mailboxes could not be loaded.' }, { status: 500 })
  const staff = new Map<string, Person[]>()
  for (const r of rows) if (isOwner(ctx, r) && !staff.has(r.org_id)) staff.set(r.org_id, await staffOf(ctx, r.org_id))
  // also_ready: false until hub_249 adds the column (the control is hidden until then)
  const alsoReady = rows.length === 0 || rows.some((r) => Array.isArray(r.also_visible_to))
  return NextResponse.json({ connections: rows.map(r => view(r, ctx.userId, staff.get(r.org_id) ?? null)), also_ready: alsoReady })
})

export const PATCH = withStaff(async (req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('Mailboxes are managed by superadmins.')
  const body = await req.json().catch(() => ({}))
  if ('add_viewer' in body || 'remove_viewer' in body) return changeList(ctx, body)
  if (body.visibility !== 'private' && body.visibility !== 'shared') return bad('Visibility must be private or shared.')
  const row = await loadVisible(ctx, body.id)
  if (!row) return NextResponse.json({ error: 'Mailbox not found.' }, { status: 404 })
  if (!isOwner(ctx, row)) return forbidden('Only the person who connected this mailbox can change who sees it.')
  const { data, error } = await ctx.db
    .from('hub_mail_connections')
    .update({ visibility: body.visibility })
    .eq('id', row.id)
    .eq('owner_user_id', ctx.userId)
    .select(CONNECTION_COLUMNS)
    .single()
  if (error) return NextResponse.json({ error: 'Visibility could not be saved.' }, { status: 500 })
  return NextResponse.json({ connection: view(data as MailConnectionRow, ctx.userId, null) })
})
