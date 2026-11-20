// POST /api/mail/drafts/[id]   body { action: 'approve' | 'edit' | 'reject' }
// Mail › Drafts (Running List q10). Approve and Edit mark the draft and return its Gmail link, which the person opens
// to read, change and send it themselves. Reject marks it and deletes the Gmail draft. The Hub never sends.
// Only for a mailbox the caller may read in full (mailView); anything else is 404.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff } from '@/lib/api-guard'
import { act, type Action } from '@/lib/drafts/review'
import { liveMailboxes } from '@/lib/drafts/live'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS: Action[] = ['approve', 'edit', 'reject']

export const POST = withStaff<{ id: string }>(async (req: NextRequest, ctx, params) => {
  const id = params?.id
  if (!id || !UUID.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const action = ACTIONS.find((a) => a === body?.action)
  if (!action) return NextResponse.json({ error: 'Choose approve, edit or reject.' }, { status: 400 })
  try {
    const r = await act(ctx.db, { userId: ctx.userId, isSuperadmin: ctx.isSuperadmin }, ctx.orgIds, id, action, liveMailboxes(ctx.db), new Date())
    return NextResponse.json(r.body, { status: r.status })
  } catch (e: any) {
    console.error(`[mail/drafts] ${action} failed: ${String(e?.code ?? 'error').slice(0, 40)}`)
    return NextResponse.json({ error: 'Gmail could not be reached. Nothing changed; try again.' }, { status: 502 })
  }
})
