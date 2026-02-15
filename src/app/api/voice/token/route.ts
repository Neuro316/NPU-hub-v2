import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { generateVoiceToken } from '@/lib/twilio';
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

  // Generate token
  const token = generateVoiceToken(`user-${user.id}`);

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
    event_data: { call_log_id: callLog?.id },
    ref_table: 'call_logs',
    ref_id: callLog?.id,
    actor_id: user.id,
  });

  return NextResponse.json({
    token,
    call_log_id: callLog?.id,
    contact_phone: contact.phone,
  });
}
