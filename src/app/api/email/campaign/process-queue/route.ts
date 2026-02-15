import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { verifyCronSecret, sendEmailViaWebhook, resolveMergeTags } from '@/lib/crm-server';
import type { EmailWebhookPayload, CrmContact as Contact } from '@/types/crm';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminSupabase();

  // Find campaigns that are currently sending
  const { data: campaigns } = await supabase
    .from('email_campaigns')
    .select('*')
    .eq('status', 'sending');

  if (!campaigns?.length) return NextResponse.json({ processed: 0 });

  let totalSent = 0;

  for (const campaign of campaigns) {
    // Get org email config
    const { data: config } = await supabase
      .from('org_email_config')
      .select('*')
      .eq('org_id', campaign.org_id)
      .single();

    if (!config?.webhook_url) continue;

    // Check daily limit
    const today = new Date().toISOString().split('T')[0];
    const { data: todayStats } = await supabase
      .from('org_email_daily_stats')
      .select('sent_count')
      .eq('org_id', campaign.org_id)
      .eq('date', today)
      .single();

    const sentToday = todayStats?.sent_count || 0;
    let dailyLimit = config.daily_send_limit;

    // Apply warmup
    if (config.warmup_enabled) {
      const { data: statHistory } = await supabase
        .from('org_email_daily_stats')
        .select('date')
        .eq('org_id', campaign.org_id)
        .order('date', { ascending: true })
        .limit(1);

      if (statHistory?.length) {
        const daysSinceStart = Math.floor(
          (Date.now() - new Date(statHistory[0].date).getTime()) / (1000 * 60 * 60 * 24)
        );
        const warmupLimit = 50 * Math.pow(2, daysSinceStart);
        dailyLimit = Math.min(dailyLimit, warmupLimit);
      }
    }

    if (sentToday >= dailyLimit) continue; // Daily limit reached

    const batchSize = Math.min(config.batch_size, dailyLimit - sentToday);

    // Get next batch of queued sends
    const { data: sends } = await supabase
      .from('email_sends')
      .select('*, contacts!inner(*)')
      .eq('campaign_id', campaign.id)
      .eq('status', 'queued')
      .limit(batchSize);

    if (!sends?.length) {
      // No more sends — mark campaign complete
      await supabase
        .from('email_campaigns')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', campaign.id);
      continue;
    }

    // Get org name
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', campaign.org_id)
      .single();

    let batchSent = 0;
    let batchFailed = 0;

    for (const send of sends) {
      const contact = (send as any).contacts as Contact;

      const resolvedSubject = resolveMergeTags(campaign.subject, contact, org?.name);
      const resolvedBody = resolveMergeTags(campaign.body_html, contact, org?.name);

      const payload: EmailWebhookPayload = {
        action: 'send',
        to: send.to_email,
        from_name: config.sending_name,
        subject: resolvedSubject,
        body_html: resolvedBody,
        reply_to: config.sending_email,
        metadata: {
          send_id: send.id,
          campaign_id: campaign.id,
          org_id: campaign.org_id,
        },
      };

      const result = await sendEmailViaWebhook(config.webhook_url, payload);

      await supabase
        .from('email_sends')
        .update({
          status: result.success ? 'sent' : 'failed',
          provider_message_id: result.provider_message_id,
          error_message: result.error,
          sent_at: result.success ? new Date().toISOString() : undefined,
        })
        .eq('id', send.id);

      if (result.success) batchSent++;
      else batchFailed++;
    }

    // Update campaign counts
    await supabase
      .from('email_campaigns')
      .update({
        sent_count: campaign.sent_count + batchSent,
        failed_count: campaign.failed_count + batchFailed,
      })
      .eq('id', campaign.id);

    // Update daily stats
    await supabase.rpc('upsert_email_daily_stats', {
      p_org_id: campaign.org_id,
      p_date: today,
      p_sent: batchSent,
    });

    totalSent += batchSent;
  }

  return NextResponse.json({ processed: totalSent });
}
