// GET /api/cron/sched-drafts (Vercel cron, every 10 minutes)
//
// Scheduling reply DRAFTS (src/lib/scheduling/drafts.ts). Ships switched OFF: the first thing this does after the
// secret check is read org_settings 'hub_sched_agent', and unless drafts is 'on' it returns {skipped:'drafts_off'}
// and does nothing else (no job_runs row, no other read). When on, it handles up to 10 scheduling messages per run.
// It never sends mail: the only Gmail write is a draft. One summary row per run in job_runs: ids, counts, codes.
// Fails closed on CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { readSchedAgentConfig } from '@/lib/briefs/config'
import { runSchedDrafts } from '@/lib/scheduling/drafts'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

/** Stop starting new messages this long after the run begins. */
const WINDOW_MS = 40_000

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/sched-drafts')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  const cfg = await readSchedAgentConfig(db)
  if (!cfg.drafts) return NextResponse.json({ skipped: 'drafts_off' })
  const deadline = Date.now() + WINDOW_MS
  try {
    const r = await withJobRun(db, 'sched-drafts', async () => {
      const out = await runSchedDrafts(db, deadline, cfg)
      return { rows: out.outcomes.length, detail: out as unknown as Record<string, unknown> }
    })
    return NextResponse.json(r.detail)
  } catch (e: any) {
    console.error(`[cron/sched-drafts] failed: ${String(e?.name ?? 'Error').slice(0, 40)}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
