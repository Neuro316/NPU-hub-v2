// GET /api/cron/hub-health (Vercel cron, every 30 minutes)
//
// Hub Health (Running List q23): one 'hub' row per tile in platform_health_snapshots, and platform_alerts opened or
// resolved on a colour change against each tile's previous 'hub' snapshot (src/lib/health/run.ts). A change into red
// texts the owner through hub_sms_outbox only when the org's notification mode is live. Fails closed on CRON_SECRET.
//
// Env (names only): HUB_HEALTH_GITHUB_TOKEN (read-only; the CI, deploy and PR tiles are unknown without it),
// HUB_HEALTH_ALERT_USER_ID (optional; the owner's profile by default).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { loadSettings, HUB_URL } from '@/lib/notify/settings'
import { DEFAULT_ALERT_USER, NP_ORG, githubFrom, runHubHealth } from '@/lib/health/run'
import { REPO_FACTS } from '@/lib/health/generated/repo-facts'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/hub-health')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  try {
    const r = await withJobRun(db, 'hub-health', async () => {
      const out = await runHubHealth({
        db, now: Date.now(), github: githubFrom(process.env.HUB_HEALTH_GITHUB_TOKEN), repo: REPO_FACTS,
        alertUserId: process.env.HUB_HEALTH_ALERT_USER_ID || DEFAULT_ALERT_USER,
        mode: async () => (await loadSettings(db, NP_ORG)).mode, hubUrl: HUB_URL,
      })
      return { rows: out.written, detail: { ...out } as Record<string, unknown> }
    })
    return NextResponse.json({ written: r.rows, detail: r.detail })
  } catch (e: any) {
    console.error(`[cron/hub-health] failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
