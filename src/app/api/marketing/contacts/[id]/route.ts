// GET /api/marketing/contacts/<id>   (staff)
// The contact drawer's Timeline, Consent and Campaigns tabs, plus source attribution.
// The contact's org must be one of the caller's orgs. Read only.
import { NextResponse } from 'next/server'
import { withStaff } from '@/lib/api-guard'

export const dynamic = 'force-dynamic'

export const GET = withStaff<{ id: string }>(async (_req, ctx, params) => {
  const db = ctx.db
  const { data: c } = await db.from('contacts')
    .select('id, org_id, first_name, last_name, email, phone, source, acquisition_source, acquisition_campaign, acquisition_utm, created_at, merged_into_id, email_consent, sms_consent, do_not_contact')
    .eq('id', params.id).maybeSingle()
  if (!c || !ctx.orgIds.includes(c.org_id)) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })

  const [timeline, consent, enrollments, sends, decisions, positions] = await Promise.all([
    db.from('contact_timeline').select('id, event_type, title, description, occurred_at, metadata').eq('contact_id', c.id).order('occurred_at', { ascending: false }).limit(100),
    db.from('consent_events').select('id, channel, kind, action, basis, source, text_shown, occurred_at').eq('contact_id', c.id).order('occurred_at', { ascending: false }).order('seq', { ascending: false }),
    db.from('campaign_enrollments').select('id, campaign_id, source_key, event_id, status, enrolled_at, ended_at, end_reason, funnel_campaigns(name)').eq('contact_id', c.id).order('enrolled_at', { ascending: false }),
    db.from('message_sends').select('id, channel, kind, status, dry_run, subject, skip_reason, error_code, claimed_at, sent_at, delivered_at, opened_at, clicked_at, bounced_at').eq('contact_id', c.id).order('claimed_at', { ascending: false }).limit(50),
    db.from('send_log').select('id, channel, kind, decision, mode, step, reason, created_at').eq('contact_id', c.id).order('created_at', { ascending: false }).limit(50),
    db.from('contact_pipeline_positions').select('pipeline_id, stage_id, moved_at, source, pipeline_stages(name), pipelines(name)').eq('contact_id', c.id),
  ])
  const state: Record<string, unknown> = {}
  for (const ch of ['email', 'sms']) for (const k of ['marketing', 'service']) {
    const { data } = await db.rpc('consent_state', { p_contact: c.id, p_channel: ch, p_kind: k })
    state[`${ch}:${k}`] = data
  }
  return NextResponse.json({
    contact: c, consent_state: state, consent_events: consent.data ?? [], enrollments: enrollments.data ?? [],
    sends: sends.data ?? [], decisions: decisions.data ?? [], timeline: timeline.data ?? [], positions: positions.data ?? [],
  })
})
