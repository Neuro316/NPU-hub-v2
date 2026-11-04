// src/lib/metrics/cron.ts
// The Growth Dashboard cron handler, shared by its two Vercel cron routes:
//   /api/cron/metrics-rollup          hourly at :05: today and yesterday, then the alerts
//                                     (and on Monday at 08:05 New York, the scorecard text)
//   /api/cron/metrics-rollup/nightly  07:30 UTC: the last 120 days
// The first run (no rows before yesterday yet) backfills 120 days. Recomputing a day replaces
// its rows, so a rerun is harmless. One job_runs row per run with counts only. Fails closed
// on CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { runRollup } from './rollup'
import { runAlerts } from './alerts'
import { addDays, nyDay } from './dates'

export async function metricsCron(req: NextRequest, mode: 'hourly' | 'nightly'): Promise<Response> {
  const label = mode === 'nightly' ? 'cron/metrics-rollup/nightly' : 'cron/metrics-rollup'
  if (!cronAuthorized(req, label)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  const now = new Date()
  const today = nyDay(now)
  const { count } = await db.from('hub_metrics_daily').select('date', { count: 'exact', head: true }).lt('date', addDays(today, -1))
  const full = mode === 'nightly' || !count
  try {
    const r = await withJobRun(db, mode === 'nightly' ? 'metrics-rollup-nightly' : 'metrics-rollup', async () => {
      const roll = await runRollup(db, addDays(today, full ? -119 : -1), today, now)
      const alerts = mode === 'hourly' ? await runAlerts(db, now) : null
      return { rows: roll.rows, detail: { ...roll, alerts } }
    })
    return NextResponse.json(r.detail)
  } catch (e: any) {
    console.error(`[${label}] failed: ${e?.name ?? 'Error'}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
