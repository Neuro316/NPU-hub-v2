// POST /api/marketing/preview   (staff)
// Renders one step exactly as the engine would, for a sample person or a chosen
// contact. Writes nothing. { org_id, channel, kind, subject, body, contact_id?, with_asset? }
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { renderStep } from '@/lib/marketing/render'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  if (!['email', 'sms'].includes(b.channel)) return bad('Choose email or text message.')
  let contact: any = { first_name: 'Alex', last_name: 'Rivera', email: 'alex@example.com', phone: '+15555550123', pipeline_stage: 'New Lead' }
  if (b.contact_id) {
    const { data } = await ctx.db.from('contacts').select('first_name, last_name, email, phone, pipeline_stage').eq('id', b.contact_id).eq('org_id', org).maybeSingle()
    if (data) contact = data
  }
  const { data: o } = await ctx.db.from('organizations').select('name').eq('id', org).maybeSingle()
  const r = renderStep({
    channel: b.channel, kind: b.kind === 'service' ? 'service' : 'marketing', subject: b.subject ?? '', body: b.body ?? '',
    contact, orgName: o?.name ?? '', unsubscribeUrl: 'https://hub.neuroprogeny.com/api/email/unsubscribe?t=preview',
    assetUrl: b.with_asset ? 'https://hub.neuroprogeny.com/a/preview-link' : null,
  })
  return NextResponse.json({ ...r, characters: r.text.length })
})
