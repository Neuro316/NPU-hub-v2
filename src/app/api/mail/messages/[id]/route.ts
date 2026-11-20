// GET /api/mail/messages/[id]   the Inbox review pane for one message (feat/drafts-inbox-review)
// Superadmin only, and only for a mailbox the caller may see (the Inbox rule); anything else is 404, so a private
// mailbox's existence is not confirmed. The draft is read live from Gmail and returned, never stored or logged.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, forbidden } from '@/lib/api-guard'
import { reviewPane } from '@/lib/drafts/inbox'
import { liveMailboxes } from '@/lib/drafts/live'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GET = withStaff<{ id: string }>(async (_req: NextRequest, ctx, params) => {
  if (!ctx.isSuperadmin) return forbidden('The inbox is for superadmins.')
  const id = params?.id
  if (!id || !UUID.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  try {
    const pane = await reviewPane(ctx, id, liveMailboxes(ctx.db), Date.now())
    if (!pane) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json(pane, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    console.error(`[mail/messages] pane failed: ${String(e?.code ?? 'error').slice(0, 40)}`)
    return NextResponse.json({ error: 'This email could not be loaded.' }, { status: 500 })
  }
})
