import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { voiceSignatureUrl } from '@/lib/twilio-voice-signature';
import { handleIntelligenceCallback, type CallLogForTranscript } from '@/lib/voice-intelligence';

// Twilio Voice Intelligence completion webhook (the Service's WebhookUrl).
// Saves the speaker-labeled transcript of an ANSWERED call onto its call_logs
// row. The logic and its tests live in src/lib/voice-intelligence.ts; this route
// only supplies the database and the Twilio fetch.
//
// Signature checked FAIL CLOSED before any write, against the auth token of the
// Hub org that owns the posting Twilio account. The signed URL is rebuilt from
// NEXT_PUBLIC_APP_URL (as every other Twilio route here does) plus the query
// string Twilio called with, which is where bodySHA256 rides for a JSON body.

export async function POST(request: NextRequest) {
  const rawBody = await request.text().catch(() => '');
  const base = voiceSignatureUrl('/api/twilio/intelligence');
  if (!base) {
    console.error('intelligence: NEXT_PUBLIC_APP_URL unset; rejecting');
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const db = createAdminSupabase();

  // Twilio account -> auth token, from the org configs that carry it, with the
  // single-account env token as the last resort (same order as voice webhooks).
  const accountTwilio = async (accountSid: string) => {
    const { data } = await db.from('org_settings').select('org_id, setting_value')
      .eq('setting_key', 'crm_twilio').eq('setting_value->>account_sid', accountSid);
    return (data ?? []) as { org_id: string; setting_value: any }[];
  };

  try {
    const result = await handleIntelligenceCallback(
      {
        rawBody,
        contentType: request.headers.get('content-type') || '',
        url: base + request.nextUrl.search,
        signature: request.headers.get('x-twilio-signature') || '',
      },
      {
        async authTokenForAccount(accountSid) {
          const rows = await accountTwilio(accountSid);
          const token = rows.find(r => r.setting_value?.auth_token)?.setting_value.auth_token;
          if (token) return token;
          if (process.env.TWILIO_ACCOUNT_SID === accountSid && process.env.TWILIO_AUTH_TOKEN) return process.env.TWILIO_AUTH_TOKEN;
          return null;
        },
        async getJson(url, creds) {
          const res = await fetch(url, {
            headers: { Authorization: 'Basic ' + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64') },
          });
          if (!res.ok) throw new Error(`Twilio GET ${res.status}`);
          return res.json();
        },
        async findCallLog(id): Promise<CallLogForTranscript | null> {
          const { data: log } = await db.from('call_logs')
            .select('id, org_id, contact_id, direction, from_number, to_number')
            .eq('id', id).maybeSingle();
          if (!log) return null;
          const { data: s } = await db.from('org_settings').select('setting_value')
            .eq('org_id', log.org_id).eq('setting_key', 'crm_twilio').maybeSingle();
          // call_logs has no foreign key to contacts, so no embedded select.
          const { data: c } = log.contact_id
            ? await db.from('contacts').select('first_name, last_name').eq('id', log.contact_id).maybeSingle()
            : { data: null };
          const name = `${c?.first_name || ''} ${c?.last_name || ''}`.trim();
          const direction = log.direction === 'outbound' ? 'outbound' : 'inbound';
          return {
            id: log.id,
            direction,
            account_sid: s?.setting_value?.account_sid || process.env.TWILIO_ACCOUNT_SID || '',
            contact_label: name || (direction === 'outbound' ? log.to_number : log.from_number) || 'Contact',
          };
        },
        async updateCallLog(id, fields) {
          // Verify by row count: a filtered update reports error null and 0 rows.
          const { count, error } = await db.from('call_logs').update(fields, { count: 'exact' }).eq('id', id);
          if (error) throw new Error(error.message);
          return count ?? 0;
        },
      }
    );
    console.log('intelligence:', JSON.stringify({ status: result.status, ...result.body }));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e: any) {
    // 500 so Twilio retries. A retry rewrites the same row with the same text.
    console.error('intelligence: failed:', e?.message ?? String(e));
    return NextResponse.json({ error: 'Transcript could not be saved' }, { status: 500 });
  }
}
