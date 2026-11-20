// GET /api/cron/touchpoints (Vercel cron, every 30 minutes)
//
// Touchpoint monitoring, Part 1 (Running List q35): for each org with a lifecycle setting (org_settings
// 'hub_lifecycle'), find the people left waiting on us, raise each once as a card in "Follow-ups to review", move
// cards to Done when the situation clears on its own, and once a day after 8 AM ET DM the fix suggestions
// (src/lib/touchpoints). Does nothing until hub_245 is applied. Fails closed on CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { parseConfig } from '@/lib/lifecycle/rules'
import { loadTestFilter } from '@/lib/metrics/test-filter'
import { DEFAULT_OWNER, HUB_URL } from '@/lib/notify/settings'
import { realSenders } from '@/lib/lead-alerts/senders'
import { runTouchpoints } from '@/lib/touchpoints/run'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/touchpoints')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  try {
    const r = await withJobRun(db, 'touchpoints', async () => {
      const { data: orgs, error } = await db.from('org_settings').select('org_id, setting_value').eq('setting_key', 'hub_lifecycle')
      if (error) throw new Error(`org_settings read: ${error.code ?? 'unknown'}`)
      const filter = await loadTestFilter(db)
      const detail: Record<string, unknown> = {}
      let rows = 0
      for (const o of (orgs ?? []) as any[]) {
        const cfg = parseConfig(o.org_id, o.setting_value)
        const out = await runTouchpoints({
          db, orgId: o.org_id, now: Date.now(), enrolledPipeline: cfg.enrolledPipeline, owner: cfg.assignee ?? DEFAULT_OWNER, hubUrl: HUB_URL,
          isTest: (c) => filter.isTestContact(c), slack: realSenders.slack,
        })
        detail[o.org_id] = out
        rows += out.raised + out.cleared
      }
      return { rows, detail }
    })
    return NextResponse.json({ rows: r.rows, detail: r.detail })
  } catch (e: any) {
    console.error(`[cron/touchpoints] failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
