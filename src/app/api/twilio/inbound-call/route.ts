import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
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

    // OUTBOUND: Browser calling a phone number
    // Voice SDK passes the number as "To" parameter
    if (to && !to.startsWith('client:') && to.match(/^\+?\d{7,15}$/)) {
      let callerId = '';

      // Get org's Twilio number for caller ID
      try {
        const supabase = createAdminSupabase();
        const { data: settings } = await supabase
          .from('org_settings')
          .select('setting_value')
          .eq('setting_key', 'crm_twilio')
          .limit(1)
          .single();

        if (settings?.setting_value?.numbers?.length) {
          callerId = settings.setting_value.numbers[0].phone;
        }
      } catch (e) {
        console.warn('Could not load org caller ID:', e);
      }

      if (!callerId) {
        callerId = process.env.TWILIO_PHONE_NUMBER || '';
      }

      console.log('Outbound call - To:', to, 'CallerID:', callerId);

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');

      if (callerId) {
        const dial = response.dial({
          callerId,
          ...(appUrl ? { action: `${appUrl}/api/twilio/call-status` } : {}),
        });
        dial.number(to);
      } else {
        const dial = response.dial({
          ...(appUrl ? { action: `${appUrl}/api/twilio/call-status` } : {}),
        });
        dial.number(to);
      }

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
