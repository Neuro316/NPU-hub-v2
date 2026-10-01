// POST /api/marketing/campaigns/live   (platform superadmin only; ruling 10)
// The per-campaign switch that lets the gate send for real to contacts who are not on
// the test allowlist. It is the ONLY writer of funnel_campaigns.live_enabled. It still
// does nothing while the org's `gate_live_sends` flag is off: both must be on.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, forbidden, bad } from '@/lib/api-guard'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('Only a platform superadmin can switch a campaign to live sending.')
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  if (typeof b.id !== 'string' || typeof b.live !== 'boolean') return bad('Say which campaign, and whether live sending is on or off.')
  const { data, error } = await ctx.db.from('funnel_campaigns').update({
    live_enabled: b.live, live_enabled_at: b.live ? new Date().toISOString() : null, live_enabled_by: b.live ? ctx.userId : null,
    updated_at: new Date().toISOString(),
  }).eq('id', b.id).eq('org_id', org).select('id, live_enabled')
  if (error || (data?.length ?? 0) !== 1) return NextResponse.json({ error: 'The switch could not be saved.' }, { status: error ? 500 : 404 })
  console.info(`[marketing/live] campaign=${b.id} live=${b.live} by=${ctx.userId}`)
  return NextResponse.json({ campaign: data![0] })
})
