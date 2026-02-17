import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { getOrgTwilioConfig, generateOrgVoiceToken, getVoiceCallerId } from '@/lib/twilio-org';
import { getOrCreateConversation, logActivity, isDNC } from '@/lib/crm-server';

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

    const { contact_id } = body;
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

    const callerId = getVoiceCallerId(twilioConfig, 'manual', contact.pipeline_stage);

    let callLogId: string | undefined;
    try {
      const conversation = await getOrCreateConversation(supabase, contact_id, 'voice');
      const { data: callLog } = await supabase.from('call_logs').insert({
        conversation_id: conversation.id, contact_id, direction: 'outbound',
        status: 'ringing', called_by: user.id, started_at: new Date().toISOString(),
      }).select().single();
      callLogId = callLog?.id;
      await logActivity(supabase, {
        contact_id, org_id: contact.org_id, event_type: 'call_outbound',
        event_data: { call_log_id: callLogId, caller_id: callerId },
        ref_table: 'call_logs', ref_id: callLogId, actor_id: user.id,
      });
    } catch (e: any) { console.warn('Call log failed, proceeding:', e.message); }

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
    });
  } catch (e: any) {
    console.error('Voice token error:', e);
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
}
