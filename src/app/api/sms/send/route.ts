import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { getOrgTwilioConfig, sendOrgSms, findOrgNumber } from '@/lib/twilio-org';
import { toE164 } from '@/lib/phone';
import {
  isDNC, logActivity, emitWebhookEvent,
  updateLastContacted, getOrCreateConversation, recordResponseTime
} from '@/lib/crm-server';

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

    const { contact_id, body: msgBody, line_e164 } = body;
    if (!contact_id || !msgBody) {
      return NextResponse.json({ error: 'contact_id and body required' }, { status: 400 });
    }

    const { data: contact, error: contactErr } = await supabase
      .from('contacts').select('*, org_id').eq('id', contact_id).single();

    if (contactErr || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    try {
      if (await isDNC(supabase, contact.org_id, contact)) {
        return NextResponse.json({ error: 'Contact is on Do Not Contact list' }, { status: 403 });
      }
    } catch (e: any) { console.warn('DNC check skipped:', e.message); }

    if (!contact.sms_consent) {
      return NextResponse.json({ error: 'Contact has not given SMS consent' }, { status: 403 });
    }
    if (!contact.phone) {
      return NextResponse.json({ error: 'Contact has no phone number' }, { status: 400 });
    }

    const twilioConfig = await getOrgTwilioConfig(supabase, contact.org_id);
    if (!twilioConfig.account_sid) {
      return NextResponse.json({ error: 'Twilio not configured. Go to CRM Settings > Twilio to add credentials.' }, { status: 400 });
    }

    // Multi-line: an explicitly chosen line pins the From. A value that is not
    // one of the org's numbers is refused, never silently ignored. Absent ->
    // the send path is exactly what it always was.
    let fromLine = '';
    if (line_e164) {
      const line = findOrgNumber(twilioConfig, String(line_e164));
      if (!line) {
        return NextResponse.json({ error: 'line_e164 is not one of this organization\'s numbers' }, { status: 400 });
      }
      fromLine = toE164(line.phone);
    }

    let twilioMsg;
    try {
      twilioMsg = await sendOrgSms(
        twilioConfig, contact.phone, msgBody, 'manual', contact.pipeline_stage,
        { from: fromLine || undefined }
      );
    } catch (e: any) {
      return NextResponse.json({ error: `SMS send failed: ${e.message}` }, { status: 500 });
    }

    // Log everything (non-blocking)
    let messageId: string | undefined;
    try {
      const conversation = await getOrCreateConversation(supabase, contact_id, 'sms', undefined, fromLine || null);
      const { data: message } = await supabase.from('crm_messages').insert({
        conversation_id: conversation.id, direction: 'outbound', body: msgBody,
        status: 'queued', twilio_sid: twilioMsg.sid, sent_by: user.id,
        // The recipient is known locally. The SENDER is known only when a line
        // was pinned: un-pinned sends go through a Messaging Service, so Twilio
        // picks the number from its pool during queueing and twilioMsg.from is
        // typically null right here. from_e164 is confirmed authoritatively by
        // /api/twilio/message-status either way.
        to_e164: contact.phone,
        from_e164: twilioMsg.from || fromLine || null,
        sent_at: new Date().toISOString(),
      }).select().single();
      messageId = message?.id;

      await supabase.from('conversations')
        .update({
          last_message_at: new Date().toISOString(),
          // A pinned outbound line is the thread's most recent line.
          ...(fromLine ? { line_e164: fromLine } : {}),
        })
        .eq('id', conversation.id);
      await updateLastContacted(supabase, contact_id);

      const { data: teamMember } = await supabase.from('team_members')
        .select('id').eq('user_id', user.id).eq('org_id', contact.org_id).single();
      if (teamMember) {
        await recordResponseTime(supabase, contact.org_id, contact_id, 'sms', teamMember.id);
      }

      await logActivity(supabase, {
        contact_id, org_id: contact.org_id, event_type: 'sms_sent',
        event_data: { body: msgBody.substring(0, 100), twilio_sid: twilioMsg.sid },
        ref_table: 'crm_messages', ref_id: messageId, actor_id: user.id,
      });

      await emitWebhookEvent(supabase, contact.org_id, 'message.sent', {
        message_id: messageId, contact_id, channel: 'sms', direction: 'outbound',
      });
    } catch (e: any) { console.warn('SMS logging failed:', e.message); }

    // ── Direct counter increment (admin bypasses RLS) ──
    try {
      const now = new Date().toISOString()
      const { data: cur } = await admin
        .from('contacts')
        .select('total_texts, total_outbound_texts')
        .eq('id', contact_id)
        .single()

      if (cur) {
        await admin.from('contacts').update({
          total_texts: (cur.total_texts || 0) + 1,
          total_outbound_texts: (cur.total_outbound_texts || 0) + 1,
          last_text_at: now,
          last_contacted_at: now,
        }).eq('id', contact_id)
      }
    } catch (e) { console.warn('Counter increment skipped:', e) }

    return NextResponse.json({ success: true, message_id: messageId });
  } catch (e: any) {
    console.error('SMS send route error:', e);
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
}
