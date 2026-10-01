// POST /api/marketing/campaigns   (staff)
// Create or update a funnel campaign. The org comes from membership; a campaign id
// in the body is only honoured when that campaign belongs to the caller's org. The
// live switch is NOT settable here: see /api/marketing/campaigns/live.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { constraintMessage } from '@/lib/marketing/db-errors'
import { checkCampaign, dbCampaignLookup } from '@/lib/marketing/validate/campaign'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  const db = ctx.db
  // the same checks the Campaign Builder agent runs (src/lib/marketing/validate/campaign.ts)
  const check = await checkCampaign(b, dbCampaignLookup(db, org))
  if (!check.ok) return bad(check.message)
  const name = check.name
  const row = {
    org_id: org, name, description: b.description ?? null, status: b.status ?? 'draft',
    entry_pipeline_id: b.entry_pipeline_id || null, entry_stage_id: b.entry_stage_id || null,
    goal_stage_id: b.goal_stage_id || null, goal: b.goal && typeof b.goal === 'object' ? b.goal : {},
    sequence_id: b.sequence_id || null, planning_campaign_id: b.planning_campaign_id || null,
    updated_at: new Date().toISOString(),
  }
  const q = b.id
    ? db.from('funnel_campaigns').update(row).eq('id', b.id).eq('org_id', org).select('*')
    : db.from('funnel_campaigns').insert({ ...row, created_by: ctx.userId }).select('*')
  const { data, error } = await q
  if (error || (data?.length ?? 0) !== 1) {
    return NextResponse.json({ error: constraintMessage(error, 'The campaign') ?? (error ? 'The campaign could not be saved. Try again in a moment.' : 'That campaign was not found. Reload the page.') }, { status: error ? 500 : 404 })
  }
  if (row.sequence_id) await db.from('sequences').update({ campaign_id: data![0].id }).eq('id', row.sequence_id).eq('org_id', org)
  return NextResponse.json({ campaign: data![0] })
})
