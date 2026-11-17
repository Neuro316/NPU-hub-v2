// GET /api/cron/form-placement (Vercel cron, every 5 minutes)
//
// Website and Hub form leads into their pipeline (src/lib/marketing/form-placement.ts): each accepted submission
// of a form with a route in org_settings 'hub_form_routes' places a contact the submission created at the route's
// stage, forward only. Does nothing until a route exists. One summary row per run in job_runs, counts only.
// Fails closed on CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { runFormPlacement } from '@/lib/marketing/form-placement'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/form-placement')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  try {
    const r = await withJobRun(db, 'form-placement', async () => {
      const counts = await runFormPlacement(db, new Date(), Date.now() + 45_000)
      return { rows: counts.placed, detail: counts }
    })
    return NextResponse.json(r.detail)
  } catch (e: any) {
    console.error(`[cron/form-placement] failed: ${e?.name ?? 'Error'}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
