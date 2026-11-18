// GET /api/marketing/campaigns/<id>/activity   (staff, read only)
// The latest send decisions and messages for one campaign, so the campaign page can
// show a test drive's result and its reason without opening the contact drawer.
// Returns no addresses and no message bodies of anyone other than the org's own
// allowlisted test contacts.
//
// latest_test_drive: the most recent test drive (source_key manual:test_drive), shown even after it has ended: when it
// started, its status and end_reason, and each step the engine recorded for it (contact_timeline
// 'campaign_test_step': decision, reason, mode, outcome), with that step's rendered subject and body when the contact is
// an allowlisted test contact.
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

  // the latest test drive, ended or not, and what each of its steps did
  const { data: drive } = await db.from('campaign_enrollments').select('id, contact_id, status, enrolled_at, ended_at, end_reason')
    .eq('campaign_id', c.id).eq('source_key', 'manual:test_drive').order('enrolled_at', { ascending: false }).limit(1).maybeSingle()
  let latestTestDrive: any = null
  if (drive) {
    const { data: tl } = await db.from('contact_timeline').select('metadata, occurred_at')
      .eq('source_table', 'campaign_enrollments').eq('source_id', (drive as any).id).eq('event_type', 'campaign_test_step')
      .order('occurred_at', { ascending: true }).limit(50)
    const sendIds = (tl ?? []).map((t: any) => t.metadata?.send_id).filter((x: unknown): x is string => typeof x === 'string')
    const { data: msgs } = sendIds.length
      ? await db.from('message_sends').select('id, contact_id, status, dry_run, skip_reason, subject, rendered_body').in('id', sendIds)
      : { data: [] as any[] }
    const byId = new Map((msgs ?? []).map((m: any) => [m.id, m]))
    const showBody = testIds.has((drive as any).contact_id)
    latestTestDrive = {
      enrollment_id: (drive as any).id, status: (drive as any).status, enrolled_at: (drive as any).enrolled_at,
      ended_at: (drive as any).ended_at, end_reason: (drive as any).end_reason,
      steps: (tl ?? []).map((t: any) => {
        const m = t.metadata ?? {}
        const send = m.send_id ? byId.get(m.send_id) : null
        return { at: t.occurred_at, step_order: m.step_order ?? null, channel: m.channel ?? null, outcome: m.outcome ?? null, mode: m.mode ?? null,
          decision: m.decision ?? null, reason: m.reason ?? null,
          send_status: send?.status ?? null, skip_reason: send?.skip_reason ?? null,
          subject: showBody ? send?.subject ?? null : null, rendered_body: showBody ? send?.rendered_body ?? null : null }
      }),
    }
  }
  return NextResponse.json({
    latest_test_drive: latestTestDrive,
    test_contact_ids: Array.from(testIds),
    decisions: (decisions.data ?? []).map((d: any) => ({ ...d, is_test: testIds.has(d.contact_id) })),
    sends: (sends.data ?? []).map((s: any) => testIds.has(s.contact_id) ? { ...s, is_test: true } : { ...s, subject: null, rendered_body: null, is_test: false }),
    test_enrollments: enrollments.data ?? [],
  })
})
