// POST /api/marketing/sequences   (staff)
// Create or update the sequence that carries a campaign's steps (ruling 6: campaign
// steps live on sequences). { org_id, id?, name, campaign_id?, steps: [...] }.
// Steps are numbered 0..n in the order given; a step keeps its id at its position.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { SMS_PART_MAX } from '@/lib/sms-split'
import { SMS_STOP_LINE } from '@/lib/marketing/render'
import { teamMemberId } from '@/lib/marketing/team-member'
import { constraintMessage } from '@/lib/marketing/db-errors'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  const db = ctx.db
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return bad('Give the sequence a name.')
  const steps: any[] = Array.isArray(b.steps) ? b.steps : []
  if (steps.length > 30) return bad('A sequence can have at most 30 steps.')

  const { data: assets } = await db.from('university_assets').select('id').eq('org_id', org)
  const assetIds = new Set((assets ?? []).map((a: any) => a.id))
  const rows: any[] = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] ?? {}
    const n = `Step ${i + 1}`
    const channel = s.channel
    if (!['email', 'sms', 'wait'].includes(channel)) return bad(`${n} needs a channel: email, text message, or wait.`)
    const delay = Number.isFinite(Number(s.delay_minutes)) ? Math.max(0, Math.round(Number(s.delay_minutes))) : 0
    const stepType = s.step_type === 'deliver_asset' ? 'deliver_asset' : 'message'
    const kind = channel === 'wait' ? null : (s.kind === 'service' ? 'service' : 'marketing')
    const body = typeof s.body === 'string' ? s.body : ''
    if (channel !== 'wait') {
      if (!body.trim() && stepType === 'message') return bad(`${n} needs a message.`)
      if (channel === 'email' && !String(s.subject || '').trim()) return bad(`${n} needs a subject line.`)
      // leave room for the STOP line marketing texts get, and for names merged in
      if (channel === 'sms' && body.length + (kind === 'marketing' ? SMS_STOP_LINE.length + 1 : 0) + 60 > SMS_PART_MAX) {
        return bad(`${n} is too long for one text message once names and the opt out line are added.`)
      }
    }
    if (stepType === 'deliver_asset' && !assetIds.has(s.asset_id)) return bad(`${n} delivers a University asset, so choose one from the list.`)
    rows.push({ step_order: i, channel, delay_minutes: delay, subject: channel === 'email' ? String(s.subject).trim() : null,
      body: channel === 'wait' ? null : body, kind, step_type: stepType, asset_id: stepType === 'deliver_asset' ? s.asset_id : null })
  }
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
  const { data: existing, error: eErr } = await db.from('sequence_steps').select('id, step_order').eq('sequence_id', seqId)
  if (eErr) return NextResponse.json({ error: 'The steps could not be read.' }, { status: 500 })
  const byOrder = new Map((existing ?? []).map((x: any) => [x.step_order as number, x.id as string]))
  for (const r of rows) {
    const id = byOrder.get(r.step_order)
    const { data, error } = id
      ? await db.from('sequence_steps').update(r).eq('id', id).select('id')
      : await db.from('sequence_steps').insert({ ...r, sequence_id: seqId }).select('id')
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
