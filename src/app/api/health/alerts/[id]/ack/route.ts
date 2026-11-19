// POST /api/health/alerts/[id]/ack
// Acknowledge one health alert of either source from the Hub bell (Running List q23): writes acknowledged_at and
// acknowledged_by (the caller's profile). Once only; resolving stays with the cron. Admins and superadmins only.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, forbidden } from '@/lib/api-guard'
import { ALERT_ROLES, acknowledge, profileRole } from '@/lib/health/read'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = withStaff<{ id: string }>(async (_req: NextRequest, ctx, params) => {
  if (!ctx.isSuperadmin && !ALERT_ROLES.includes((await profileRole(ctx.db, ctx.userId)) ?? '')) return forbidden('Health alerts are for admins.')
  const id = params?.id
  if (!id || !UUID.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  try {
    const done = await acknowledge(ctx.db, id, ctx.userId, new Date())
    return NextResponse.json({ acknowledged: done })
  } catch (e: any) {
    console.error(`[health/ack] failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ error: 'The alert could not be acknowledged.' }, { status: 500 })
  }
})
