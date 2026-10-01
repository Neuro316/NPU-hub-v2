// POST /api/webhooks/resend  (PUBLIC; ruling 14)
//
// Resend delivery events. The Svix signature (RESEND_WEBHOOK_SECRET) is verified
// BEFORE any database access; an unsigned, re-signed or stale request is refused 401,
// and a missing secret refuses everything (fails closed). Each event is stored once in
// provider_events (unique on the Svix message id, so Resend's retries are no-ops).
//
//   email.delivered / opened / clicked  -> timestamp on the message_sends row
//   email.bounced (Permanent)           -> bounced, and email suppressed for every kind
//   email.complained                    -> email suppressed for every kind
//
// Never logs addresses: event ids, types and codes only.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { verifySvix } from '@/lib/marketing/svix'

export const dynamic = 'force-dynamic'

const STAMP: Record<string, string> = {
  'email.delivered': 'delivered_at', 'email.opened': 'opened_at', 'email.clicked': 'clicked_at',
  'email.bounced': 'bounced_at', 'email.complained': 'complained_at',
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const v = verifySvix(process.env.RESEND_WEBHOOK_SECRET, {
    id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature'),
  }, raw, Math.floor(Date.now() / 1000))
  if (!v.ok) {
    console.warn(`[webhooks/resend] refused: ${v.reason}`)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  let evt: any
  try { evt = JSON.parse(raw) } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const type = String(evt?.type || '')
  const emailId = typeof evt?.data?.email_id === 'string' ? evt.data.email_id : null
  const db = createAdminSupabase()

  const { data: send } = emailId
    ? await db.from('message_sends').select('id, org_id, contact_id, to_address').eq('external_message_id', emailId).maybeSingle()
    : { data: null }
  const { error: insErr } = await db.from('provider_events').insert({
    provider: 'resend', provider_event_id: req.headers.get('svix-id'), event_type: type, external_message_id: emailId,
    message_send_id: send?.id ?? null, org_id: send?.org_id ?? null, payload: evt,
  })
  if (insErr?.code === '23505') return NextResponse.json({ ok: true, duplicate: true })
  if (insErr) {
    console.error(`[webhooks/resend] store failed: ${insErr.code ?? 'unknown'}`)
    return NextResponse.json({ error: 'store failed' }, { status: 500 })   // Resend retries
  }
  if (!send) return NextResponse.json({ ok: true, matched: false })

  const col = STAMP[type]
  const hardBounce = type === 'email.bounced' && String(evt?.data?.bounce?.type || '').toLowerCase() === 'permanent'
  if (col) {
    const patch: Record<string, unknown> = { [col]: evt?.created_at || new Date().toISOString() }
    if (hardBounce) patch.status = 'bounced'
    await db.from('message_sends').update(patch).eq('id', send.id)
  }
  if (hardBounce || type === 'email.complained') {
    const basis = hardBounce ? 'bounce' : 'complaint'
    if (send.contact_id) {
      const { error } = await db.rpc('record_consent', {
        p_contact: send.contact_id, p_channel: 'email', p_kind: 'all', p_action: 'revoked', p_basis: basis,
        p_source: 'resend_webhook', p_text_shown: null, p_evidence: { send_id: send.id, event: type },
      })
      if (error) console.error(`[webhooks/resend] record_consent ${basis} failed: ${error.code ?? 'unknown'}`)
    } else {
      await db.from('suppressions').insert({ org_id: send.org_id, channel: 'email', address: send.to_address,
        scope: 'all', reason: hardBounce ? 'hard_bounce' : 'complaint', source: 'resend_webhook' })
    }
  }
  await db.from('provider_events').update({ processed_at: new Date().toISOString() })
    .eq('provider', 'resend').eq('provider_event_id', req.headers.get('svix-id'))
  return NextResponse.json({ ok: true })
}
