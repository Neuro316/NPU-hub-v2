// POST /api/marketing/flags   (platform superadmin only)
// Turns a capability flag on or off for one org (org_settings key hub_marketing_flags).
// { org_id, key, on }. Every flag ships off; flipping them is Cameron's decision
// (ruling 10), so only a platform superadmin reaches this.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, forbidden, bad } from '@/lib/api-guard'
import { FLAG_KEYS, getFlags, type FlagKey } from '@/lib/marketing/flags'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('Only a platform superadmin can change these switches.')
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  if (!FLAG_KEYS.includes(b.key as FlagKey) || typeof b.on !== 'boolean') return bad('Unknown switch.')
  const { data: cur } = await ctx.db.from('org_settings').select('setting_value').eq('org_id', org).eq('setting_key', 'hub_marketing_flags').maybeSingle()
  const next = { ...((cur?.setting_value as object) ?? {}), [b.key]: b.on ? 'on' : 'off' }
  const { error } = await ctx.db.from('org_settings').upsert({ org_id: org, setting_key: 'hub_marketing_flags', setting_value: next, updated_at: new Date().toISOString() },
    { onConflict: 'org_id,setting_key' })
  if (error) return NextResponse.json({ error: 'The switch could not be saved.' }, { status: 500 })
  console.info(`[marketing/flags] org=${org} ${b.key}=${b.on ? 'on' : 'off'} by=${ctx.userId}`)
  return NextResponse.json({ flags: await getFlags(ctx.db, org) })
})
