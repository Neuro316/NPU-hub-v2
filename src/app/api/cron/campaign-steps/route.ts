// GET /api/cron/campaign-steps (Vercel cron, every 5 minutes)
//
// Runs due steps of campaign-linked sequence enrollments through the send gate.
// See src/lib/marketing/engine.ts. With the `engine` flag off for every org there is
// nothing for it to do: enroll() refuses while the flag is off, so no campaign-linked
// enrollment exists, and any that did would be pushed back an hour untouched.
//
// Auth: fails closed (src/lib/cron-auth.ts). /api/cron is outside the session
// middleware, so this check is the only gate. Records every run in job_runs.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { processCampaignSteps } from '@/lib/marketing/engine'
import { resendProvider } from '@/lib/marketing/providers/resend'
import { twilioSmsProvider } from '@/lib/marketing/providers/twilio-sms'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
// and no fetch in this route may be answered from the Data Cache (see createAdminSupabase)
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/campaign-steps')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const db = createAdminSupabase()
  try {
    const r = await withJobRun(db, 'campaign-steps', async () => {
      if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL is not set; links cannot be built')
      const outcomes = await processCampaignSteps({ db, email: resendProvider, sms: twilioSmsProvider, now: () => new Date(), appUrl })
      const counts: Record<string, number> = {}
      for (const o of outcomes) counts[o.outcome] = (counts[o.outcome] ?? 0) + 1
      return { rows: outcomes.length, detail: { counts } }
    })
    return NextResponse.json({ processed: r.rows, counts: r.detail?.counts ?? {} })
  } catch (e: any) {
    console.error(`[cron/campaign-steps] failed: ${e?.name ?? 'Error'}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
