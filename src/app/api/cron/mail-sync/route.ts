// GET /api/cron/mail-sync (Vercel cron, every 5 minutes)
//
// Inbox agent phase 2: picks up new INBOX mail in every active connected mailbox
// through Gmail history.list and triages it with Claude (src/lib/mail/sync.ts). First, once a day, a mailbox marked
// error is rechecked with the Check button's token check (src/lib/mail/recheck.ts).
// Read-only at Gmail. One summary row per run in job_runs, carrying connection ids,
// counts and short codes only. Fails closed on CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'
import { runMailSync } from '@/lib/mail/sync'
import { recheckErrored } from '@/lib/mail/recheck'

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
      // once a day per mailbox in error: the Check button's token check; a mailbox that passes is synced in this run
      const rechecked = await recheckErrored(db, Date.now()).catch((e: any) => [{ connection_id: 'all', ok: false, code: String(e?.message ?? 'error').slice(0, 40) }])
      const mailboxes = await runMailSync(db, deadline)
      const imported = mailboxes.reduce((n, m) => n + m.imported, 0)
      return { rows: imported, detail: { mailboxes, rechecked } }
    })
    return NextResponse.json(r.detail)
  } catch (e: any) {
    console.error(`[cron/mail-sync] failed: ${e?.name ?? 'Error'}`)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
