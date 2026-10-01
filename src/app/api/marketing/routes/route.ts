// POST /api/marketing/routes   (staff)
// Routing rules: a source key (form:webinar, call:inbound, booking:intro, ...) to a
// campaign. { org_id, campaign_id, source_key, active?, remove? }.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { constraintMessage } from '@/lib/marketing/db-errors'
import { checkSourceKey } from '@/lib/marketing/validate/route'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  // the same check the Campaign Builder agent runs (src/lib/marketing/validate/route.ts)
  const keyCheck = checkSourceKey(b.source_key)
  if (!keyCheck.ok) return bad(keyCheck.message)
  const key = keyCheck.key
  const { data: camp } = await ctx.db.from('funnel_campaigns').select('id').eq('id', b.campaign_id).eq('org_id', org).maybeSingle()
  if (!camp) return bad('That campaign was not found in this organization.')
  if (b.remove === true) {
    const { error } = await ctx.db.from('campaign_routes').delete().eq('org_id', org).eq('campaign_id', camp.id).eq('source_key', key)
    return error ? NextResponse.json({ error: 'The route could not be removed.' }, { status: 500 }) : NextResponse.json({ removed: true })
  }
  const { data, error } = await ctx.db.from('campaign_routes').upsert(
    { org_id: org, campaign_id: camp.id, source_key: key, active: b.active !== false },
    { onConflict: 'org_id,source_key,campaign_id' }).select('*')
  if (error || (data?.length ?? 0) !== 1) return NextResponse.json({ error: constraintMessage(error, 'The source') ?? 'The source could not be saved. Try again in a moment.' }, { status: 500 })
  return NextResponse.json({ route: data![0] })
})
