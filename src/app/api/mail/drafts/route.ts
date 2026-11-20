// GET /api/mail/drafts
// Mail › Drafts (Running List q10): the drafts the caller may review, newest first, and whether drafting is on.
// Listed only for a mailbox the caller may read in full (mailView: its owner, or a superadmin for a shared mailbox).
// No subject, body or draft text exists in the Hub, so none can be returned.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff } from '@/lib/api-guard'
import { listDrafts } from '@/lib/drafts/review'

export const dynamic = 'force-dynamic'

export const GET = withStaff(async (_req: NextRequest, ctx) => {
  try {
    const r = await listDrafts(ctx.db, { userId: ctx.userId, isSuperadmin: ctx.isSuperadmin }, ctx.orgIds)
    return NextResponse.json(r)
  } catch (e: any) {
    console.error(`[mail/drafts] failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ error: 'Drafts could not be loaded.' }, { status: 500 })
  }
})
