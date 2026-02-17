import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { validateTwilioSignature } from '@/lib/twilio';
import {
  findContactByPhone, getOrCreateConversation, logActivity,
  emitWebhookEvent, applyAutoAssignment, trackInboundForResponseTime
} from '@/lib/crm-server';

export async function POST(request: NextRequest) {
  let params: Record<string, string> = {};
  try {
    const text = await request.text();
    const searchParams = new URLSearchParams(text);
    searchParams.forEach((val, key) => { params[key] = val; });
  } catch (e) {
    console.error('inbound-sms parse error:', e);
  }

  // Validate Twilio signature (skip if URL not configured)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (appUrl) {
    const signature = request.headers.get('x-twilio-signature') || '';
    const url = `${appUrl}/api/twilio/inbound-sms`;
    if (!validateTwilioSignature(url, params, signature)) {
      console.warn('Twilio signature validation failed for inbound SMS');
    }
  }

  const supabase = createAdminSupabase();
  const from = params.From;
  const body = params.Body;

  // Handle STOP/START/UNSUBSCRIBE keywords (TCPA compliance)
  const keyword = (body || '').trim().toUpperCase();
  const STOP_KEYWORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
  const START_KEYWORDS = ['START', 'YES', 'UNSTOP', 'SUBSCRIBE'];

  if (STOP_KEYWORDS.includes(keyword) || START_KEYWORDS.includes(keyword)) {
    const isStop = STOP_KEYWORDS.includes(keyword);

    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, org_id')
      .eq('phone', from);

    if (contacts?.length) {
      for (const c of contacts) {
        await supabase.from('contacts').update({
          sms_consent: !isStop,
          ...(isStop ? { do_not_contact: true } : {}),
        }).eq('id', c.id);

        await supabase.from('crm_activity_log').insert({
          contact_id: c.id,
          org_id: c.org_id,
          event_type: isStop ? 'sms_opt_out' : 'sms_opt_in',
          event_data: { keyword, phone: from },
          created_at: new Date().toISOString(),
        });
      }
    }

    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  const { data: orgConfig } = await supabase
    .from('org_email_config')
    .select('org_id')
    .limit(1)
    .single();

  const orgId = orgConfig?.org_id;
  if (!orgId) {
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  let contact = await findContactByPhone(supabase, orgId, from);
  if (!contact) {
    const assignedTo = await applyAutoAssignment(supabase, orgId, { source: 'inbound_sms' });

    const { data: newContact } = await supabase
      .from('contacts')
      .insert({
        org_id: orgId,
        first_name: 'Unknown',
        last_name: from,
        phone: from,
        source: 'inbound_sms',
        sms_consent: true,
        assigned_to: assignedTo,
      })
      .select()
      .single();

    contact = newContact;

    if (contact) {
      await logActivity(supabase, {
        contact_id: contact.id,
        org_id: orgId,
        event_type: 'contact_created',
        event_data: { source: 'inbound_sms', phone: from },
      });
    }
  }

  if (!contact) {
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  if (contact.do_not_contact) {
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  const conversation = await getOrCreateConversation(supabase, contact.id, 'sms');

  const { data: message } = await supabase
    .from('crm_messages')
    .insert({
      conversation_id: conversation.id,
      direction: 'inbound',
      body,
      status: 'received',
      twilio_sid: params.MessageSid,
      sent_at: new Date().toISOString(),
    })
    .select()
    .single();

  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
    })
    .eq('id', conversation.id);

  if (message) {
    await trackInboundForResponseTime(supabase, orgId, contact.id, 'sms', message.id);
  }

  await logActivity(supabase, {
    contact_id: contact.id,
    org_id: orgId,
    event_type: 'sms_received',
    event_data: { body: body.substring(0, 100) },
    ref_table: 'crm_messages',
    ref_id: message?.id,
  });

  await emitWebhookEvent(supabase, orgId, 'message.received', {
    message_id: message?.id,
    contact_id: contact.id,
    channel: 'sms',
    direction: 'inbound',
    body: body.substring(0, 100),
  });

  // ── Direct counter increment (admin bypasses RLS) ──
  try {
    const now = new Date().toISOString()
    const { data: cur } = await supabase
      .from('contacts')
      .select('total_texts, total_inbound_texts')
      .eq('id', contact.id)
      .single()

    if (cur) {
      await supabase.from('contacts').update({
        total_texts: (cur.total_texts || 0) + 1,
        total_inbound_texts: (cur.total_inbound_texts || 0) + 1,
        last_text_at: now,
        last_contacted_at: now,
      }).eq('id', contact.id)
    }
  } catch (e) { console.warn('Counter increment skipped:', e) }

  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { 'Content-Type': 'text/xml' },
  });
}
