import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import twilio from 'twilio';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const params: Record<string, string> = {};
    formData.forEach((val, key) => { params[key] = val.toString(); });

    const to = params.To;
    const from = params.From;
    const direction = params.Direction; // "inbound" or "outbound-api" or "outbound-dial"

    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();

    // OUTBOUND: Browser is calling a phone number
    // The Voice SDK sends the "To" param as the number to dial
    if (to && /^\+?\d{7,15}$/.test(to.replace(/\s/g, ''))) {
      // Look up a caller ID from org config
      const supabase = createAdminSupabase();
      let callerId = from || '';

      // Try to find the org's Twilio number to use as caller ID
      try {
        const { data: settings } = await supabase
          .from('org_settings')
          .select('setting_value')
          .eq('setting_key', 'crm_twilio')
          .limit(1)
          .single();

        if (settings?.setting_value?.numbers?.length) {
          callerId = settings.setting_value.numbers[0].phone;
        }
      } catch { /* use default */ }

      const dial = response.dial({ callerId });
      dial.number(to);

      return new NextResponse(response.toString(), {
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // INBOUND: Someone calling your Twilio number, ring the browser
    response.say({ voice: 'Polly.Joanna' }, 'Please hold while we connect you.');

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
    const dial = response.dial({
      timeout: 30,
      ...(appUrl ? { action: `${appUrl}/api/twilio/call-status` } : {}),
    });
    dial.client('crm-browser-client');

    // Voicemail if no answer
    response.say({ voice: 'Polly.Joanna' }, 'No one is available. Please leave a message after the beep.');
    response.record({ maxLength: 120, transcribe: false });

    return new NextResponse(response.toString(), {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (e: any) {
    console.error('Inbound call error:', e);
    // Return valid TwiML even on error
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    response.say({ voice: 'Polly.Joanna' }, 'An error occurred. Please try again later.');
    return new NextResponse(response.toString(), {
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}
