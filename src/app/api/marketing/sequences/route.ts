// POST /api/marketing/sequences   (staff)
// Create or update the sequence that carries a campaign's steps (ruling 6: campaign
// steps live on sequences). { org_id, id?, name, campaign_id?, steps: [...] }.
// Steps are numbered 0..n in the order given; a step keeps its id at its position.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { checkSequenceHead, checkSteps } from '@/lib/marketing/validate/sequence'
import { teamMemberId } from '@/lib/marketing/team-member'
import { constraintMessage } from '@/lib/marketing/db-errors'
import { carryMarkers, type ExistingStep } from '@/lib/marketing/step-markers'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  const db = ctx.db
  // the same checks the Campaign Builder agent runs (src/lib/marketing/validate/sequence.ts)
  const head = checkSequenceHead(b)
  if (!head.ok) return bad(head.message)
  const name = head.name

  const { data: assets } = await db.from('university_assets').select('id').eq('org_id', org)
  const assetIds = new Set<string>((assets ?? []).map((a: any) => a.id))
  const stepCheck = checkSteps(head.steps, assetIds)
  if (!stepCheck.ok) return bad(stepCheck.message)
  const rows = stepCheck.rows
  if (b.campaign_id) {
    const { data: c } = await db.from('funnel_campaigns').select('id').eq('id', b.campaign_id).eq('org_id', org).maybeSingle()
    if (!c) return bad('That campaign was not found in this organization.')
  }

  let seqId: string = b.id
  if (seqId) {
    const { data, error } = await db.from('sequences').update({ name, campaign_id: b.campaign_id || null, updated_at: new Date().toISOString() })
      .eq('id', seqId).eq('org_id', org).select('id')
    if (error) return NextResponse.json({ error: constraintMessage(error, 'The steps') ?? 'The steps could not be saved. Try again in a moment.' }, { status: 500 })
    if ((data?.length ?? 0) !== 1) return NextResponse.json({ error: "This campaign's step list was not found. Reload the page and save again." }, { status: 404 })
  } else {
    // created_by references team_members(id), not the auth user id (src/lib/marketing/team-member.ts)
    const createdBy = await teamMemberId(db, org, ctx.userId)
    const { data, error } = await db.from('sequences').insert({ org_id: org, name, campaign_id: b.campaign_id || null, created_by: createdBy, is_active: true }).select('id').single()
    if (error || !data) return NextResponse.json({ error: constraintMessage(error, 'The steps') ?? 'The steps could not be saved. Try again in a moment.' }, { status: 500 })
    seqId = data.id
  }
  // Update in place by position, so a step keeps its id (the send dedupe key includes it:
  // a new id would let an edited, already-sent step go out again), and so the sequence is
  // never empty part way through a save (an empty sequence ends every enrollment in it).
  const { data: existing, error: eErr } = await db.from('sequence_steps')
    .select('id, step_order, channel, delay_minutes, subject, body, kind, step_type, asset_id, ai_run_id, ai_reviewed_at').eq('sequence_id', seqId)
  if (eErr) return NextResponse.json({ error: 'The steps could not be read.' }, { status: 500 })
  const byOrder = new Map((existing ?? []).map((x: any) => [x.step_order as number, x.id as string]))
  // the AI review marker follows each step's content, not the row it lands on (step-markers.ts)
  const markers = carryMarkers((existing ?? []) as ExistingStep[], rows.map((r, i) => ({ id: head.steps[i]?.id, row: r })), new Date().toISOString())
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const id = byOrder.get(r.step_order)
    const full = { ...r, ...markers[i] }
    const { data, error } = id
      ? await db.from('sequence_steps').update(full).eq('id', id).select('id')
      : await db.from('sequence_steps').insert({ ...full, sequence_id: seqId }).select('id')
    if (error || (data?.length ?? 0) !== 1) return NextResponse.json({ error: constraintMessage(error, `Step ${r.step_order + 1}`)?.concat(' Earlier steps were saved.') ?? `Step ${r.step_order + 1} could not be saved. Earlier steps were saved.` }, { status: 500 })
  }
  const extra = (existing ?? []).filter((x: any) => x.step_order >= rows.length).map((x: any) => x.id)
  if (extra.length) {
    const { error: dErr } = await db.from('sequence_steps').delete().in('id', extra)
    if (dErr) return NextResponse.json({ error: 'The removed steps could not be deleted.' }, { status: 500 })
  }
  if (b.campaign_id) await db.from('funnel_campaigns').update({ sequence_id: seqId }).eq('id', b.campaign_id).eq('org_id', org)
  return NextResponse.json({ sequence_id: seqId, steps: rows.length })
})
