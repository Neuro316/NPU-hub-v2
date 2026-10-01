// POST /api/marketing/campaigns   (staff)
// Create or update a funnel campaign. The org comes from membership; a campaign id
// in the body is only honoured when that campaign belongs to the caller's org. The
// live switch is NOT settable here: see /api/marketing/campaigns/live.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'

export const dynamic = 'force-dynamic'

const STATUSES = ['draft', 'active', 'paused', 'archived']

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  const db = ctx.db
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return bad('Give the campaign a name.')
  if (b.status && !STATUSES.includes(b.status)) return bad('That status is not one the Hub recognises.')

  // every referenced id must belong to this org
  const checks: Array<[string, string, unknown]> = [
    ['pipelines', 'entry_pipeline_id', b.entry_pipeline_id], ['pipeline_stages', 'entry_stage_id', b.entry_stage_id],
    ['pipeline_stages', 'goal_stage_id', b.goal_stage_id], ['sequences', 'sequence_id', b.sequence_id],
    ['campaigns', 'planning_campaign_id', b.planning_campaign_id],
  ]
  for (const [table, field, id] of checks) {
    if (id == null || id === '') continue
    const { data } = await db.from(table).select('id').eq('id', id as string).eq('org_id', org).maybeSingle()
    if (!data) return bad(`The ${field.replace(/_id$/, '').replace(/_/g, ' ')} was not found in this organization.`)
  }
  if (b.entry_stage_id) {
    const { data: st } = await db.from('pipeline_stages').select('pipeline_id').eq('id', b.entry_stage_id).maybeSingle()
    if (st?.pipeline_id !== b.entry_pipeline_id) return bad('The entry stage must belong to the entry pipeline.')
  }
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
    return NextResponse.json({ error: 'The campaign could not be saved.' }, { status: error ? 500 : 404 })
  }
  if (row.sequence_id) await db.from('sequences').update({ campaign_id: data![0].id }).eq('id', row.sequence_id).eq('org_id', org)
  return NextResponse.json({ campaign: data![0] })
})
