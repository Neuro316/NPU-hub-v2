import { createAdminSupabase } from '@/lib/supabase';
import { withVault } from '@/lib/org-vault';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminSupabase();

  // The webhook lives in Vault (src/lib/org-vault.ts). Behavior kept as it was: one config row is required.
  // ⚠ Two orgs hold slack_crm_due_dates, so (as with the .single() this replaces) no webhook is chosen and the
  // cron answers "No Slack config found". Fixing that means choosing an org per contact; not done here.
  const { data: rows } = await supabase
    .from('org_settings')
    .select('org_id, setting_value')
    .eq('setting_key', 'slack_crm_due_dates');
  const configs = await withVault(supabase, 'slack_crm_due_dates', (rows ?? []) as { org_id: string; setting_value: any }[]);

  const webhookUrl = configs.length === 1 ? configs[0].setting_value?.webhook_url : null;
  if (!webhookUrl) return NextResponse.json({ error: 'No Slack config found' }, { status: 500 });

  const todayStr = new Date().toISOString().split('T')[0];

  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, due_date, due_date_action, due_date_channel')
    .eq('due_date', todayStr)
    .eq('due_date_notified', false)
    .not('due_date_action', 'is', null);


  if (error) {
    console.error('CRM due date cron error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!contacts || contacts.length === 0) {
    return NextResponse.json({ message: 'No due dates today', count: 0 });
  }

  const results = [];

  for (const contact of contacts) {
    const fullName = `${contact.first_name} ${contact.last_name}`;
    const action = contact.due_date_action;

    const slackPayload = {
      channel: '#technical-leadership',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '📋 CRM Action Due Today', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Client:*\n${fullName}` },
            { type: 'mrkdwn', text: `*Due Date:*\n${todayStr}` },
          ],
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Action Required:*\n${action}` },
        },
        { type: 'divider' },
      ],
    };

    const slackRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload),
    });

    if (slackRes.ok) {
      await supabase
        .from('contacts')
        .update({ due_date_notified: true })
        .eq('id', contact.id);

      results.push({ client: fullName, status: 'sent' });
    } else {
      results.push({ client: fullName, status: 'failed' });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
