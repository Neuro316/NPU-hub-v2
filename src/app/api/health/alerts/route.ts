// GET /api/health/alerts
// The Hub bell's health alerts (Running List q23): unacknowledged platform_alerts from BOTH sources (hub and
// platform). Admins and superadmins only, the same rule as the pf_313 RLS select. Service role behind withStaff.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, forbidden } from '@/lib/api-guard'
import { ALERT_ROLES, profileRole, unacknowledgedAlerts } from '@/lib/health/read'

export const dynamic = 'force-dynamic'

export const GET = withStaff(async (_req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin && !ALERT_ROLES.includes((await profileRole(ctx.db, ctx.userId)) ?? '')) return forbidden('Health alerts are for admins.')
  try {
    return NextResponse.json({ alerts: await unacknowledgedAlerts(ctx.db) })
  } catch (e: any) {
    console.error(`[health/alerts] failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ error: 'Health alerts could not be loaded.' }, { status: 500 })
  }
})
