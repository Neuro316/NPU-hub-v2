import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { resolveInboundOrgContext, appendVoicemail, resolveAppUrl } from '@/lib/inbound-voice';
import twilio from 'twilio';

// `action` handler for the inbound ring <Dial><Client> leg.
//
// THIS IS THE BRANCH POINT the flow previously lacked. Without an action URL,
// Twilio simply continues the original document when the dial ends — identically
// whether the browser answered or not. That meant hanging up in the browser sent
// the caller onward into the greeting + <Record>, i.e. hanging up promoted the
// caller to voicemail instead of ending their call.
//
// DialCallStatus tells the two cases apart:
//   completed                        -> the browser ANSWERED and the call has
//                                       ended. End the caller's leg. NO voicemail.
//   no-answer | busy | failed | canceled
//                                    -> nobody took it (including an explicit
//                                       Decline). Fall through to voicemail.
//
// Because `action` abandons the rest of the original document, the voicemail
// verbs MUST be emitted here — that is what appendVoicemail() is for. The
// no-answer path therefore still reaches greeting + <Record> exactly as before.

export async function POST(request: NextRequest) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  try {
    const params: Record<string, string> = {};
    try {
      const text = await request.text();
      new URLSearchParams(text).forEach((val, key) => { params[key] = val; });
    } catch (e) {
      console.error('ring-complete parse error:', e);
    }

    const dialStatus = (params.DialCallStatus || '').toLowerCase();
    const to = params.To || '';
    console.log('Ring complete:', JSON.stringify({
      DialCallStatus: dialStatus, CallSid: params.CallSid, to,
    }));

    // ── ANSWERED then hung up: end the call. ────────────────────────────────
    // 'completed' means a dialed leg (browser, or the line's forward cell) was
    // answered and has finished. Anything after <Hangup/> would be unreachable,
    // so this is the whole response.
    if (dialStatus === 'completed') {
      // Close the call row by CallSid. Only a row still in a live state is
      // touched, so an earlier mark written by /api/voice/answered (or any
      // other terminal status) is never overwritten. Bookkeeping must never
      // delay the <Hangup/>, hence best-effort.
      const callSid = params.CallSid || '';
      if (callSid) {
        try {
          const admin = createAdminSupabase();
          const { error } = await admin
            .from('call_logs')
            .update({ status: 'completed', ended_at: new Date().toISOString() })
            .eq('external_call_sid', callSid)
            .in('status', ['ringing', 'in_progress']);
          if (error) console.warn('ring-complete: call_log close failed:', error.message);
        } catch (e) {
          console.warn('ring-complete: call_log close skipped:', e);
        }
      }
      response.hangup();
      return new NextResponse(response.toString(), {
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // ── Nobody answered: voicemail, exactly as before. ──────────────────────
    // Per-line greeting (audio, else spoken text), org greeting as fallback.
    const admin = createAdminSupabase();
    const { greetingUrl, greetingText } = await resolveInboundOrgContext(admin, to);
    appendVoicemail(response, { greetingUrl, greetingText, appUrl: resolveAppUrl() });

    return new NextResponse(response.toString(), {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (e: any) {
    console.error('ring-complete CRASH:', e);
    // Fail toward voicemail rather than dead air: a caller who reached us should
    // always be able to leave a message, even if this handler breaks.
    const fallback = new VoiceResponse();
    fallback.say({ voice: 'Polly.Joanna' }, 'Please leave a message after the tone.');
    fallback.record({ maxLength: 120, playBeep: true });
    return new NextResponse(fallback.toString(), {
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}
