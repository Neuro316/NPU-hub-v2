// GET /api/metrics/records?metric=&from=&to=
// The records behind a Growth Dashboard tile. It runs the same collector as the rollup, for
// that metric only, so the list and the number agree. Platform superadmins only.
// Client-outcome tiles list names only: no value of any kind is returned for them, and no
// biometric value is ever part of a record.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, forbidden, bad } from '@/lib/api-guard'
import { METRIC } from '@/lib/metrics/registry'
import { collect, LOADER_OF } from '@/lib/metrics/collect'
import { loadTestFilter } from '@/lib/metrics/test-filter'
import { isDay, nyDay, daysBetween } from '@/lib/metrics/dates'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const GET = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('The Growth Dashboard is for superadmins.')
  const p = req.nextUrl.searchParams
  const metric = p.get('metric') ?? '', from = p.get('from'), to = p.get('to')
  const def = METRIC[metric]
  if (!def || def.noRecords || !LOADER_OF[metric]) return bad('This tile has no record list.')
  if (!isDay(from) || !isDay(to) || from > to || daysBetween(from, to) > 400) return bad('Choose a valid date range (at most 400 days).')
  try {
    const now = new Date()
    const filter = await loadTestFilter(ctx.db)
    const items = (await collect({ db: ctx.db, from, to, today: nyDay(now), now, filter }, LOADER_OF[metric]))
      .filter(i => i.metric === metric && i.rec)
      .sort((a, b) => b.day.localeCompare(a.day))
    const records = items.slice(0, 500).map(i => ({
      day: i.day,
      label: i.rec!.label,
      sub: def.namesOnly ? undefined : i.rec!.sub,
      href: i.rec!.href,
      value: def.namesOnly ? undefined : i.value,
      dims: def.namesOnly ? undefined : i.dims,
    }))
    return NextResponse.json({ metric, label: def.label, unit: def.unit, names_only: !!def.namesOnly, total: items.length, records })
  } catch {
    return NextResponse.json({ error: 'The records could not be loaded.' }, { status: 500 })
  }
})
