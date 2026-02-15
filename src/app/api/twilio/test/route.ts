import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { getOrgTwilioConfig, createOrgTwilioClient } from '@/lib/twilio-org';

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { org_id } = await request.json();
  if (!org_id) return NextResponse.json({ error: 'org_id required' }, { status: 400 });

  try {
    const config = await getOrgTwilioConfig(supabase, org_id);

    // Check if credentials exist
    if (!config.account_sid || !config.auth_token) {
      return NextResponse.json({
        success: false,
        error: 'No Twilio credentials found. Enter Account SID and Auth Token, then save.',
        checks: { credentials: false, connection: false, numbers: false, voice: false },
      });
    }

    const checks: Record<string, boolean | string> = {
      credentials: true,
      connection: false,
      messaging: false,
      numbers: false,
      voice: false,
    };

    // Test connection by fetching account info
    try {
      const client = createOrgTwilioClient(config);
      const account = await client.api.accounts(config.account_sid).fetch();
      checks.connection = true;
      checks.account_name = account.friendlyName;
      checks.account_status = account.status;
    } catch (e: any) {
      return NextResponse.json({
        success: false,
        error: `Connection failed: ${e.message || 'Invalid Account SID or Auth Token'}`,
        checks,
      });
    }

    // Check messaging service
    if (config.messaging_service_sid) {
      try {
        const client = createOrgTwilioClient(config);
        const svc = await client.messaging.v1.services(config.messaging_service_sid).fetch();
        checks.messaging = true;
        checks.messaging_name = svc.friendlyName;
      } catch {
        checks.messaging = 'Invalid Messaging Service SID';
      }
    } else {
      checks.messaging = 'Not configured (will use phone number directly)';
    }

    // Check numbers
    if (config.numbers?.length > 0) {
      const validNumbers = config.numbers.filter(n => n.phone?.trim());
      checks.numbers = validNumbers.length > 0;
      checks.number_count = `${validNumbers.length} number${validNumbers.length !== 1 ? 's' : ''} configured`;
      checks.number_details = validNumbers.map(n => `${n.phone} (${n.purpose})`).join(', ');
    } else {
      checks.numbers = 'No phone numbers added';
    }

    // Check voice config
    if (config.api_key && config.api_secret && config.twiml_app_sid) {
      checks.voice = true;
    } else {
      const missing = [];
      if (!config.api_key) missing.push('API Key');
      if (!config.api_secret) missing.push('API Secret');
      if (!config.twiml_app_sid) missing.push('TwiML App SID');
      checks.voice = `Missing: ${missing.join(', ')}`;
    }

    return NextResponse.json({
      success: true,
      checks,
    });
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      error: e.message || 'Unknown error',
      checks: { credentials: false, connection: false, numbers: false, voice: false },
    });
  }
}
