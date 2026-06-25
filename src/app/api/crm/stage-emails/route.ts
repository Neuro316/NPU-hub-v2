import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { sendEmailViaWebhook, resolveMergeTags } from '@/lib/crm-server';

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { org_id, contact_id, emails } = await request.json();
  if (!org_id || !contact_id || !Array.isArray(emails) || emails.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  // contact
  const { data: contact } = await supabase.from('contacts').select('*').eq('id', contact_id).single();
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

  // org email config + name
  const { data: config } = await supabase.from('org_email_config').select('*').eq('org_id', org_id).single();
  if (!config || !config.webhook_url) return NextResponse.json({ error: 'Email not configured' }, { status: 400 });
  const { data: org } = await supabase.from('organizations').select('name').eq('id', org_id).single();

  let sent = 0;
  const results: any[] = [];
  for (const em of emails) {
    try {
      let toEmail: string | null = null;
      let assignedName = '';
      if (em.recipient === 'internal') {
        if (!em.team_id) { results.push({ skip: 'no team_id' }); continue; }
        const { data: tp } = await supabase.from('team_profiles').select('email,display_name').eq('id', em.team_id).single();
        toEmail = tp?.email || null;
        assignedName = tp?.display_name || '';
      } else {
        // client
        if (!contact.email || contact.email_consent === false) { results.push({ skip: 'no client email/consent' }); continue; }
        toEmail = contact.email;
      }
      if (!toEmail) { results.push({ skip: 'no recipient email' }); continue; }

      const subject = resolveMergeTags(em.subject || '', contact, org?.name, assignedName);
      const body = resolveMergeTags(em.body || '', contact, org?.name, assignedName);

      const { data: emailSend } = await supabase.from('email_sends').insert({ contact_id, to_email: toEmail, status: 'sending' }).select().single();

      const result = await sendEmailViaWebhook(config.webhook_url, {
        action: 'send', to: toEmail, from_name: config.sending_name, subject, body_html: body, reply_to: config.sending_email,
        metadata: { send_id: emailSend?.id || '', org_id },
      } as any);

      await supabase.from('email_sends').update({
        status: result.success ? 'sent' : 'failed', provider_message_id: result.provider_message_id,
        error_message: result.error, sent_at: result.success ? new Date().toISOString() : undefined,
      }).eq('id', emailSend?.id);

      if (result.success) sent++;
      results.push({ to: toEmail, recipient: em.recipient, success: result.success, error: result.error });
    } catch (e: any) {
      results.push({ error: e?.message || String(e) });
    }
  }
  return NextResponse.json({ ok: true, sent, results });
}
