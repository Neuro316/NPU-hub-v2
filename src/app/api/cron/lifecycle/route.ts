// GET /api/cron/lifecycle (Vercel cron, every 5 minutes)
//
// Lifecycle events (src/lib/lifecycle): bookings, checkout, purchases, consent, first lesson and practice, inactivity,
// program end, and the lead follow-up tasks. Does nothing for an org until org_settings 'hub_lifecycle' exists; in
// dry_run it only records what it would do. One summary row per run in job_runs, counts only. Fails closed on
// CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { runLifecycle } from '@/lib/lifecycle/run'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const WORK_WINDOW_MS = 45_000

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/lifecycle')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  const deadline = Date.now() + WORK_WINDOW_MS
  try {
    const r = await withJobRun(db, 'lifecycle', async () => {
      const detail = await runLifecycle(db, deadline)
      return { rows: Object.keys(detail).length, detail }
    })
    return NextResponse.json(r.detail)
  } catch (e: any) {
    console.error(`[cron/lifecycle] failed: ${e?.name ?? 'Error'}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
