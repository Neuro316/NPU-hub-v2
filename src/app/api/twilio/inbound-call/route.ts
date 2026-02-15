import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { validateTwilioSignature, generateInboundCallTwiml } from '@/lib/twilio';
import {
  findContactByPhone, getOrCreateConversation, logActivity,
  emitWebhookEvent, trackInboundForResponseTime
} from '@/lib/crm-server';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((val, key) => { params[key] = val.toString(); });

  const signature = request.headers.get('x-twilio-signature') || '';
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/twilio/inbound-call`;
  if (!validateTwilioSignature(url, params, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  const supabase = createAdminSupabase();
  const from = params.From;

  // Find org (same pattern as inbound-sms)
  const { data: orgConfig } = await supabase
    .from('org_email_config')
    .select('org_id')
    .limit(1)
    .single();
  const orgId = orgConfig?.org_id;

  let contact = orgId ? await findContactByPhone(supabase, orgId, from) : null;

  // Create contact if new
  if (!contact && orgId) {
    const { data: newContact } = await supabase
      .from('contacts')
      .insert({
        org_id: orgId,
        first_name: 'Unknown',
        last_name: from,
        phone: from,
        source: 'inbound_call',
      })
      .select()
      .single();
    contact = newContact;
  }

  if (contact && orgId) {
    const conversation = await getOrCreateConversation(supabase, contact.id, 'voice');

    // Insert call log
    const { data: callLog } = await supabase
      .from('call_logs')
      .insert({
        conversation_id: conversation.id,
        contact_id: contact.id,
        direction: 'inbound',
        status: 'ringing',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    // Track for response time
    if (callLog) {
      await trackInboundForResponseTime(supabase, orgId, contact.id, 'voice', callLog.id);
    }

    // Log activity
    await logActivity(supabase, {
      contact_id: contact.id,
      org_id: orgId,
      event_type: 'call_inbound',
      event_data: { from, call_log_id: callLog?.id },
      ref_table: 'call_logs',
      ref_id: callLog?.id,
    });

    // Emit webhook
    await emitWebhookEvent(supabase, orgId, 'call.started', {
      call_log_id: callLog?.id,
      contact_id: contact.id,
      direction: 'inbound',
    });
  }

  // Return TwiML (ring browser, fallback to voicemail)
  // The client identity is the org's primary admin user — in production,
  // this would be looked up from the org config
  const twiml = generateInboundCallTwiml('crm-browser-client');

  return new NextResponse(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}
