// GET /api/cron/lead-alerts (Vercel cron, every minute)
//
// Speed-to-lead (src/lib/lead-alerts/run.ts): queue one alert per new lead and send the due ones by Slack DM and
// SMS to the recipient configured in org_settings 'hub_lead_alerts'. Also raises 'signup:university' entry events
// for new University sign-ups that have a Hub contact (nothing enrolls while no active route listens).
//
// Auth: fails closed (src/lib/cron-auth.ts). Records every run in job_runs. Logs counts and codes only.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { runLeadAlerts } from '@/lib/lead-alerts/run'
import { realSenders } from '@/lib/lead-alerts/senders'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/lead-alerts')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://hub.neuroprogeny.com'
  const db = createAdminSupabase()
  try {
    const r = await withJobRun(db, 'lead-alerts', async () => {
      const out = await runLeadAlerts({ db, now: () => new Date(), appUrl, senders: realSenders })
      return { rows: out.queued, detail: { orgs: out.orgs, signups: out.signups, counts: out.counts } }
    })
    return NextResponse.json({ queued: r.rows, ...r.detail })
  } catch (e) {
    console.error(`[cron/lead-alerts] failed: ${String((e as Error)?.message ?? '').slice(0, 120)}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
