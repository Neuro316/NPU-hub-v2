// GET /api/cron/brief (Vercel cron, weekdays at 12:05, 12:35, 13:05 and 13:35 UTC: 08:05 New York in summer and in
// winter, with a retry). The 8 AM brief (Running List q22, src/lib/notify). Sends only when an org's
// 'hub_notifications'.mode is live AND it is 08:05 to 08:59 on a weekday in New York; each person at most once per
// day (hub_239). Off and preview send nothing. One summary row per run in job_runs, counts only. Fails closed on
// CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { sendBriefs } from '@/lib/notify/brief'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/brief')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  try {
    const r = await withJobRun(db, 'brief', async () => {
      const { data: orgs, error } = await db.from('org_settings').select('org_id').eq('setting_key', 'hub_notifications')
      if (error) throw new Error(`orgs read: ${error.code ?? 'unknown'}`)
      const detail: Record<string, unknown> = {}
      let queued = 0
      for (const { org_id } of (orgs ?? []) as any[]) {
        const c = await sendBriefs(db, org_id, new Date())
        detail[org_id] = c
        queued += c.queued ?? 0
      }
      return { rows: queued, detail }
    })
    return NextResponse.json(r.detail)
  } catch (e: any) {
    console.error(`[cron/brief] failed: ${e?.name ?? 'Error'}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
