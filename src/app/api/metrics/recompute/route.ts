// POST /api/metrics/recompute {days?: 1..120}
// Recomputes the Growth Dashboard now (default the last 120 days), for after a target or a
// test-account decision changes. The same rollup the cron runs, recorded in job_runs.
// Platform superadmins only.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, forbidden } from '@/lib/api-guard'
import { withJobRun } from '@/lib/marketing/job-runs'
import { runRollup } from '@/lib/metrics/rollup'
import { addDays, nyDay } from '@/lib/metrics/dates'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const POST = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('The Growth Dashboard is for superadmins.')
  const b = await req.json().catch(() => ({}))
  const days = Math.min(120, Math.max(1, Math.floor(Number(b.days) || 120)))
  const today = nyDay(new Date())
  try {
    const r = await withJobRun(ctx.db, 'metrics-rollup-manual', async () => {
      const roll = await runRollup(ctx.db, addDays(today, -(days - 1)), today)
      return { rows: roll.rows, detail: { ...roll } }
    })
    return NextResponse.json({ ok: true, rows: r.rows, from: r.detail?.from, to: r.detail?.to })
  } catch {
    return NextResponse.json({ error: 'The recompute failed. Try again.' }, { status: 500 })
  }
})
