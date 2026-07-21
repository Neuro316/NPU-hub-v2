import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { validateTwilioSignatureWithToken } from '@/lib/twilio';
import { resolveInboundTwilioAuth } from '@/lib/twilio-org';
import {
  findContactByPhoneNormalized, getOrCreateConversation, logActivity,
  emitWebhookEvent, applyAutoAssignment, trackInboundForResponseTime,
  resolveOrgByReceivingNumber, bumpConversation
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

  // ── Signature verification gates the ENTIRE handler ──
  // Forging inbound SMS would let anyone write into any contact's history, so
  // verify first and reject on failure BEFORE any DB access. Fail closed: if we
  // cannot determine the callback URL or there is no signature, we cannot verify,
  // so we reject rather than process.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  const signature = request.headers.get('x-twilio-signature') || '';
  const url = `${appUrl}/api/twilio/inbound-sms`;
  if (!appUrl || !signature) {
    console.error('inbound-sms: missing NEXT_PUBLIC_APP_URL or X-Twilio-Signature; rejecting');
    return new NextResponse('Forbidden', { status: 403 });
  }
  // Per-org token: validate against the auth token of the account that owns the
  // receiving ("To") number, not a single global token.
  const { authToken } = await resolveInboundTwilioAuth(params.To || '');
  if (!validateTwilioSignatureWithToken(authToken, url, params, signature)) {
    console.warn('inbound-sms: Twilio signature validation failed; rejecting');
    return new NextResponse('Forbidden', { status: 403 });
  }

  const supabase = createAdminSupabase();
  const from = params.From;
  const to = params.To;
  const body = params.Body || '';

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

  // Resolve the org from the RECEIVING number (multi-tenant). Canonical source is
  // crm_twilio_numbers; falls back to org_settings.crm_twilio.numbers[] so this
  // agrees with the inbound-call forward hotfix. Unmapped number -> drop (don't
  // guess an org, and don't let one org's texts land in another).
  const orgId = await resolveOrgByReceivingNumber(supabase, to);
  if (!orgId) {
    console.warn('inbound-sms: no org for receiving number', to);
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  // Match by normalized last-10 digits within the org (stored phones may be
  // formatted). Unknown -> placeholder "Unknown" contact below, so the message
  // still threads via conversation->contact and can be merged into the real
  // contact later.
  let contact = await findContactByPhoneNormalized(supabase, orgId, from);
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

  const conversation = await getOrCreateConversation(supabase, contact.id, 'sms', orgId);

  // MMS: collect the media URLs Twilio delivered (MediaUrl0..N).
  const numMedia = parseInt(params.NumMedia || '0', 10) || 0;
  const mediaUrls = Array.from({ length: numMedia }, (_, i) => params[`MediaUrl${i}`]).filter(Boolean);

  const { data: message } = await supabase
    .from('crm_messages')
    .insert({
      org_id: orgId,
      conversation_id: conversation.id,
      direction: 'inbound',
      msg_type: numMedia > 0 ? 'mms' : 'sms',
      body,
      media_urls: mediaUrls,
      from_e164: from,
      to_e164: to,
      status: 'received',
      twilio_sid: params.MessageSid,
      sent_at: new Date().toISOString(),
    })
    .select()
    .single();

  await bumpConversation(supabase, conversation.id, {
    preview: body || (numMedia > 0 ? '\u{1F4CE} Attachment' : ''),
    direction: 'inbound',
    incrementUnread: true,
    currentUnread: conversation.unread_count || 0,
  });

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
