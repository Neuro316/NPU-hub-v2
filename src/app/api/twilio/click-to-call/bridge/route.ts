// src/app/api/twilio/click-to-call/bridge/route.ts
// TwiML for the staff leg of a click-to-call (docs/plans/hub-click-to-call-rulings.md).
//
//   no step     the staff member answered: "Press 1 to call <first name>."
//   step=dial   they pressed a key: on a 1, dial the contact from the conversation's
//               line; anything else hangs up and the contact is never dialed.
//
// The Twilio signature is verified before any database access and the route fails
// closed (403). No <Record> and no record attribute: these calls are not recorded.
// This is not inbound-call or ring-complete, so no inbound row and no entry event.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { verifyTwilioWebhook } from '@/lib/click-to-call/verify'
import { findClickToCall } from '@/lib/click-to-call/webhook'
import { mergeAttempt } from '@/lib/click-to-call/server'
import { confirmTwiml, dialTwiml, hangupTwiml, callbackUrls } from '@/lib/click-to-call/logic'
import { voiceSignatureUrl } from '@/lib/twilio-voice-signature'

export const dynamic = 'force-dynamic'

const xml = (body: string) => new NextResponse(body, { headers: { 'Content-Type': 'text/xml' } })

export async function POST(request: NextRequest) {
  const verified = await verifyTwilioWebhook(request, 'click-to-call/bridge')
  if (!verified) return new NextResponse('Forbidden', { status: 403 })
  const { params, orgId } = verified

  const db = createAdminSupabase()
  const callLogId = request.nextUrl.searchParams.get('log') || ''
  const step = request.nextUrl.searchParams.get('step') || ''
  const call = await findClickToCall(db, callLogId, params.CallSid || '', orgId)
  if (!call || !call.to_number || !call.from_number) return xml(hangupTwiml('This call could not be connected. Goodbye.'))
  if (!['ringing', 'in_progress'].includes(call.status)) return xml(hangupTwiml())

  const urls = callbackUrls(voiceSignatureUrl(''), call.id)
  if (step !== 'dial') {
    const { data: contact } = call.contact_id
      ? await db.from('contacts').select('first_name').eq('id', call.contact_id).maybeSingle()
      : { data: null }
    await mergeAttempt(db, { callLogId: call.id }, { staff_answered_at: new Date().toISOString() })
    return xml(confirmTwiml(urls.confirm, (contact as any)?.first_name ?? null))
  }

  if ((params.Digits || '') !== '1') {
    await mergeAttempt(db, { callLogId: call.id }, { staff_pressed: params.Digits || null })
    return xml(hangupTwiml('The call was not placed. Goodbye.'))
  }
  await db.from('call_logs').update({ status: 'in_progress' }).eq('id', call.id).eq('status', 'ringing')
  await mergeAttempt(db, { callLogId: call.id }, { dialed: true, dialed_at: new Date().toISOString() })
  return xml(dialTwiml(call.to_number, call.from_number, urls.dialAction))
}
