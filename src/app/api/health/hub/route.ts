// GET /api/health/hub
// Hub Health tiles (Running List q23): the newest 'hub' snapshot of each tile, needs attention first. Superadmins
// only; the page and the home card read this. Service role behind withStaff.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, forbidden } from '@/lib/api-guard'
import { latestTiles } from '@/lib/health/read'

export const dynamic = 'force-dynamic'

export const GET = withStaff(async (_req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('Hub Health is for superadmins.')
  try {
    return NextResponse.json({ tiles: await latestTiles(ctx.db) })
  } catch (e: any) {
    console.error(`[health/hub] failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ error: 'Hub Health could not be loaded.' }, { status: 500 })
  }
})
