// POST /api/marketing/sequences   (staff)
// Create or update the sequence that carries a campaign's steps (ruling 6: campaign
// steps live on sequences). { org_id, id?, name, campaign_id?, steps: [...] }.
// Steps are replaced as a set, numbered 0..n in the order given.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { SMS_PART_MAX } from '@/lib/sms-split'

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
      if (channel === 'sms' && body.length > SMS_PART_MAX) return bad(`${n} is longer than one text message allows.`)
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
    if (error || (data?.length ?? 0) !== 1) return NextResponse.json({ error: 'The sequence was not found.' }, { status: 404 })
  } else {
    const { data, error } = await db.from('sequences').insert({ org_id: org, name, campaign_id: b.campaign_id || null, created_by: ctx.userId, is_active: true }).select('id').single()
    if (error || !data) return NextResponse.json({ error: 'The sequence could not be created.' }, { status: 500 })
    seqId = data.id
  }
  const { error: dErr } = await db.from('sequence_steps').delete().eq('sequence_id', seqId)
  if (dErr) return NextResponse.json({ error: 'The steps could not be replaced.' }, { status: 500 })
  if (rows.length) {
    const { error: iErr } = await db.from('sequence_steps').insert(rows.map((r) => ({ ...r, sequence_id: seqId })))
    if (iErr) return NextResponse.json({ error: 'The steps could not be saved.' }, { status: 500 })
  }
  if (b.campaign_id) await db.from('funnel_campaigns').update({ sequence_id: seqId }).eq('id', b.campaign_id).eq('org_id', org)
  return NextResponse.json({ sequence_id: seqId, steps: rows.length })
})
