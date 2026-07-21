import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { getOrgTwilioConfig, pickNumber } from '@/lib/twilio-org';
import { toE164 } from '@/lib/phone';
import twilio from 'twilio';

export async function POST(request: NextRequest) {
  const VoiceResponse = twilio.twiml.VoiceResponse;

  try {
    // Parse form data - Twilio sends application/x-www-form-urlencoded
    let params: Record<string, string> = {};
    try {
      const text = await request.text();
      const searchParams = new URLSearchParams(text);
      searchParams.forEach((val, key) => { params[key] = val; });
    } catch (e) {
      console.error('Failed to parse request body:', e);
    }

    console.log('Inbound call params:', JSON.stringify(params));

    const to = params.To || '';
    const from = params.From || '';

    const response = new VoiceResponse();

    // OUTBOUND: browser dialing a phone number.
    // The reliable signal is the ORIGIN: the Voice SDK always presents the
    // browser leg as From="client:<identity>". Keying off From (not a regex on
    // To) means a formatted "To" like "(828) 348-4022" still routes to <Dial>
    // <Number> instead of falling through to the <Client> branch (which dialed a
    // nonexistent client and returned Busy).
    const isBrowserOriginated = from.toLowerCase().startsWith('client:');
    if (isBrowserOriginated) {
      const dialTo = toE164(to);
      if (!dialTo) {
        console.warn('Outbound call: undialable To:', JSON.stringify(to));
        response.say({ voice: 'Polly.Joanna' }, 'That number could not be dialed. Please check the contact and try again.');
        return new NextResponse(response.toString(), { headers: { 'Content-Type': 'text/xml' } });
      }

      // Caller ID, org-scoped. The authenticated token route already resolved the
      // correct number for THIS contact's org and passed it as CallerId; validate
      // it against that org's own numbers (OrgId param) and fall back within the
      // org — never the old unfiltered .limit(1).single() that could grab another
      // org's config.
      const admin = createAdminSupabase();
      const orgId = (params.OrgId || '').trim();
      let callerId = '';
      try {
        const config = orgId ? await getOrgTwilioConfig(admin, orgId) : null;
        const orgNumbers = new Set((config?.numbers || []).map(n => n.phone));
        const passed = (params.CallerId || '').trim();
        if (passed && (orgNumbers.size === 0 || orgNumbers.has(passed))) {
          callerId = passed;                                   // token-resolved, validated
        } else if (config) {
          callerId = pickNumber(config, 'manual') || config.numbers?.[0]?.phone || '';
        }
      } catch (e) {
        console.warn('Could not resolve org caller ID:', e);
      }
      if (!callerId) callerId = process.env.TWILIO_PHONE_NUMBER || '';

      console.log('Outbound call - To:', dialTo, 'CallerID:', callerId, 'OrgId:', orgId);

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
      const dial = response.dial({
        ...(callerId ? { callerId } : {}),
        ...(appUrl ? { action: `${appUrl}/api/twilio/call-status` } : {}),
      });
      dial.number(dialTo);

      return new NextResponse(response.toString(), {
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // INBOUND: a real PSTN caller reached an NP number.
    // Forward to a staff phone; on no-answer/busy, fall through to voicemail.
    // (The old code dialed <Client>crm-browser-client</Client> — an identity no
    //  browser registers as, and there is no inbound receiver at all yet — so it
    //  rang nobody for 30s then recorded a voicemail that was never captured. The
    //  browser-receiver <Client> leg is the NEXT diff; this one restores calls by
    //  forwarding to a phone and actually capturing the voicemail.)
    console.log('Inbound call from:', from, 'to:', to);
    const admin = createAdminSupabase();

    // Resolve the receiving number's org + its forward target. Independent of
    // crm_twilio_numbers (not seeded until step 1): match `to` against the numbers
    // configured in org_settings.crm_twilio, and read forward_number from there.
    let orgId: string | null = null;
    let forwardNumber = '';
    let greetingUrl = '';
    try {
      const { data: rows } = await admin
        .from('org_settings')
        .select('org_id, setting_value')
        .eq('setting_key', 'crm_twilio');
      const match = (rows || []).find((r: any) =>
        Array.isArray(r.setting_value?.numbers) &&
        r.setting_value.numbers.some((n: any) => n.phone === to));
      if (match) {
        orgId = match.org_id;
        forwardNumber = String(match.setting_value?.forward_number || '').trim();
        // Custom voicemail greeting (set in CRM Settings -> Twilio). Comes back in
        // this same row, so no extra round-trip. Must be a URL Twilio's servers
        // can fetch UNAUTHENTICATED — a public Storage object, never the
        // session-gated /api/comms/recording proxy (Twilio would get a 401).
        greetingUrl = String(match.setting_value?.greeting_url || '').trim();
        if (greetingUrl && !/^https:\/\//i.test(greetingUrl)) {
          console.warn('Ignoring non-https greeting_url:', greetingUrl);
          greetingUrl = '';
        }
      }
    } catch (e) {
      console.warn('inbound org resolution failed:', e);
    }

    // Normalized last-10 contact match (069 rpc) — same as inbound SMS. Exact
    // .eq('phone', from) missed contacts stored in non-E.164 formats (e.g. the
    // Cameron Allen contact is stored "18287347558" but arrives "+18287347558"),
    // which left the call row's contact_id null and made voicemails invisible in
    // the thread (the timeline loads calls by contact_id).
    let contactId: string | null = null;
    if (orgId && from) {
      const { data: matchedId } = await admin.rpc('match_contact_by_phone', {
        p_org: orgId,
        p_phone: from,
      });
      contactId = (matchedId as string | null) ?? null;
    }

    // Insert the inbound call row keyed by CallSid so recording-ready can attribute
    // the voicemail back to exactly this call. Insert whenever the org resolved —
    // do NOT gate on CallSid (if it ever comes through empty, gating on it would
    // silently skip the row while the forward still proceeds). external_call_sid is
    // nullable + partial-unique, so a null is fine.
    const callSid = params.CallSid || null;
    if (orgId) {
      try {
        await admin.from('call_logs').insert({
          org_id: orgId,
          contact_id: contactId,
          direction: 'inbound',
          status: 'ringing',
          from_number: from,
          to_number: to,
          external_call_sid: callSid,
          started_at: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('inbound call_log insert failed:', e);
      }
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');

    // Forward to the staff phone. callerId = the NP number that was dialed, so the
    // staff phone shows a business call rather than the raw external caller.
    if (forwardNumber) {
      response.say({ voice: 'Polly.Joanna' }, 'Connecting you now.');
      const dial = response.dial({
        timeout: 20,
        ...(to ? { callerId: to } : {}),
      });
      dial.number(forwardNumber);
    }

    // Voicemail fallback — runs when the forward does not connect (no-answer/busy),
    // or immediately if no forward number is configured. recordingStatusCallback ->
    // recording-ready, which attributes by CallSid and marks the row 'voicemail'.
    // Greeting: the org's recorded <Play> when one is set, otherwise the default
    // <Say>. Degrading to <Say> (rather than silence) means a missing/removed
    // greeting still gives the caller a usable prompt.
    if (greetingUrl) {
      response.play(greetingUrl);
    } else {
      response.say({ voice: 'Polly.Joanna' }, 'Please leave a message after the tone.');
    }
    response.record({
      maxLength: 120,
      playBeep: true,
      ...(appUrl ? {
        recordingStatusCallback: `${appUrl}/api/twilio/recording-ready`,
        // Twilio built-in transcription -> posts to /transcription (v1, swappable).
        transcribe: true,
        transcribeCallback: `${appUrl}/api/twilio/transcription`,
      } : {}),
    });
    response.say({ voice: 'Polly.Joanna' }, 'We did not receive a message. Goodbye.');

    return new NextResponse(response.toString(), {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (e: any) {
    console.error('Inbound call route CRASH:', e);
    const response = new VoiceResponse();
    response.say('We are sorry, please try again later.');
    return new NextResponse(response.toString(), {
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}

// Also handle GET in case Twilio sends GET
export async function GET() {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  response.say('This endpoint only accepts POST requests.');
  return new NextResponse(response.toString(), {
    headers: { 'Content-Type': 'text/xml' },
  });
}
