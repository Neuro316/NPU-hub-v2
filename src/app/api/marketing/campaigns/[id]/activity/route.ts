// GET /api/marketing/campaigns/<id>/activity   (staff, read only)
// The latest send decisions and messages for one campaign, so the campaign page can
// show a test drive's result and its reason without opening the contact drawer.
// Returns no addresses and no message bodies of anyone other than the org's own
// allowlisted test contacts.
import { NextResponse } from 'next/server'
import { withStaff } from '@/lib/api-guard'

export const dynamic = 'force-dynamic'

export const GET = withStaff<{ id: string }>(async (_req, ctx, params) => {
  const db = ctx.db
  const { data: c } = await db.from('funnel_campaigns').select('id, org_id').eq('id', params.id).maybeSingle()
  if (!c || !ctx.orgIds.includes(c.org_id)) return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 })
  const [decisions, sends, tests, enrollments] = await Promise.all([
    db.from('send_log').select('id, contact_id, channel, kind, decision, mode, step, reason, detail, created_at').eq('campaign_id', c.id).order('created_at', { ascending: false }).limit(10),
    db.from('message_sends').select('id, contact_id, channel, kind, status, dry_run, skip_reason, error_code, subject, rendered_body, claimed_at').eq('source_kind', 'campaign').eq('source_id', c.id).order('claimed_at', { ascending: false }).limit(10),
    db.from('campaign_test_contacts').select('email, phone').eq('org_id', c.org_id),
    db.from('campaign_enrollments').select('id, contact_id, source_key, status, enrolled_at').eq('campaign_id', c.id).like('source_key', 'manual:%').order('enrolled_at', { ascending: false }).limit(5),
  ])
  // bodies are shown only for test contacts, so this view never displays a real person's message
  const testEmails = (tests.data ?? []).map((t: any) => String(t.email || '').toLowerCase()).filter(Boolean)
  const { data: testContacts } = testEmails.length
    ? await db.from('contacts').select('id').eq('org_id', c.org_id).in('email', testEmails)
    : { data: [] as any[] }
  const testIds = new Set((testContacts ?? []).map((x: any) => x.id))
  return NextResponse.json({
    test_contact_ids: Array.from(testIds),
    decisions: (decisions.data ?? []).map((d: any) => ({ ...d, is_test: testIds.has(d.contact_id) })),
    sends: (sends.data ?? []).map((s: any) => testIds.has(s.contact_id) ? { ...s, is_test: true } : { ...s, subject: null, rendered_body: null, is_test: false }),
    test_enrollments: enrollments.data ?? [],
  })
})
