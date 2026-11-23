// GET /api/cron/touchpoints (Vercel cron, every 30 minutes)
//
// Touchpoint monitoring, Part 1 (Running List q35): for each org with a lifecycle setting (org_settings
// 'hub_lifecycle'), find the people left waiting on us, raise each once as a card in "Follow-ups to review", move
// cards to Done when the situation clears on its own, and once a day after 8 AM ET DM the fix suggestions
// (src/lib/touchpoints). From 8 AM ET it also posts the unanswered text alert to #np-follow-ups (text-alerts.ts).
// Does nothing until hub_245 is applied. Fails closed on CRON_SECRET.
//
// Two by-hand modes, same CRON_SECRET, run nothing else:
//   ?slack_check=1     whether the Hub's Slack app can post to #np-follow-ups (auth.test, conversations.info). Posts nothing.
//   ?text_alerts=dry   the unanswered text alert message each org would post now. Posts nothing, writes nothing.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { parseConfig } from '@/lib/lifecycle/rules'
import { loadTestFilter } from '@/lib/metrics/test-filter'
import { DEFAULT_OWNER, HUB_URL } from '@/lib/notify/settings'
import { realSenders } from '@/lib/lead-alerts/senders'
import { getOrgTwilioConfig } from '@/lib/twilio-org'
import { runTouchpoints, runTextAlerts } from '@/lib/touchpoints/run'
import { FOLLOW_UPS_CHANNEL } from '@/lib/touchpoints/text-alerts'
import { checkChannel, postToChannel } from '@/lib/touchpoints/slack-channel'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/touchpoints')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  const lines = async (orgId: string) => ((await getOrgTwilioConfig(db, orgId).catch(() => null))?.numbers ?? [])
    .map((n) => ({ phone: String(n?.phone ?? ''), nickname: String(n?.nickname ?? '') }))
  try {
    const { data: orgs, error } = await db.from('org_settings').select('org_id, setting_value').eq('setting_key', 'hub_lifecycle')
    if (error) throw new Error(`org_settings read: ${error.code ?? 'unknown'}`)
    const sp = req.nextUrl.searchParams
    if (sp.get('slack_check') === '1') {
      const detail: Record<string, unknown> = {}
      for (const o of (orgs ?? []) as any[]) detail[o.org_id] = await checkChannel(o.org_id, FOLLOW_UPS_CHANNEL)
      return NextResponse.json({ slack_check: detail })
    }
    const filter = await loadTestFilter(db)
    const depsFor = (o: any) => {
      const cfg = parseConfig(o.org_id, o.setting_value)
      return {
        db, orgId: o.org_id, now: Date.now(), enrolledPipeline: cfg.enrolledPipeline, owner: cfg.assignee ?? DEFAULT_OWNER, hubUrl: HUB_URL,
        isTest: (c: any) => filter.isTestContact(c), slack: realSenders.slack, slackChannel: postToChannel, lines,
      }
    }
    if (sp.get('text_alerts') === 'dry') {
      const detail: Record<string, unknown> = {}
      for (const o of (orgs ?? []) as any[]) detail[o.org_id] = await runTextAlerts(depsFor(o), true)
      return NextResponse.json({ text_alerts_dry: detail })
    }
    const r = await withJobRun(db, 'touchpoints', async () => {
      const detail: Record<string, unknown> = {}
      let rows = 0
      for (const o of (orgs ?? []) as any[]) {
        const out = await runTouchpoints(depsFor(o))
        // the job log keeps counts and codes, never the message (it quotes their text)
        detail[o.org_id] = out.textAlert ? { ...out, textAlert: { ...out.textAlert, message: null } } : out
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
