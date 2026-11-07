// POST /api/lead-alerts/test   { org_id }   (staff, superadmin only)
//
// Sends one speed-to-lead test alert now, by Slack DM and SMS, to the recipient configured for that org in
// org_settings 'hub_lead_alerts'. It carries no lead: the text says it is a test. Quiet hours do not apply.
// The recipient comes from the config, never from the request.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, forbidden } from '@/lib/api-guard'
import { sendTestAlert } from '@/lib/lead-alerts/run'
import { realSenders } from '@/lib/lead-alerts/senders'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('Only a superadmin can send a test alert.')
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://hub.neuroprogeny.com'
  try {
    const r = await sendTestAlert({ db: ctx.db, now: () => new Date(), appUrl, senders: realSenders }, org)
    if (r.status === 'no_recipient') return NextResponse.json({ error: 'Speed-to-lead has no recipient for this organization.' }, { status: 409 })
    return NextResponse.json(r)
  } catch (e) {
    console.error(`[lead-alerts/test] org=${org} failed: ${String((e as Error)?.message ?? '').slice(0, 120)}`)
    return NextResponse.json({ error: 'The test alert could not be sent. Try again.' }, { status: 500 })
  }
})
