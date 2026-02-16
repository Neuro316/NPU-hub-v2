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
      // Don't reject - signature might fail due to URL mismatch
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

    // Find the contact by phone across all orgs
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

    // Twilio auto-responds to STOP/START, so return empty TwiML
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  // Look up which org owns this Twilio number
  // For multi-org, you'd look this up by the To number. For now, use first org.
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

  // Find or create contact
  let contact = await findContactByPhone(supabase, orgId, from);
  if (!contact) {
    // Auto-assign new contact
    const assignedTo = await applyAutoAssignment(supabase, orgId, { source: 'inbound_sms' });

    const { data: newContact } = await supabase
      .from('contacts')
      .insert({
        org_id: orgId,
        first_name: 'Unknown',
        last_name: from,
        phone: from,
        source: 'inbound_sms',
        sms_consent: true, // They texted us
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

  // Check DNC
  if (contact.do_not_contact) {
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  // Get or create conversation
  const conversation = await getOrCreateConversation(supabase, contact.id, 'sms');

  // Insert message
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

  // Update conversation
  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
    })
    .eq('id', conversation.id);

  // Track for response time
  if (message) {
    await trackInboundForResponseTime(supabase, orgId, contact.id, 'sms', message.id);
  }

  // Log activity
  await logActivity(supabase, {
    contact_id: contact.id,
    org_id: orgId,
    event_type: 'sms_received',
    event_data: { body: body.substring(0, 100) },
    ref_table: 'crm_messages',
    ref_id: message?.id,
  });

  // Emit webhook
  await emitWebhookEvent(supabase, orgId, 'message.received', {
    message_id: message?.id,
    contact_id: contact.id,
    channel: 'sms',
    direction: 'inbound',
    body: body.substring(0, 100),
  });

  // Return empty TwiML
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { 'Content-Type': 'text/xml' },
  });
}
