// POST /api/mail/drafts/[id]
//   { action: 'approve' }                         mark approved; the person sends it from Gmail
//   { action: 'edit', text }                      "Approve my version": drafts.update with the text, mark edited
//   { action: 'reject', chip, line? }             the chip and line become the lesson; the Gmail draft is deleted
//   { action: 'redraft', note? }                  compose again with the note; hard stops still apply
//   { action: 'pin' | 'unpin' | 'retire' | 'restore' }   the Learning tab's controls on a lesson
// The Hub never sends. Only for a mailbox the caller may read in full (mailView); anything else is 404.
// The draft text and the note are passed to Gmail and the model only: never logged or stored.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff } from '@/lib/api-guard'
import { ACTIONS, act } from '@/lib/drafts/review'
import { liveMailboxes } from '@/lib/drafts/live'
import { liveClient } from '@/lib/agent/model'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = withStaff<{ id: string }>(async (req: NextRequest, ctx, params) => {
  const id = params?.id
  if (!id || !UUID.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const action = ACTIONS.find((a) => a === body?.action)
  if (!action) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  try {
    const r = await act(ctx.db, { userId: ctx.userId, isSuperadmin: ctx.isSuperadmin }, ctx.orgIds, id, action, liveMailboxes(ctx.db), new Date(), {
      text: body?.text, chip: body?.chip, line: body?.line, note: body?.note, model: action === 'redraft' ? liveClient() : undefined,
    })
    return NextResponse.json(r.body, { status: r.status })
  } catch (e: any) {
    console.error(`[mail/drafts] ${action} failed: ${String(e?.code ?? 'error').slice(0, 40)}`)
    return NextResponse.json({ error: 'Gmail or the AI could not be reached. Nothing changed; try again.' }, { status: 502 })
  }
})
