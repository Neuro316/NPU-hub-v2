// POST /api/marketing/campaigns   (staff)
// Create or update a funnel campaign. The org comes from membership; a campaign id
// in the body is only honoured when that campaign belongs to the caller's org. The
// live switch is NOT settable here: see /api/marketing/campaigns/live.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { constraintMessage } from '@/lib/marketing/db-errors'
import { checkCampaign, dbCampaignLookup } from '@/lib/marketing/validate/campaign'
import { unreviewedAiStepCount } from '@/lib/marketing/ai-review'

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
  if (row.status === 'active') {
    // decision 3 (2026-10-02): a campaign does not go active while any step the Campaign Builder
    // drafted is unreviewed. Both the sequence it has now and the one this save sets are checked,
    // each only if it belongs to this org; a failed read refuses.
    const seqIds: string[] = []
    if (b.id) {
      const { data: cur } = await db.from('funnel_campaigns').select('sequence_id').eq('id', b.id).eq('org_id', org).maybeSingle()
      if ((cur as any)?.sequence_id) seqIds.push((cur as any).sequence_id)
    }
    if (row.sequence_id) {
      const { data: own } = await db.from('sequences').select('id').eq('id', row.sequence_id).eq('org_id', org).maybeSingle()
      if (own) seqIds.push(row.sequence_id)
    }
    const pending = await unreviewedAiStepCount(db, seqIds)
    if (pending === null) return NextResponse.json({ error: 'The campaign\'s steps could not be checked, so it was not activated. Try again in a moment.' }, { status: 503 })
    if (pending > 0) {
      return NextResponse.json({ error: `${pending} ${pending === 1 ? 'step was' : 'steps were'} drafted by the Campaign Builder and ${pending === 1 ? 'has' : 'have'} not been reviewed. Open this campaign's steps, press Approve on each step marked "AI draft, needs review" (or edit and save it), then set the campaign to Active.`, unreviewed_steps: pending }, { status: 409 })
    }
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
