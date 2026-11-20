// GET /api/cron/drafts (Vercel cron, every 10 minutes)
//
// Support email drafts (Running List q10): for each org whose org_settings 'hub_drafts_mode' is 'on', save a Gmail
// draft reply for new participant_support mail (src/lib/drafts/support.ts). OFF by default: with no setting, or any
// value but 'on', nothing is read and nothing is drafted. The Hub never sends. Fails closed on CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { liveClient } from '@/lib/agent/model'
import { draftsOn } from '@/lib/drafts/rules'
import { runSupportDrafts } from '@/lib/drafts/support'
import { liveMailboxes } from '@/lib/drafts/live'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/drafts')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  try {
    const r = await withJobRun(db, 'drafts', async () => {
      const { data, error } = await db.from('org_settings').select('org_id, setting_value').eq('setting_key', 'hub_drafts_mode')
      if (error) throw new Error(`org_settings read: ${error.code ?? 'unknown'}`)
      const detail: Record<string, unknown> = {}
      let rows = 0
      for (const o of ((data ?? []) as any[]).filter((x) => draftsOn(x.setting_value))) {
        const out = await runSupportDrafts({ db, orgId: o.org_id, now: Date.now(), model: liveClient(), mailbox: liveMailboxes(db) })
        detail[o.org_id] = out
        rows += out.drafted + out.needs_person
      }
      return { rows, detail }
    })
    return NextResponse.json({ rows: r.rows, detail: r.detail })
  } catch (e: any) {
    console.error(`[cron/drafts] failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
