import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { getOrgTwilioConfig, generateOrgVoiceToken, getVoiceCallerId, findOrgNumber } from '@/lib/twilio-org';
import { getOrCreateConversation, logActivity, isDNC, bumpConversation } from '@/lib/crm-server';
import { toE164 } from '@/lib/phone';

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabase();
    const admin = createAdminSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { contact_id, line_e164 } = body;
    if (!contact_id) return NextResponse.json({ error: 'contact_id required' }, { status: 400 });

    const { data: contact, error: contactErr } = await supabase
      .from('contacts').select('*').eq('id', contact_id).single();

    if (contactErr || !contact) {
      return NextResponse.json({ error: `Contact not found: ${contactErr?.message || 'unknown'}` }, { status: 404 });
    }
    if (!contact.phone) return NextResponse.json({ error: 'No phone number' }, { status: 400 });

    try {
      if (await isDNC(supabase, contact.org_id, contact)) {
        return NextResponse.json({ error: 'Contact is on DNC list' }, { status: 403 });
      }
    } catch (e: any) { console.warn('DNC check skipped:', e.message); }

    const twilioConfig = await getOrgTwilioConfig(supabase, contact.org_id);
    if (!twilioConfig.account_sid) {
      return NextResponse.json({ error: 'Twilio not configured. Go to CRM Settings > Twilio.' }, { status: 400 });
    }
    if (!twilioConfig.api_key || !twilioConfig.api_secret || !twilioConfig.twiml_app_sid) {
      const missing = [];
      if (!twilioConfig.api_key) missing.push('API Key');
      if (!twilioConfig.api_secret) missing.push('API Secret');
      if (!twilioConfig.twiml_app_sid) missing.push('TwiML App SID');
      return NextResponse.json({ error: `Voice missing: ${missing.join(', ')}` }, { status: 400 });
    }

    let token: string;
    try {
      token = generateOrgVoiceToken(twilioConfig, `user-${user.id}`);
    } catch (e: any) {
      return NextResponse.json({ error: `Token failed: ${e.message}` }, { status: 500 });
    }

    // Caller ID: an explicitly chosen line when it is one of the org's numbers,
    // otherwise the unchanged getVoiceCallerId chain. inbound-call's
    // browser-originated branch re-validates whatever is passed as CallerId.
    let callerId = getVoiceCallerId(twilioConfig, 'manual', contact.pipeline_stage);
    if (line_e164) {
      const line = findOrgNumber(twilioConfig, String(line_e164));
      if (!line) {
        return NextResponse.json({ error: 'line_e164 is not one of this organization\'s numbers' }, { status: 400 });
      }
      callerId = toE164(line.phone) || callerId;
    }
    // The thread's line is the number we are calling FROM (when it is ours).
    const lineForThread = findOrgNumber(twilioConfig, callerId) ? toE164(callerId) : null;

    let callLogId: string | undefined;
    const startedAt = new Date().toISOString();
    try {
      const conversation = await getOrCreateConversation(supabase, contact_id, 'voice', undefined, lineForThread);
      // Every column below exists on the live call_logs table (checked against
      // pg_attribute 2026-09-29): conversation_id (added by migration 209),
      // contact_id, direction, status, started_at, org_id, from_number,
      // to_number.
      //
      // called_by was REMOVED from this payload. It has never existed on the
      // live table, and PostgREST rejects the whole insert on an unknown
      // column, so this insert has always failed and the catch below swallowed
      // it. That is why call_logs held 42 rows and every one was inbound. The
      // owner of an outbound call is still recorded: logActivity writes
      // actor_id just below, and the 'answered' path sets team_member_id. Do
      // not re-add called_by without a migration that creates the column.
      const { data: callLog, error: callLogErr } = await supabase.from('call_logs').insert({
        conversation_id: conversation.id, contact_id, direction: 'outbound',
        status: 'ringing', started_at: startedAt,
        // org_id / from_number / to_number were never written on outbound rows,
        // which left them invisible under the 067 org-scoped policy and with no
        // derivable line. Stamped from here on.
        org_id: contact.org_id,
        from_number: callerId || null,
        to_number: toE164(contact.phone) || contact.phone,
      }).select().single();
      if (callLogErr) throw callLogErr;
      callLogId = callLog?.id;
      if (lineForThread) {
        await supabase.from('conversations')
          .update({ line_e164: lineForThread }).eq('id', conversation.id);
      }
      // Float the thread on an OUTBOUND call too. Before this, placing a call
      // updated line_e164 and nothing else, so dialling someone left their
      // thread sitting wherever their last text had put it. started_at is the
      // call's own timestamp, which is what last_activity_at wants.
      await bumpConversation(supabase, conversation.id, {
        preview: 'Outgoing call',
        direction: 'outbound',
        lineE164: lineForThread,
        occurredAt: startedAt,
      });
      await logActivity(supabase, {
        contact_id, org_id: contact.org_id, event_type: 'call_outbound',
        event_data: { call_log_id: callLogId, caller_id: callerId },
        ref_table: 'call_logs', ref_id: callLogId, actor_id: user.id,
      });
    } catch (e: any) {
      // Log the REAL failure. This used to print only a generic line, which is
      // how a schema mismatch stayed invisible for months.
      console.warn(
        'Call log failed, proceeding. message=%s code=%s details=%s hint=%s',
        e?.message ?? String(e), e?.code ?? 'none', e?.details ?? 'none', e?.hint ?? 'none'
      );
    }

    // ── Direct counter increment (admin bypasses RLS) ──
    try {
      const now = new Date().toISOString()
      const { data: cur } = await admin
        .from('contacts')
        .select('total_calls, total_outbound_calls')
        .eq('id', contact_id)
        .single()

      if (cur) {
        await admin.from('contacts').update({
          total_calls: (cur.total_calls || 0) + 1,
          total_outbound_calls: (cur.total_outbound_calls || 0) + 1,
          last_call_at: now,
          last_contacted_at: now,
        }).eq('id', contact_id)
      }
    } catch (e) { console.warn('Call counter increment skipped:', e) }

    return NextResponse.json({
      token, call_log_id: callLogId, contact_phone: contact.phone, caller_id: callerId,
      org_id: contact.org_id,
    });
  } catch (e: any) {
    console.error('Voice token error:', e);
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
}
