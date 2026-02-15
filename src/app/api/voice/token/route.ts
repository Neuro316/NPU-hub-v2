import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { getOrgTwilioConfig, generateOrgVoiceToken, getVoiceCallerId } from '@/lib/twilio-org';
import { getOrCreateConversation, logActivity, isDNC } from '@/lib/crm-server';

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { contact_id } = await request.json();
  if (!contact_id) return NextResponse.json({ error: 'contact_id required' }, { status: 400 });

  // Get contact
  const { data: contact } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', contact_id)
    .single();

  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  if (!contact.phone) return NextResponse.json({ error: 'No phone number' }, { status: 400 });
  if (await isDNC(supabase, contact.org_id, contact)) {
    return NextResponse.json({ error: 'Contact is on DNC list' }, { status: 403 });
  }

  // Get org-specific Twilio config
  const twilioConfig = await getOrgTwilioConfig(supabase, contact.org_id);
  if (!twilioConfig.account_sid) {
    return NextResponse.json({ error: 'Twilio not configured for this organization' }, { status: 400 });
  }
  if (!twilioConfig.api_key || !twilioConfig.api_secret || !twilioConfig.twiml_app_sid) {
    return NextResponse.json({ error: 'Voice calling not configured. Add API Key, Secret, and TwiML App SID in CRM Settings > Twilio.' }, { status: 400 });
  }

  // Generate token and pick caller ID based on pipeline stage
  const token = generateOrgVoiceToken(twilioConfig, `user-${user.id}`);
  const callerId = getVoiceCallerId(twilioConfig, 'manual', contact.pipeline_stage);

  // Create call log
  const conversation = await getOrCreateConversation(supabase, contact_id, 'voice');
  const { data: callLog } = await supabase
    .from('call_logs')
    .insert({
      conversation_id: conversation.id,
      contact_id,
      direction: 'outbound',
      status: 'ringing',
      called_by: user.id,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  // Log activity
  await logActivity(supabase, {
    contact_id,
    org_id: contact.org_id,
    event_type: 'call_outbound',
    event_data: { call_log_id: callLog?.id, caller_id: callerId },
    ref_table: 'call_logs',
    ref_id: callLog?.id,
    actor_id: user.id,
  });

  return NextResponse.json({
    token,
    call_log_id: callLog?.id,
    contact_phone: contact.phone,
    caller_id: callerId,
  });
}
