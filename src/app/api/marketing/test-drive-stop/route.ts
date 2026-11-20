// POST /api/marketing/test-drive-stop   { org_id, campaign_id }   (platform superadmins of that org)
// "Stop test drive": ends the campaign's latest ACTIVE test drive (campaign_enrollments with source_key
// manual:test_drive). Its campaign_enrollments row becomes exited with end_reason test_drive_stopped, and its
// sequence_enrollments row completed, so no further step runs. The same org check as Run test drive
// (/api/marketing/test-enroll): the campaign must belong to the org the caller is a member of. Nothing is sent.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, forbidden, bad } from '@/lib/api-guard'
import { TEST_DRIVE_SOURCE } from '@/lib/marketing/exits'

export const dynamic = 'force-dynamic'

const STOP_REASON = 'test_drive_stopped'

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  if (!ctx.isSuperadmin) return forbidden('Only a platform superadmin can stop a test drive.')
  const db = ctx.db
  const { data: camp } = await db.from('funnel_campaigns').select('id').eq('id', b.campaign_id).eq('org_id', org).maybeSingle()
  if (!camp) return bad('That campaign was not found in this organization.')
  const { data: drive, error } = await db.from('campaign_enrollments').select('id')
    .eq('campaign_id', camp.id).eq('source_key', TEST_DRIVE_SOURCE).eq('status', 'active').order('enrolled_at', { ascending: false }).limit(1).maybeSingle()
  if (error) return NextResponse.json({ error: 'The test drive could not be read.' }, { status: 500 })
  if (!drive) return bad('No test drive is running for this campaign.')
  const at = new Date().toISOString()
  const { error: sErr } = await db.from('sequence_enrollments').update({ status: 'completed', completed_at: at, next_step_at: null })
    .eq('campaign_enrollment_id', drive.id).eq('status', 'active')
  if (sErr) return NextResponse.json({ error: 'The test drive could not be stopped.' }, { status: 500 })
  const { data: done, error: cErr } = await db.from('campaign_enrollments').update({ status: 'exited', ended_at: at, end_reason: STOP_REASON })
    .eq('id', drive.id).eq('status', 'active').select('id')
  if (cErr) return NextResponse.json({ error: 'The test drive could not be stopped.' }, { status: 500 })
  return NextResponse.json({ stopped: (done ?? []).length === 1, enrollment_id: drive.id })
})
