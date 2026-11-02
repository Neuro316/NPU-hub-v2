// GET /api/cron/mail-sync (Vercel cron, every 5 minutes)
//
// Inbox agent phase 2: picks up new INBOX mail in every active connected mailbox
// through Gmail history.list and triages it with Claude (src/lib/mail/sync.ts).
// Read-only at Gmail. One summary row per run in job_runs, carrying connection ids,
// counts and short codes only. Fails closed on CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { runMailSync } from '@/lib/mail/sync'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
// and no fetch in this route may be answered from the Data Cache (see createAdminSupabase)
export const fetchCache = 'force-no-store'

/** Stop starting new triage work this long after the run begins. */
const TRIAGE_WINDOW_MS = 40_000

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/mail-sync')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  const deadline = Date.now() + TRIAGE_WINDOW_MS
  try {
    const r = await withJobRun(db, 'mail-sync', async () => {
      const mailboxes = await runMailSync(db, deadline)
      const imported = mailboxes.reduce((n, m) => n + m.imported, 0)
      return { rows: imported, detail: { mailboxes } }
    })
    return NextResponse.json(r.detail)
  } catch (e: any) {
    console.error(`[cron/mail-sync] failed: ${e?.name ?? 'Error'}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
