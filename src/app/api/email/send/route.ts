import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import {
  isDNC, logActivity, emitWebhookEvent, updateLastContacted,
  getOrCreateConversation, sendEmailViaWebhook, resolveMergeTags
} from '@/lib/crm-server';
import type { EmailWebhookPayload } from '@/types/crm';

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { org_id, contact_id, subject, body_html } = await request.json();

  // Get contact
  const { data: contact } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', contact_id)
    .single();

  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  if (await isDNC(supabase, org_id, contact)) {
    return NextResponse.json({ error: 'DNC' }, { status: 403 });
  }
  if (!contact.email_consent || !contact.email) {
    return NextResponse.json({ error: 'Email consent or address missing' }, { status: 403 });
  }

  // Get org email config
  const { data: config } = await supabase
    .from('org_email_config')
    .select('*')
    .eq('org_id', org_id)
    .single();

  if (!config || !config.webhook_url) {
    return NextResponse.json({ error: 'Email not configured for this org' }, { status: 400 });
  }

  // Get org name for merge tags
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', org_id)
    .single();

  const resolvedSubject = resolveMergeTags(subject, contact, org?.name);
  const resolvedBody = resolveMergeTags(body_html, contact, org?.name);

  // Create email_sends record
  const { data: emailSend } = await supabase
    .from('email_sends')
    .insert({
      contact_id,
      to_email: contact.email,
      status: 'sending',
    })
    .select()
    .single();

  // Send via webhook
  const payload: EmailWebhookPayload = {
    action: 'send',
    to: contact.email,
    from_name: config.sending_name,
    subject: resolvedSubject,
    body_html: resolvedBody,
    reply_to: config.sending_email,
    metadata: {
      send_id: emailSend?.id || '',
      org_id,
    },
  };

  const result = await sendEmailViaWebhook(config.webhook_url, payload);

  // Update email_sends
  await supabase
    .from('email_sends')
    .update({
      status: result.success ? 'sent' : 'failed',
      provider_message_id: result.provider_message_id,
      error_message: result.error,
      sent_at: result.success ? new Date().toISOString() : undefined,
    })
    .eq('id', emailSend?.id);

  // Log in conversation timeline
  const conversation = await getOrCreateConversation(supabase, contact_id, 'email');
  await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id);

  await updateLastContacted(supabase, contact_id);

  await logActivity(supabase, {
    contact_id,
    org_id,
    event_type: 'email_sent',
    event_data: { subject: resolvedSubject, status: result.success ? 'sent' : 'failed' },
    ref_table: 'email_sends',
    ref_id: emailSend?.id,
    actor_id: user.id,
  });

  return NextResponse.json({ success: result.success, send_id: emailSend?.id });
}
