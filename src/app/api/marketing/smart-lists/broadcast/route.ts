// POST /api/marketing/smart-lists/broadcast   (org admin)
// { org_id, list_id, name, channel, subject?, body }
// A broadcast is a DRAFT campaign with one step, targeting a list. This is the only thing it does:
// it adds no send path. Activating it, enrolling the list and the live switch stay separate steps,
// and every message still goes through gate_check.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, isOrgAdmin, forbidden, bad } from '@/lib/api-guard'
import { checkSteps } from '@/lib/marketing/validate/sequence'
import { teamMemberId } from '@/lib/marketing/team-member'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  if (!isOrgAdmin(ctx, org)) return forbidden('Only an organization admin can create a broadcast.')
  const db = ctx.db
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return bad('Give the broadcast a name.')
  const { data: list } = await db.from('smart_lists').select('id, brand, archived_at').eq('id', b.list_id).eq('org_id', org).maybeSingle()
  if (!list || list.archived_at) return bad('That list was not found in this organization.')
  const check = checkSteps([{ channel: b.channel, subject: b.subject, body: b.body, kind: 'marketing', delay_minutes: 0 }], new Set())
  if (!check.ok) return bad(check.message.replace('Step 1', 'The broadcast'))

  const fail = () => NextResponse.json({ error: 'The broadcast could not be saved. Try again in a moment.' }, { status: 500 })
  const { data: camp, error: cErr } = await db.from('funnel_campaigns').insert({
    org_id: org, name, status: 'draft', smart_list_id: list.id, brand: list.brand, created_by: ctx.userId,
  }).select('id').single()
  if (cErr || !camp) return fail()
  const createdBy = await teamMemberId(db, org, ctx.userId)
  const { data: seq, error: sErr } = await db.from('sequences')
    .insert({ org_id: org, name, campaign_id: camp.id, created_by: createdBy, is_active: true }).select('id').single()
  if (sErr || !seq) return fail()
  const { error: stErr } = await db.from('sequence_steps').insert({ ...check.rows[0], sequence_id: seq.id })
  if (stErr) return fail()
  const { error: uErr } = await db.from('funnel_campaigns').update({ sequence_id: seq.id }).eq('id', camp.id).eq('org_id', org)
  if (uErr) return fail()
  return NextResponse.json({ campaign_id: camp.id })
})
