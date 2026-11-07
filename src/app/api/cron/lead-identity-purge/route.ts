// GET /api/cron/lead-identity-purge (Vercel cron, daily)
//
// Blanks the first name, last name, email and phone stored on TEST lead device submissions 30 days after they were
// submitted (public.hub_purge_test_submission_identity, hub_230). Real submissions keep their details, like the
// contact they created. Logs a count only. Fails closed on CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { cronAuthorized } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/marketing/job-runs'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const TEST_IDENTITY_DAYS = 30

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, 'cron/lead-identity-purge')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminSupabase()
  try {
    const r = await withJobRun(db, 'lead-identity-purge', async () => {
      const { data, error } = await db.rpc('hub_purge_test_submission_identity', { p_days: TEST_IDENTITY_DAYS })
      if (error) throw new Error(`purge failed: ${error.code ?? 'unknown'}`)
      return { rows: Number(data ?? 0), detail: {} }
    })
    return NextResponse.json({ ok: true, purged: r?.rows ?? 0 })
  } catch (e) {
    console.error(`[cron/lead-identity-purge] ${(e as Error).message}`)
    return NextResponse.json({ error: 'purge failed' }, { status: 500 })
  }
}
