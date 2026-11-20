import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { createAdminSupabase } from '@/lib/supabase';
import { resolveInboundTwilioAuth } from '@/lib/twilio-org';
import { applyStatusCallback } from '@/lib/texts/status-callback';

// ─── POST /api/twilio/message-status ───
// Twilio message status callback.
//
// ── WHY THIS ROUTE DID NOT EXIST, AND WHAT THAT COST ────────────────────────
// `sendOrgSms` (twilio-org.ts) and `sendSms` (twilio.ts) have BOTH set
// `statusCallback: ${appUrl}/api/twilio/message-status` on every send since they
// were written. The route was never created, so Twilio POSTed every status update
// to a 404 and two things followed:
//
//   1. Every outbound crm_messages row stayed status='queued' FOREVER, including
//      messages known to have been delivered days earlier. The Hub could not tell
//      delivered from failed.
//   2. from_e164 was never learnable. Sends go through a Messaging Service, so
//      TWILIO picks the sender from its pool during queueing and the create-call
//      response carries from=null. This payload is the only place the real sender
//      is ever reported. That is why the 2026-07-24 lost-inbound incident could
//      only be reconstructed from the Twilio API and not from the Hub.
//
// Never sends, never replies, never inserts. Idempotent: keyed on twilio_sid. Forward only (see status-callback.ts).

// The status vocabulary and the forward-only rule live in src/lib/texts/status-callback.ts.

export async function POST(request: NextRequest) {
  const params: Record<string, string> = {};
  try {
    const form = await request.formData();
    // forEach rather than spreading form.entries(): the tsconfig target predates
    // downlevel iteration, the same constraint noted in contacts/duplicates.
    form.forEach((v, k) => { params[k] = String(v); });
  } catch {
    return new NextResponse('Bad Request', { status: 400 });
  }

  // Signature check before any read or write, mirroring inbound-sms/route.ts.
  // On a status callback `From` is the Hub's own number, which is what maps to an
  // org in crm_twilio_numbers.
  const signature = request.headers.get('x-twilio-signature') || '';
  const { authToken } = await resolveInboundTwilioAuth(params.From || '');
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/twilio/message-status`;
  if (!authToken || !twilio.validateRequest(authToken, signature, url, params)) {
    // FAIL LOUDLY, WITH BOTH URLS. Signature validation compares against a URL we
    // RECONSTRUCT from NEXT_PUBLIC_APP_URL; Twilio signed the URL it actually
    // called. If those drift — NEXT_PUBLIC_APP_URL unset so twilio-org.ts falls
    // back to VERCEL_URL, a trailing slash, a domain change — every callback is
    // rejected and delivery status silently stops updating again.
    //
    // A bare 403 is a mystery. Printing both URLs makes it a one-line diagnosis.
    // Deliberately NOT auto-recovering by trusting the forwarded host: a mismatch
    // that works anyway is a config drift nobody ever learns about, which is how
    // the demo.twilio.com misconfiguration ran unnoticed.
    const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '(none)';
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
    console.error(
      '[message-status] SIGNATURE REJECTED.',
      'reconstructed_url=', url,
      '| twilio_called_host=', `${forwardedProto}://${forwardedHost}${request.nextUrl.pathname}`,
      '| NEXT_PUBLIC_APP_URL=', process.env.NEXT_PUBLIC_APP_URL || '(UNSET)',
      '| have_auth_token=', !!authToken,
      '| from=', params.From || '(none)',
      '| sid=', params.MessageSid || params.SmsSid || '(none)',
      '\n  If the two URLs differ, that IS the bug: make NEXT_PUBLIC_APP_URL exactly',
      'the host Twilio calls. If they match, the auth token for that number is wrong.',
    );
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Forward only (q43): a late callback can never move a text back to queued, or out of delivered or failed. The rule
  // is the where clause of the update itself; a backwards callback is logged and its error code still recorded.
  try {
    const r = await applyStatusCallback(createAdminSupabase(), params);
    return NextResponse.json(r);
  } catch (e: any) {
    // Errors are surfaced, never swallowed (a 500 makes Twilio retry the callback).
    console.error('[message-status] update failed for sid', params.MessageSid || params.SmsSid || '(none)', String(e?.message ?? e));
    return NextResponse.json({ ok: false, error: 'update failed' }, { status: 500 });
  }
}
