import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { getOrgTwilioConfig, createOrgTwilioClient } from '@/lib/twilio-org';

// End a browser-placed call from the server. The backstop for End in the
// dialer and VoipCall (createOutboundCall in voice-call-state.ts): the browser
// sends its own hangup first, and this makes sure Twilio ends the call even if
// that message was lost, e.g. a phone's signaling socket dropping at the moment
// End was pressed.
//
// The call is addressed by its call_logs row, read with the USER's client, so
// row level security decides whether this user may touch it. The SID used is
// the one inbound-call stamped on that row (the parent browser leg); ending the
// parent ends the <Dial> leg to the contact too. No row, no SID yet, or a call
// that is already over are all no-ops, not errors.

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: any = {};
    try { body = await request.json(); } catch { /* validated below */ }
    const callLogId = String(body?.call_log_id || '').trim();
    if (!callLogId) return NextResponse.json({ error: 'call_log_id required' }, { status: 400 });

    const { data: row } = await supabase
      .from('call_logs')
      .select('id, org_id, direction, external_call_sid')
      .eq('id', callLogId)
      .maybeSingle();
    if (!row || row.direction !== 'outbound' || !row.external_call_sid || !row.org_id) {
      return NextResponse.json({ ok: true, ended: false });
    }

    const config = await getOrgTwilioConfig(supabase, row.org_id);
    if (!config.account_sid || !config.auth_token) return NextResponse.json({ ok: true, ended: false });
    const client = createOrgTwilioClient(config);

    // 'completed' ends a call in progress; 'canceled' is the only status Twilio
    // accepts for one still queued or ringing. A call already over rejects both.
    for (const status of ['completed', 'canceled'] as const) {
      try {
        await client.calls(row.external_call_sid).update({ status });
        return NextResponse.json({ ok: true, ended: true });
      } catch { /* try the next status */ }
    }
    return NextResponse.json({ ok: true, ended: false });
  } catch (e: any) {
    console.error('voice hangup failed:', e?.message ?? String(e));
    return NextResponse.json({ error: 'Hangup failed' }, { status: 500 });
  }
}
