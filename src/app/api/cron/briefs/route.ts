// GET /api/cron/briefs (Vercel cron, hourly at minute 0)
//
// Scheduling agent, stage 1: the morning brief (src/lib/briefs/run.ts). Does nothing unless org_settings
// 'hub_sched_agent' is 'on', and sends only during the 8 o'clock ET hour, once per day, to the configured
// recipient only. One summary row per run in job_runs: codes and counts only. Fails closed on CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { realSenders } from '@/lib/lead-alerts/senders'
import { runMorningBrief } from '@/lib/briefs/run'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/briefs')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  try {
    const r = await withJobRun(db, 'briefs', async () => {
      const out = await runMorningBrief({ db, now: () => new Date(), senders: realSenders })
      return { rows: out.slack === 'sent' || out.sms === 'sent' ? 1 : 0, detail: out }
    })
    return NextResponse.json(r.detail)
  } catch (e: any) {
    console.error(`[cron/briefs] failed: ${String(e?.message ?? e?.name ?? 'Error').slice(0, 60)}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
