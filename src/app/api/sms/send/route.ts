import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { getOrgTwilioConfig, sendOrgSms } from '@/lib/twilio-org';
import {
  isDNC, logActivity, emitWebhookEvent,
  updateLastContacted, getOrCreateConversation, recordResponseTime
} from '@/lib/crm-server';

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { contact_id, body } = await request.json();
  if (!contact_id || !body) {
    return NextResponse.json({ error: 'contact_id and body required' }, { status: 400 });
  }

  // Get contact
  const { data: contact, error: contactErr } = await supabase
    .from('contacts')
    .select('*, org_id')
    .eq('id', contact_id)
    .single();

  if (contactErr || !contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  // Check DNC + consent
  if (await isDNC(supabase, contact.org_id, contact)) {
    return NextResponse.json({ error: 'Contact is on Do Not Contact list' }, { status: 403 });
  }
  if (!contact.sms_consent) {
    return NextResponse.json({ error: 'Contact has not given SMS consent' }, { status: 403 });
  }
  if (!contact.phone) {
    return NextResponse.json({ error: 'Contact has no phone number' }, { status: 400 });
  }

  // Get org-specific Twilio config (falls back to env vars)
  const twilioConfig = await getOrgTwilioConfig(supabase, contact.org_id);
  if (!twilioConfig.account_sid) {
    return NextResponse.json({ error: 'Twilio not configured for this organization. Go to CRM Settings > Twilio to add credentials.' }, { status: 400 });
  }

  // Send via org Twilio (auto-picks number based on pipeline stage)
  const twilioMsg = await sendOrgSms(twilioConfig, contact.phone, body, 'manual', contact.pipeline_stage);

  // Get or create conversation
  const conversation = await getOrCreateConversation(supabase, contact_id, 'sms');

  // Insert message
  const { data: message } = await supabase
    .from('crm_messages')
    .insert({
      conversation_id: conversation.id,
      direction: 'outbound',
      body,
      status: 'queued',
      twilio_sid: twilioMsg.sid,
      sent_by: user.id,
      sent_at: new Date().toISOString(),
    })
    .select()
    .single();

  // Update conversation
  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversation.id);

  // Update last contacted
  await updateLastContacted(supabase, contact_id);

  // Track response time
  const { data: teamMember } = await supabase
    .from('team_members')
    .select('id')
    .eq('user_id', user.id)
    .eq('org_id', contact.org_id)
    .single();

  if (teamMember) {
    await recordResponseTime(supabase, contact.org_id, contact_id, 'sms', teamMember.id);
  }

  // Log activity
  await logActivity(supabase, {
    contact_id,
    org_id: contact.org_id,
    event_type: 'sms_sent',
    event_data: { body: body.substring(0, 100), twilio_sid: twilioMsg.sid },
    ref_table: 'crm_messages',
    ref_id: message?.id,
    actor_id: user.id,
  });

  // Emit webhook
  await emitWebhookEvent(supabase, contact.org_id, 'message.sent', {
    message_id: message?.id,
    contact_id,
    channel: 'sms',
    direction: 'outbound',
  });

  return NextResponse.json({ success: true, message_id: message?.id });
}
