import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { logActivity } from '@/lib/crm-server';

export async function POST(request: NextRequest) {
  const supabase = createAdminSupabase();
  const body = await request.json();
  const { event, provider_message_id, send_id, timestamp } = body;

  if (!send_id && !provider_message_id) {
    return NextResponse.json({ error: 'send_id or provider_message_id required' }, { status: 400 });
  }

  let query = supabase.from('email_sends').select('*, contacts!inner(org_id, id)');
  if (send_id) query = query.eq('id', send_id);
  else query = query.eq('provider_message_id', provider_message_id);

  const { data: emailSend } = await query.single();
  if (!emailSend) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const orgId = (emailSend as any).contacts?.org_id;
  const contactId = (emailSend as any).contacts?.id;
  const now = timestamp || new Date().toISOString();
  const updates: Record<string, unknown> = {};

  switch (event) {
    case 'delivered':
      updates.status = 'delivered';
      break;
    case 'opened':
      if (!emailSend.opened_at) updates.opened_at = now;
      break;
    case 'clicked':
      if (!emailSend.clicked_at) updates.clicked_at = now;
      break;
    case 'bounced':
      updates.status = 'bounced';
      updates.bounced_at = now;
      // Flag contact
      if (contactId) {
        await supabase.from('contacts').update({ email_consent: false }).eq('id', contactId);
      }
      break;
    case 'unsubscribed':
      updates.unsubscribed_at = now;
      if (contactId) {
        await supabase.from('contacts').update({
          email_consent: false,
          email_unsubscribed_at: now,
        }).eq('id', contactId);
      }
      break;
    case 'complained':
      // Spam complaint
      if (contactId) {
        await supabase.from('contacts').update({ email_consent: false }).eq('id', contactId);
      }
      break;
  }

  if (Object.keys(updates).length > 0) {
    await supabase.from('email_sends').update(updates).eq('id', emailSend.id);
  }

  // Update daily stats
  const today = new Date().toISOString().split('T')[0];
  const statField: Record<string, string> = {
    delivered: 'delivered_count', opened: 'opened_count', clicked: 'clicked_count',
    bounced: 'bounced_count', unsubscribed: 'unsubscribed_count', complained: 'complained_count',
  };
  if (orgId && statField[event]) {
    await supabase.rpc('increment_email_stat', {
      p_org_id: orgId, p_date: today, p_field: statField[event],
    });
  }

  // Log activity
  if (orgId && contactId) {
    await logActivity(supabase, {
      contact_id: contactId,
      org_id: orgId,
      event_type: `email_${event}`,
      event_data: { send_id: emailSend.id, campaign_id: emailSend.campaign_id },
      ref_table: 'email_sends',
      ref_id: emailSend.id,
    });
  }

  return NextResponse.json({ success: true });
}
