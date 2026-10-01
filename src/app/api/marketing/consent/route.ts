// POST /api/marketing/consent   (staff)
// A team member records a consent decision a person made outside a form, for example
// on a call. { contact_id, channel, kind, action, text_shown }. A grant must say what
// the person agreed to, in their words or the words read to them; a revoke never
// needs text. Goes through public.record_consent, the single write door (ruling 4).
import { NextResponse } from 'next/server'
import { withStaff, bad } from '@/lib/api-guard'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const { data: c } = await ctx.db.from('contacts').select('id, org_id').eq('id', b?.contact_id).maybeSingle()
  if (!c || !ctx.orgIds.includes(c.org_id)) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
  if (!['email', 'sms'].includes(b.channel) || !['marketing', 'service'].includes(b.kind) || !['granted', 'revoked'].includes(b.action)) {
    return bad('Choose a channel, a kind, and whether consent was given or withdrawn.')
  }
  const text = typeof b.text_shown === 'string' ? b.text_shown.trim() : ''
  if (b.action === 'granted' && text.length < 10) return bad('Write down what the person agreed to, so the record can be shown later.')
  const { data, error } = await ctx.db.rpc('record_consent', {
    p_contact: c.id, p_channel: b.channel, p_kind: b.kind, p_action: b.action,
    p_basis: b.action === 'granted' ? 'express_consent' : 'admin', p_source: 'admin', p_text_shown: text || null,
    p_evidence: { recorded_by: ctx.userId, method: 'admin_ui' }, p_actor: ctx.userId,
  })
  if (error) return NextResponse.json({ error: 'The consent record could not be saved.' }, { status: 500 })
  return NextResponse.json({ recorded: data })
})
