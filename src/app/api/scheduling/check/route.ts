// POST /api/scheduling/check {category, starts_at, ends_at}
// "Test a time" on the Rules page: runs public.hub_sched_check for the signed-in user,
// the same function the platform booking links call. Times are local wall-clock times
// ("2026-11-11 14:00") in the user's own time zone.
import { NextResponse } from 'next/server'
import { withStaff, bad } from '@/lib/api-guard'
import { CHECK_REASONS, SCHED_CATEGORIES, Invalid, localTimestamp, ownerTimezone } from '@/lib/scheduling/rules'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const body = await req.json().catch(() => ({}))
  if (!(SCHED_CATEGORIES as readonly string[]).includes(body.category)) return bad('Choose a category.')
  const tz = await ownerTimezone(ctx.db, ctx.userId)
  let starts: string, ends: string
  try {
    starts = localTimestamp(body.starts_at, 'Start', tz)
    ends = localTimestamp(body.ends_at, 'End', tz)
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message)
    throw e
  }
  const { data, error } = await ctx.db.rpc('hub_sched_check', {
    p_owner: ctx.userId, p_category: body.category, p_starts_at: starts, p_ends_at: ends,
  })
  if (error || !data) return NextResponse.json({ error: 'The check could not run.' }, { status: 500 })
  const r = (Array.isArray(data) ? data[0] : data) as { allowed: boolean; reason: string }
  return NextResponse.json({ allowed: r.allowed, reason: r.reason, explanation: CHECK_REASONS[r.reason] ?? r.reason, timezone: tz })
})
