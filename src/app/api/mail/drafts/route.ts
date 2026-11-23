// GET /api/mail/drafts                 the drafts the caller may review, newest first, and whether drafting is on
// GET /api/mail/drafts?view=count      { needs_review }: the Inbox's Needs review count (the sidebar badge)
// GET /api/mail/drafts?view=learning   the Inbox's Learning tab: 30-day scorecard, lessons, priority corrections
// Drafts are listed only for a mailbox the caller may read in full (mailView: its owner, or a superadmin for a shared
// mailbox); the Inbox views follow the Inbox rule (canSee). No subject, body or draft text exists in the Hub's draft
// rows, so none can be returned.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff } from '@/lib/api-guard'
import { listDrafts } from '@/lib/drafts/review'
import { learning, reviewQueue } from '@/lib/drafts/inbox'

export const dynamic = 'force-dynamic'

export const GET = withStaff(async (req: NextRequest, ctx) => {
  const view = req.nextUrl.searchParams.get('view')
  try {
    if (view === 'count') return NextResponse.json({ needs_review: (await reviewQueue(ctx)).count })
    if (view === 'learning') return NextResponse.json(await learning(ctx, Date.now()))
    const r = await listDrafts(ctx.db, { userId: ctx.userId, isSuperadmin: ctx.isSuperadmin }, ctx.orgIds)
    return NextResponse.json(r)
  } catch (e: any) {
    console.error(`[mail/drafts] ${view ?? 'list'} failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ error: 'Drafts could not be loaded.' }, { status: 500 })
  }
})
