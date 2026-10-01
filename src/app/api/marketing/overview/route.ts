// GET /api/marketing/overview?org=<uuid>   (staff, src/lib/api-guard.ts)
// Everything the Campaigns hub renders for one org, in one read. Read only.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg } from '@/lib/api-guard'
import { getFlags } from '@/lib/marketing/flags'
import { getSendPolicy, senderProblem } from '@/lib/marketing/policy'

export const dynamic = 'force-dynamic'

export const GET = withStaff(async (req, ctx) => {
  const org = requireOrg(ctx, req.nextUrl.searchParams.get('org'))
  if (typeof org !== 'string') return org
  const db = ctx.db
  const [campaigns, pipelines, stages, sequences, steps, routes, enrollments, forms, assets, tests, flags, policy, positions] = await Promise.all([
    db.from('funnel_campaigns').select('*').eq('org_id', org).order('created_at', { ascending: false }),
    db.from('pipelines').select('id, name, legacy_key, position, archived_at').eq('org_id', org).order('position'),
    db.from('pipeline_stages').select('id, pipeline_id, name, position, color, archived_at').eq('org_id', org).order('position'),
    db.from('sequences').select('id, name, campaign_id, is_active').eq('org_id', org),
    db.from('sequence_steps').select('id, sequence_id, step_order, channel, delay_minutes, subject, body, kind, step_type, asset_id, sequences!inner(org_id)').eq('sequences.org_id', org).order('step_order'),
    db.from('campaign_routes').select('id, source_key, campaign_id, active, priority').eq('org_id', org),
    db.from('campaign_enrollments').select('campaign_id, status').eq('org_id', org),
    db.from('form_definitions').select('*').eq('org_id', org).order('created_at', { ascending: false }),
    db.from('university_assets').select('*').eq('org_id', org).order('created_at', { ascending: false }),
    db.from('campaign_test_contacts').select('id, email, phone, label').eq('org_id', org),
    getFlags(db, org),
    getSendPolicy(db, org),
    db.from('contact_pipeline_positions').select('stage_id').eq('org_id', org),
  ])
  const firstError = [campaigns, pipelines, stages, sequences, steps, routes, enrollments, forms, assets, tests, positions].find((r: any) => r.error)
  if (firstError) return NextResponse.json({ error: 'Some campaign data could not be loaded. Try again.' }, { status: 500 })

  const counts: Record<string, Record<string, number>> = {}
  for (const e of enrollments.data ?? []) {
    counts[e.campaign_id] ??= {}
    counts[e.campaign_id][e.status] = (counts[e.campaign_id][e.status] ?? 0) + 1
  }
  const stageCounts: Record<string, number> = {}
  for (const p of positions.data ?? []) stageCounts[p.stage_id] = (stageCounts[p.stage_id] ?? 0) + 1

  return NextResponse.json({
    campaigns: campaigns.data, pipelines: pipelines.data, stages: stages.data, sequences: sequences.data,
    steps: (steps.data ?? []).map(({ sequences: _s, ...s }: any) => s), routes: routes.data,
    enrollment_counts: counts, stage_counts: stageCounts, forms: forms.data, assets: assets.data,
    test_contacts: tests.data, flags, policy, sender_problem: policy ? senderProblem(policy) : 'policy_unreadable',
    can_go_live: ctx.isSuperadmin,
  })
})
