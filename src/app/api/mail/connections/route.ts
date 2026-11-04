// GET   /api/mail/connections            mailboxes the caller may see
// PATCH /api/mail/connections {id, visibility}   owner only
// Superadmin only. Private rows are returned to their owner and nobody else.
import { NextResponse } from 'next/server'
import { withStaff, forbidden, bad } from '@/lib/api-guard'
import { listVisible, loadVisible, CONNECTION_COLUMNS, type MailConnectionRow } from '@/lib/mail/google'

export const dynamic = 'force-dynamic'

function view(row: MailConnectionRow, userId: string) {
  return {
    id: row.id,
    email_address: row.email_address,
    visibility: row.visibility,
    status: row.status,
    connected_at: row.connected_at,
    last_checked_at: row.last_checked_at,
    last_error: row.last_error,
    is_owner: row.owner_user_id === userId,
  }
}

export const GET = withStaff(async (_req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('Mailboxes are managed by superadmins.')
  const rows = await listVisible(ctx)
  if (!rows) return NextResponse.json({ error: 'Mailboxes could not be loaded.' }, { status: 500 })
  return NextResponse.json({ connections: rows.map(r => view(r, ctx.userId)) })
})

export const PATCH = withStaff(async (req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('Mailboxes are managed by superadmins.')
  const body = await req.json().catch(() => ({}))
  if (body.visibility !== 'private' && body.visibility !== 'shared') return bad('Visibility must be private or shared.')
  const row = await loadVisible(ctx, body.id)
  if (!row) return NextResponse.json({ error: 'Mailbox not found.' }, { status: 404 })
  if (row.owner_user_id !== ctx.userId) return forbidden('Only the person who connected this mailbox can change who sees it.')
  const { data, error } = await ctx.db
    .from('hub_mail_connections')
    .update({ visibility: body.visibility })
    .eq('id', row.id)
    .eq('owner_user_id', ctx.userId)
    .select(CONNECTION_COLUMNS)
    .single()
  if (error) return NextResponse.json({ error: 'Visibility could not be saved.' }, { status: 500 })
  return NextResponse.json({ connection: view(data as MailConnectionRow, ctx.userId) })
})
