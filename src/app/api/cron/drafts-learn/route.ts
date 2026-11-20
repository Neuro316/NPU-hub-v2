// GET /api/cron/drafts-learn (Vercel cron, every 30 minutes)
//
// The drafts learning loop (Running List q10): for approved or edited drafts that have since been sent from Gmail,
// store one lesson sentence (at most 200 characters) and mark them sent; drafts deleted in Gmail without sending are
// marked rejected (src/lib/drafts/learn.ts). Email text is read in memory only and never stored. Fails closed on
// CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { liveClient } from '@/lib/agent/model'
import { runLearn } from '@/lib/drafts/learn'
import { liveMailboxes } from '@/lib/drafts/live'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/drafts-learn')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  try {
    const r = await withJobRun(db, 'drafts-learn', async () => {
      const out = await runLearn({ db, now: Date.now(), model: liveClient(), mailbox: liveMailboxes(db) })
      return { rows: out.sent + out.rejected, detail: { ...out } as Record<string, unknown> }
    })
    return NextResponse.json({ rows: r.rows, detail: r.detail })
  } catch (e: any) {
    console.error(`[cron/drafts-learn] failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
