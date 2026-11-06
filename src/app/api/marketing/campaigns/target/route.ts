// POST /api/marketing/campaigns/target   (org admin)
// { org_id, campaign_id, smart_list_id | null }: which smart list a campaign targets. The campaign
// takes the list's brand, which is what gate_check reads to block WNW sends without a sender.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, isOrgAdmin, forbidden, bad } from '@/lib/api-guard'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  if (!isOrgAdmin(ctx, org)) return forbidden('Only an organization admin can change what a campaign targets.')
  if (typeof b.campaign_id !== 'string') return bad('Say which campaign.')
  const patch: Record<string, unknown> = { smart_list_id: null, updated_at: new Date().toISOString() }
  if (b.smart_list_id) {
    const { data: list } = await ctx.db.from('smart_lists').select('id, brand, archived_at').eq('id', b.smart_list_id).eq('org_id', org).maybeSingle()
    if (!list || list.archived_at) return bad('That list was not found in this organization.')
    patch.smart_list_id = list.id
    patch.brand = list.brand
  }
  const { data, error } = await ctx.db.from('funnel_campaigns').update(patch).eq('id', b.campaign_id).eq('org_id', org).select('id')
  if (error) return NextResponse.json({ error: 'The campaign could not be updated. Try again in a moment.' }, { status: 500 })
  if ((data?.length ?? 0) !== 1) return NextResponse.json({ error: 'That campaign was not found. Reload the page.' }, { status: 404 })
  return NextResponse.json({ ok: true })
})
