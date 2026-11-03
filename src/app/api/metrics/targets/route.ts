// GET    /api/metrics/targets                      every target row and the metrics that take one
// PUT    /api/metrics/targets {metric_key, month, target_value, amber_threshold, red_threshold}
// DELETE /api/metrics/targets?metric_key=&month=
// Growth Dashboard › Targets. Platform superadmins only. A month without its own row uses
// the latest earlier month's target.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, forbidden, bad } from '@/lib/api-guard'
import { METRIC, TARGETABLE } from '@/lib/metrics/registry'

export const dynamic = 'force-dynamic'

const ONLY = 'Targets are managed by superadmins.'
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-01$/.test(v)

export const GET = withStaff(async (_req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY)
  const { data, error } = await ctx.db.from('hub_metric_targets')
    .select('metric_key, month, target_value, amber_threshold, red_threshold, updated_at').order('month', { ascending: false }).order('metric_key')
  if (error) return NextResponse.json({ error: 'Targets could not be loaded.' }, { status: 500 })
  return NextResponse.json({ targets: data ?? [], metrics: TARGETABLE.map(k => ({ key: k, label: METRIC[k].label, unit: METRIC[k].unit })) })
})

export const PUT = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY)
  const b = await req.json().catch(() => ({}))
  if (!TARGETABLE.includes(b.metric_key)) return bad('Choose a metric.')
  if (!isMonth(b.month)) return bad('Choose a month.')
  const target = Number(b.target_value), amber = Number(b.amber_threshold ?? 0.9), red = Number(b.red_threshold ?? 0.75)
  if (!(target >= 0) || target > 1e9) return bad('The target must be a number of 0 or more.')
  if (!(amber > 0 && amber <= 1 && red > 0 && red <= amber)) return bad('Thresholds must be between 1% and 100%, with red at or below amber.')
  const { error } = await ctx.db.from('hub_metric_targets').upsert({
    metric_key: b.metric_key, month: b.month, target_value: target, amber_threshold: amber, red_threshold: red,
    updated_by: ctx.userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'metric_key,month' })
  if (error) return NextResponse.json({ error: 'The target could not be saved.' }, { status: 500 })
  return NextResponse.json({ ok: true })
})

export const DELETE = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY)
  const key = req.nextUrl.searchParams.get('metric_key'), month = req.nextUrl.searchParams.get('month')
  if (!key || !TARGETABLE.includes(key) || !isMonth(month)) return bad('Choose a target.')
  const { error } = await ctx.db.from('hub_metric_targets').delete().eq('metric_key', key).eq('month', month)
  if (error) return NextResponse.json({ error: 'The target could not be removed.' }, { status: 500 })
  return NextResponse.json({ ok: true })
})
