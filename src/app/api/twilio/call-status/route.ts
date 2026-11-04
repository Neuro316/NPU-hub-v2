import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { logActivity } from '@/lib/crm-server';
import { validateTwilioSignatureWithToken } from '@/lib/twilio';
import { resolveVoiceWebhookAuth, voiceSignatureUrl } from '@/lib/twilio-voice-signature';
import { parseOutboundStatusEvent, outboundCallUpdate } from '@/lib/outbound-call-status';

// Outbound browser call lifecycle: the <Dial action> and the <Number
// statusCallback> of the outbound branch in inbound-call both post here. The
// rules live in src/lib/outbound-call-status.ts (and its tests).
//
// The row is found by external_call_sid, the parent SID inbound-call stamped on
// it. Exact: never "the latest ringing row", which is what this route used to
// pick, across every org, through a contacts embed that does not exist.
//
// Always answers with empty TwiML. A <Dial action> response is TwiML for a
// browser that may still be on the line, and empty means hang up, which is what
// the call is doing anyway. A request whose signature fails writes nothing.

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const twiml = () => new NextResponse(EMPTY_TWIML, { headers: { 'Content-Type': 'text/xml' } });

export async function POST(request: NextRequest) {
  const params: Record<string, string> = {};
  try {
    new URLSearchParams(await request.text()).forEach((v, k) => { params[k] = v; });
  } catch (e) {
    console.error('call-status parse error:', e);
  }

  // Verify before any database access. Fail closed for writes, but still 200
  // with empty TwiML so a browser still on the call is not read an error.
  try {
    const signature = request.headers.get('x-twilio-signature') || '';
    const url = voiceSignatureUrl('/api/twilio/call-status');
    const { authToken, source } = await resolveVoiceWebhookAuth(params.To, params.From);
    if (!url || !signature || !validateTwilioSignatureWithToken(authToken, url, params, signature)) {
      console.error('[call-status] SIGNATURE REJECTED, nothing written. token_source=', source, '| has_signature=', !!signature);
      return twiml();
    }
  } catch (e: any) {
    console.error('[call-status] signature check errored, nothing written:', e?.message ?? String(e));
    return twiml();
  }

  try {
    const ev = parseOutboundStatusEvent(params);
    if (!ev) return twiml();

    const supabase = createAdminSupabase();
    const { data: row } = await supabase
      .from('call_logs')
      .select('id, org_id, contact_id, direction, status, duration_seconds')
      .eq('external_call_sid', ev.parentCallSid)
      .maybeSingle();
    if (!row || row.direction !== 'outbound') {
      console.warn('call-status: no outbound call_log for', ev.parentCallSid);
      return twiml();
    }

    const change = outboundCallUpdate(row, ev, new Date().toISOString());
    if (!change) return twiml();

    // Guarded on the status read above, so two callbacks racing cannot both
    // count as the one that closed the call. Verified by row count.
    const { count, error } = await supabase
      .from('call_logs')
      .update(change.updates, { count: 'exact' })
      .eq('id', row.id)
      .eq('status', row.status);
    if (error) {
      console.error('call-status: update failed:', error.message);
      return twiml();
    }
    console.log('call-status:', JSON.stringify({ call_log_id: row.id, from: row.status, ...change.updates, rows_updated: count ?? 0 }));
    if (!count || !change.becameFinal) return twiml();

    // Once per call. voice/token already counted the call itself
    // (total_calls, total_outbound_calls) when it was placed; this adds the
    // talk time.
    const seconds = Number(change.updates.duration_seconds) || 0;
    if (row.contact_id && seconds > 0) {
      try {
        const { data: cur } = await supabase.from('contacts')
          .select('total_call_duration_seconds').eq('id', row.contact_id).maybeSingle();
        if (cur) {
          await supabase.from('contacts')
            .update({ total_call_duration_seconds: (cur.total_call_duration_seconds || 0) + seconds })
            .eq('id', row.contact_id);
        }
      } catch (e) { console.warn('call-status: talk time skipped:', e); }
    }
    if (row.org_id && row.contact_id) {
      try {
        await logActivity(supabase, {
          contact_id: row.contact_id,
          org_id: row.org_id,
          event_type: change.updates.status === 'completed' ? 'call_completed' : 'call_missed',
          event_data: { direction: 'outbound', duration: seconds, status: change.updates.status },
          ref_table: 'call_logs',
          ref_id: row.id,
        });
      } catch (e) { console.warn('call-status: activity skipped:', e); }
    }
  } catch (e: any) {
    console.error('call-status error:', e?.message ?? String(e));
  }
  return twiml();
}
