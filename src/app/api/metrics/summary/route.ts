// GET /api/metrics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD[&series=1]
// Growth Dashboard tiles for a range: value, previous period, breakdowns, target status,
// and optionally the daily series. Platform superadmins only. Reads hub_metrics_daily and
// hub_metric_targets (Hub-owned); never a University table.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, forbidden, bad } from '@/lib/api-guard'
import { summarize } from '@/lib/metrics/summary'
import { isDay, nyDay, daysBetween } from '@/lib/metrics/dates'

export const dynamic = 'force-dynamic'
const ONLY = 'The Growth Dashboard is for superadmins.'

export const GET = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY)
  const p = req.nextUrl.searchParams
  const from = p.get('from'), to = p.get('to')
  if (!isDay(from) || !isDay(to) || from > to || daysBetween(from, to) > 400) return bad('Choose a valid date range (at most 400 days).')
  try {
    return NextResponse.json(await summarize(ctx.db, from, to, nyDay(new Date()), { series: p.get('series') === '1' }))
  } catch {
    return NextResponse.json({ error: 'The dashboard could not be loaded.' }, { status: 500 })
  }
})
