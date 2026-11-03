// GET /api/cron/metrics-rollup (Vercel cron, hourly at :05)
// Growth Dashboard rollup for today and yesterday, then the alerts; on Monday at 08:05 New
// York, the scorecard text. See src/lib/metrics/cron.ts. Fails closed on CRON_SECRET.
import { NextRequest } from 'next/server'
import { metricsCron } from '@/lib/metrics/cron'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
// and no fetch in this route may be answered from the Data Cache (see createAdminSupabase)
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  // the cron auth check is inside metricsCron: cronAuthorized(req, label) runs first
  return metricsCron(req, 'hourly')
}
