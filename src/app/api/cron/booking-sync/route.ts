// GET /api/cron/booking-sync (Vercel cron, every 5 minutes)
//
// Build 1: every University booking whose appointment type has a row in
// nr_booking_pipeline_routes becomes a Hub contact at the route's stage, with its answers
// on the contact card (src/lib/bookings/sync.ts). Idempotent on the booking id. One
// summary row per run in job_runs, carrying counts only. Fails closed on CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { runBookingSync } from '@/lib/bookings/sync'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
// and no fetch in this route may be answered from the Data Cache (see createAdminSupabase)
export const fetchCache = 'force-no-store'

/** Stop starting new bookings this long after the run begins. */
const WORK_WINDOW_MS = 45_000

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/booking-sync')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  const deadline = Date.now() + WORK_WINDOW_MS
  try {
    const r = await withJobRun(db, 'booking-sync', async () => {
      const counts = await runBookingSync(db, deadline)
      return { rows: counts.synced + counts.rescheduled + counts.cancelled, detail: { ...counts } }
    })
    return NextResponse.json(r.detail)
  } catch (e: any) {
    console.error(`[cron/booking-sync] failed: ${e?.name ?? 'Error'}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
