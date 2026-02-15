import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { isDNC, getOrCreateConversation } from '@/lib/crm-server';

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { contact_id, body, scheduled_for } = await request.json();
  if (!contact_id || !body || !scheduled_for) {
    return NextResponse.json({ error: 'contact_id, body, and scheduled_for required' }, { status: 400 });
  }

  const { data: contact } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', contact_id)
    .single();

  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  if (await isDNC(supabase, contact.org_id, contact)) {
    return NextResponse.json({ error: 'Contact is on DNC list' }, { status: 403 });
  }
  if (!contact.sms_consent || !contact.phone) {
    return NextResponse.json({ error: 'SMS consent or phone missing' }, { status: 403 });
  }

  const conversation = await getOrCreateConversation(supabase, contact_id, 'sms');

  const { data: message } = await supabase
    .from('crm_messages')
    .insert({
      conversation_id: conversation.id,
      direction: 'outbound',
      body,
      status: 'scheduled',
      sent_by: user.id,
      scheduled_for,
    })
    .select()
    .single();

  return NextResponse.json({ success: true, message_id: message?.id });
}
