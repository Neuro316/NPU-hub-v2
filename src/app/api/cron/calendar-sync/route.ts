// GET /api/cron/calendar-sync (Vercel cron, every 15 minutes)
//
// Scheduling agent, phase 3: refreshes the read-only cache of the next 14 days of events for every active mail
// connection granted the calendar scopes, and purges events that ended over 7 days ago (src/lib/calendar/sync.ts).
// A no-op until hub_234 is applied. One summary row per run in job_runs: ids, counts and codes only.
// Fails closed on CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { runCalendarSync } from '@/lib/calendar/sync'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

/** Stop starting new calendars this long after the run begins. */
const WINDOW_MS = 45_000

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/calendar-sync')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  const deadline = Date.now() + WINDOW_MS
  try {
    const r = await withJobRun(db, 'calendar-sync', async () => {
      const out = await runCalendarSync(db, deadline)
      return { rows: out.connections.reduce((n, c) => n + c.events, 0), detail: out }
    })
    return NextResponse.json(r.detail)
  } catch (e: any) {
    console.error(`[cron/calendar-sync] failed: ${String(e?.message ?? e?.name ?? 'Error').slice(0, 60)}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
