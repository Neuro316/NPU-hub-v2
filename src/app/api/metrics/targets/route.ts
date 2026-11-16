// GET    /api/metrics/targets                      every target row and the metrics that take one
// PUT    /api/metrics/targets {metric_key, month, target_value, amber_threshold, red_threshold, direction}
//        or {targets: [...]} to save several at once (the work-back helper's one click)
// DELETE /api/metrics/targets?metric_key=&month=
// Growth Dashboard › Targets. Platform superadmins only (reads and writes). A month without its own row uses the
// latest earlier month's target. A sum metric's target is a monthly total; a ratio, median or level metric's target
// is a level. direction 'higher' or 'lower' says which way is good (src/lib/metrics/targets.ts).
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, forbidden, bad } from '@/lib/api-guard'
import { METRIC, TARGETABLE, targetKind, defaultDirection } from '@/lib/metrics/registry'
import { DEFAULT_THRESHOLDS, validThresholds, type Direction } from '@/lib/metrics/targets'

export const dynamic = 'force-dynamic'

const ONLY = 'Targets are managed by superadmins.'
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-01$/.test(v)

export const GET = withStaff(async (_req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY)
  const { data, error } = await ctx.db.from('hub_metric_targets').select('*').order('month', { ascending: false }).order('metric_key')
  if (error) return NextResponse.json({ error: 'Targets could not be loaded.' }, { status: 500 })
  return NextResponse.json({
    targets: (data ?? []).map((t: any) => ({
      metric_key: t.metric_key, month: t.month, target_value: Number(t.target_value), amber_threshold: Number(t.amber_threshold),
      red_threshold: Number(t.red_threshold), direction: t.direction ?? (METRIC[t.metric_key] ? defaultDirection(METRIC[t.metric_key]) : 'higher'), updated_at: t.updated_at,
    })),
    metrics: TARGETABLE.map(k => ({ key: k, label: METRIC[k].label, unit: METRIC[k].unit, kind: targetKind(METRIC[k]), direction: defaultDirection(METRIC[k]) })),
  })
})

type Row = { metric_key: string; month: string; target_value: number; amber_threshold: number; red_threshold: number; direction: Direction }

function parse(b: any): Row | string {
  if (!TARGETABLE.includes(b?.metric_key)) return 'Choose a metric.'
  if (!isMonth(b.month)) return 'Choose a month.'
  const direction: Direction = b.direction === 'lower' || b.direction === 'higher' ? b.direction : defaultDirection(METRIC[b.metric_key])
  const target = Number(b.target_value)
  const amber = Number(b.amber_threshold ?? DEFAULT_THRESHOLDS[direction].amber), red = Number(b.red_threshold ?? DEFAULT_THRESHOLDS[direction].red)
  if (!(target >= 0) || target > 1e9) return 'The target must be a number of 0 or more.'
  if (!validThresholds(direction, amber, red)) {
    return direction === 'higher'
      ? 'When higher is better, thresholds are 1% to 100% of the target, with red at or below amber.'
      : 'When lower is better, thresholds are above 0% and up to 1000% of the target, with red at or above amber.'
  }
  return { metric_key: b.metric_key, month: b.month, target_value: target, amber_threshold: amber, red_threshold: red, direction }
}

export const PUT = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY)
  const b = await req.json().catch(() => ({}))
  const list = Array.isArray(b?.targets) ? b.targets : [b]
  if (!list.length || list.length > 20) return bad('Send between 1 and 20 targets.')
  const rows: Row[] = []
  for (const x of list) {
    const r = parse(x)
    if (typeof r === 'string') return bad(r)
    rows.push(r)
  }
  const now = new Date().toISOString()
  const { error } = await ctx.db.from('hub_metric_targets').upsert(rows.map(r => ({ ...r, updated_by: ctx.userId, updated_at: now })), { onConflict: 'metric_key,month' })
  if (error) return NextResponse.json({ error: 'The target could not be saved.' }, { status: 500 })
  return NextResponse.json({ ok: true, saved: rows.length })
})

export const DELETE = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY)
  const key = req.nextUrl.searchParams.get('metric_key'), month = req.nextUrl.searchParams.get('month')
  // any stored key may be removed (a retired metric's target too, such as clarity_sales)
  if (!key || !/^[a-z][a-z0-9_]{1,63}$/.test(key) || !isMonth(month)) return bad('Choose a target.')
  const { error } = await ctx.db.from('hub_metric_targets').delete().eq('metric_key', key).eq('month', month)
  if (error) return NextResponse.json({ error: 'The target could not be removed.' }, { status: 500 })
  return NextResponse.json({ ok: true })
})
