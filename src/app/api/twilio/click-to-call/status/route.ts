// src/app/api/twilio/click-to-call/status/route.ts
// Outcome callbacks for a click-to-call (docs/plans/hub-click-to-call-rulings.md).
//
//   leg=dial   the <Dial> action: the contact leg ended. Sets the call_logs outcome
//              and duration (talk time with the contact) and hangs up the staff leg.
//   otherwise  the staff leg's statusCallback. If the contact was never dialed
//              (no answer, or no 1 pressed), the call is 'failed'.
//
// The Twilio signature is verified before any database access and the route fails
// closed (403). This route writes call_logs and the attempt log only: it never
// touches contacts and never raises an entry event.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { verifyTwilioWebhook } from '@/lib/click-to-call/verify'
import { findClickToCall } from '@/lib/click-to-call/webhook'
import { mergeAttempt } from '@/lib/click-to-call/server'
import { dialOutcome, staffLegOutcome, hangupTwiml, TERMINAL_CALL_STATUSES } from '@/lib/click-to-call/logic'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const verified = await verifyTwilioWebhook(request, 'click-to-call/status')
  if (!verified) return new NextResponse('Forbidden', { status: 403 })
  const { params, orgId } = verified

  const db = createAdminSupabase()
  const callLogId = request.nextUrl.searchParams.get('log') || ''
  const leg = request.nextUrl.searchParams.get('leg') || ''
  const call = await findClickToCall(db, callLogId, params.CallSid || '', orgId)
  const ended = new Date().toISOString()

  if (leg === 'dial') {
    if (call) {
      const o = dialOutcome(params.DialCallStatus || '', params.DialCallDuration)
      await db.from('call_logs').update({ status: o.status, duration_seconds: o.seconds, ended_at: ended })
        .eq('id', call.id).in('status', ['ringing', 'in_progress'])
      await mergeAttempt(db, { callLogId: call.id }, {
        dial_call_sid: params.DialCallSid || null, contact_leg_status: params.DialCallStatus || null,
        outcome: o.outcome, duration_seconds: o.seconds, ended_at: ended,
      })
    }
    return new NextResponse(hangupTwiml(), { headers: { 'Content-Type': 'text/xml' } })
  }

  const status = params.CallStatus || ''
  if (call && TERMINAL_CALL_STATUSES.includes(status)) {
    // Only a call the dial action has not already settled is still ringing or in progress.
    const o = staffLegOutcome(status)
    const { data: changed } = await db.from('call_logs').update({ status: o.status, ended_at: ended })
      .eq('id', call.id).in('status', ['ringing', 'in_progress']).select('id')
    await mergeAttempt(db, { callLogId: call.id }, {
      staff_leg_status: status, staff_leg_duration_seconds: Number(params.CallDuration || 0) || 0,
      ...((changed ?? []).length ? { outcome: o.outcome, ended_at: ended } : {}),
    })
  }
  return new NextResponse(null, { status: 204 })
}
