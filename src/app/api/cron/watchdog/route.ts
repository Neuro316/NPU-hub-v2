// GET /api/cron/watchdog (Vercel cron, every 10 minutes)
//
// Reads job_runs; if an expected job has not run on schedule or has failed twice in a
// row, queues ONE text to the owner through public.hub_sms_outbox (the existing
// outbox, superadmin recipients only, consent gated). The same problem set is not
// texted again within ALERT_REPEAT_HOURS. Fails closed on CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { EXPECTED_JOBS, ALERT_REPEAT_HOURS, alertBody, alertSignature, findProblems } from '@/lib/marketing/watchdog'

export const dynamic = 'force-dynamic'

// The owner's Hub profile (Neuro Progeny superadmin). Overridable without a deploy.
const DEFAULT_RECIPIENT = '22456608-5f7d-495e-af02-7037fea125cc'
const NP_ORG = '00000000-0000-0000-0000-000000000001'

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/watchdog')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  const now = new Date()
  try {
    const r = await withJobRun(db, 'watchdog', async () => {
      const since = new Date(now.getTime() - 24 * 3600_000).toISOString()
      const { data: runs, error } = await db.from('job_runs').select('job, started_at, finished_at, ok')
        .in('job', EXPECTED_JOBS.map((j) => j.job)).gte('started_at', since).order('started_at', { ascending: false }).limit(500)
      if (error) throw new Error(`job_runs read failed: ${error.code ?? 'unknown'}`)
      const problems = findProblems(EXPECTED_JOBS, runs ?? [], now)
      if (!problems.length) return { rows: 0, detail: { problems: [] } }

      const sig = alertSignature(problems)
      const repeatSince = new Date(now.getTime() - ALERT_REPEAT_HOURS * 3600_000).toISOString()
      const { data: recent } = await db.from('job_runs').select('detail').eq('job', 'watchdog').gte('started_at', repeatSince)
      if ((recent ?? []).some((x: any) => x?.detail?.alerted === sig)) return { rows: 0, detail: { problems, suppressed: sig } }

      const { data: q, error: qErr } = await db.from('hub_sms_outbox').insert({
        org_id: NP_ORG, user_id: process.env.HUB_WATCHDOG_USER_ID || DEFAULT_RECIPIENT,
        body: alertBody(problems), source: 'hub-watchdog',
      }).select('id')
      if (qErr || (q?.length ?? 0) !== 1) throw new Error(`outbox insert failed: ${qErr?.code ?? 'no row'}`)
      return { rows: 1, detail: { problems, alerted: sig, outbox_id: q![0].id } }
    })
    return NextResponse.json({ alerted: r.rows, detail: r.detail })
  } catch (e: any) {
    console.error(`[cron/watchdog] failed: ${e?.name ?? 'Error'}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
