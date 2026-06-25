import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { resolveMergeTags } from '@/lib/crm-server';

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

  // stage email script config (Apps Script URL + secret)
  const { data: setting } = await supabase.from('org_settings').select('setting_value').eq('org_id', org_id).eq('setting_key', 'stage_email_script').single();
  const cfg = setting?.setting_value as any;
  if (!cfg?.url || !cfg?.enabled) return NextResponse.json({ error: 'Stage email script not configured' }, { status: 400 });

  // org name for merge tags
  const { data: org } = await supabase.from('organizations').select('name').eq('id', org_id).single();
  const senderName = cfg.sender_name || 'Cameron Allen';

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
        if (!contact.email) { results.push({ skip: 'no client email' }); continue; }
        if (contact.email_consent === false) { results.push({ skip: 'no client consent' }); continue; }
        toEmail = contact.email;
      }
      if (!toEmail) { results.push({ skip: 'no recipient email' }); continue; }

      const subject = resolveMergeTags(em.subject || '', contact, org?.name, assignedName);
      const body = resolveMergeTags(em.body || '', contact, org?.name, assignedName);

      const resp = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sendEmail', to: toEmail, subject, body_html: body, senderName, secret: cfg.secret }),
      });
      const result = await resp.json().catch(() => ({ success: false, error: 'bad response' }));

      // log the send
      await supabase.from('email_sends').insert({ contact_id, to_email: toEmail, status: result.success ? 'sent' : 'failed', provider_message_id: result.provider_message_id || null, error_message: result.error || null, sent_at: result.success ? new Date().toISOString() : null });

      if (result.success) sent++;
      results.push({ to: toEmail, recipient: em.recipient, success: !!result.success, error: result.error });
    } catch (e: any) {
      results.push({ error: e?.message || String(e) });
    }
  }
  return NextResponse.json({ ok: true, sent, results });
}
