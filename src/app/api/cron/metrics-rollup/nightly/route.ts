// GET /api/cron/metrics-rollup/nightly (Vercel cron, 07:30 UTC)
// Growth Dashboard: recompute the last 120 days. See src/lib/metrics/cron.ts. Fails closed
// on CRON_SECRET.
import { NextRequest } from 'next/server'
import { metricsCron } from '@/lib/metrics/cron'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
// and no fetch in this route may be answered from the Data Cache (see createAdminSupabase)
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  // the cron auth check is inside metricsCron: cronAuthorized(req, label) runs first
  return metricsCron(req, 'nightly')
}
