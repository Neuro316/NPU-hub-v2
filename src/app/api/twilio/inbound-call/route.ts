import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { getOrgTwilioConfig, pickNumber } from '@/lib/twilio-org';
import twilio from 'twilio';

// Normalize a stored contact phone (which may be "(828) 348-4022", "270-358-6842",
// "(828) 505-7222 ext. 104", etc.) to E.164 for <Dial><Number>. Returns '' if the
// value is not a dialable number (e.g. "Test"), so the caller can reject instead
// of misrouting. This is the crux of the browser-call bug: a formatted number
// failed the old /^\+?\d{7,15}$/ test and fell through to the <Client> branch.
function toE164(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith('client:')) return '';
  // Drop trailing extensions ("ext. 104", "x104") — Twilio can't dial them inline.
  const withoutExt = trimmed.replace(/\s*(?:ext\.?|x)\s*\d+\s*$/i, '');
  const hasPlus = withoutExt.trim().startsWith('+');
  const digits = withoutExt.replace(/\D/g, '');
  if (!digits) return '';
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;               // US 10-digit
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`; // US 1+10
  if (digits.length >= 7) return `+${digits}`;                  // best-effort international
  return '';
}

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

    // INBOUND: Someone calling your Twilio number
    console.log('Inbound call from:', from);
    response.say({ voice: 'Polly.Joanna' }, 'Please hold while we connect you.');

    const dial = response.dial({ timeout: 30 });
    dial.client('crm-browser-client');

    response.say({ voice: 'Polly.Joanna' }, 'No one is available. Please leave a message after the beep.');
    response.record({ maxLength: 120, transcribe: false });

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
