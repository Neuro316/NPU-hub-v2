// POST /api/marketing/test-enroll   (org admins and platform superadmins)
// "Test drive": puts an allowlisted test contact (campaign_test_contacts) into a
// campaign through the real engine, public.enroll, with a one-off event id. Nobody
// outside the allowlist can be enrolled from here. The campaign-steps cron then runs
// the steps through the gate; with gate_live_sends off every step is a dry run.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, isOrgAdmin, forbidden, bad } from '@/lib/api-guard'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  if (!isOrgAdmin(ctx, org)) return forbidden('Only an admin of this organization can run a test drive.')
  const db = ctx.db
  const { data: camp } = await db.from('funnel_campaigns').select('id, status').eq('id', b.campaign_id).eq('org_id', org).maybeSingle()
  if (!camp) return bad('That campaign was not found in this organization.')
  const { data: tests } = await db.from('campaign_test_contacts').select('email, phone').eq('org_id', org)
  const emails = (tests ?? []).map((t: any) => String(t.email || '').toLowerCase()).filter(Boolean)
  if (!emails.length) return bad('Add a test contact to the allowlist first.')
  const { data: contacts } = await db.from('contacts').select('id, email').eq('org_id', org).is('merged_into_id', null)
    .in('email', emails).order('created_at', { ascending: true }).limit(1)
  const contact = contacts?.[0]
  if (!contact) return bad('No contact in this organization matches the test allowlist email.')
  const { data, error } = await db.rpc('enroll', { p_contact: contact.id, p_campaign: camp.id,
    p_source_key: 'manual:test_drive', p_event_id: `test_drive:${Date.now()}:${ctx.userId}` })
  if (error) return NextResponse.json({ error: 'The test contact could not be enrolled.' }, { status: 500 })
  return NextResponse.json({ result: data })
})
