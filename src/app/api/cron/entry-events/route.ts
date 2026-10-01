// GET /api/cron/entry-events (Vercel cron, every 5 minutes)
//
// Turns queued entry events (stage changes, tags added, calls, chosen imports) into
// campaign enrollments through public.process_entry_events, which calls the existing
// public.route_and_enroll. At most ENTRY_CAP_PER_RUN per run; the rest wait for the next
// run. One summary row per run in job_runs. Enrolling sends nothing by itself: every
// message still goes through the send gate when its step runs. Fails closed on CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { ENTRY_CAP_PER_RUN } from '@/lib/marketing/entry-events'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
// and no fetch in this route may be answered from the Data Cache (see createAdminSupabase)
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/entry-events')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  try {
    const r = await withJobRun(db, 'entry-events', async () => {
      const { data, error } = await db.rpc('process_entry_events', { p_limit: ENTRY_CAP_PER_RUN })
      if (error) throw new Error(`process_entry_events failed: ${error.code ?? 'unknown'}`)
      const s = (data ?? {}) as Record<string, number>
      const summary = `processed ${s.processed ?? 0}, enrolled ${s.enrolled ?? 0}, skipped ${s.skipped ?? 0}, failed ${s.failed ?? 0}, still waiting ${s.waiting ?? 0} (cap ${ENTRY_CAP_PER_RUN} per run)`
      return { rows: s.processed ?? 0, detail: { summary, ...s } }
    })
    return NextResponse.json(r.detail)
  } catch (e: any) {
    console.error(`[cron/entry-events] failed: ${e?.name ?? 'Error'}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
