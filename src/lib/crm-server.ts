import { SupabaseClient } from '@supabase/supabase-js';
import type { CrmContact as Contact, EmailWebhookPayload } from '@/types/crm';

// ─── Do Not Contact Check ───
// Returns true if contact should NOT be messaged
export async function isDNC(
  supabase: SupabaseClient,
  orgId: string,
  contact: Pick<Contact, 'id' | 'phone' | 'email' | 'do_not_contact'>
): Promise<boolean> {
  if (contact.do_not_contact) return true;

  const { data } = await supabase
    .from('do_not_contact_list')
    .select('id')
    .eq('org_id', orgId)
    .or(`phone.eq.${contact.phone},email.eq.${contact.email}`)
    .limit(1);

  return (data?.length ?? 0) > 0;
}

// ─── Resolve Merge Tags ───
export function resolveMergeTags(
  template: string,
  contact: Contact,
  orgName?: string,
  assignedName?: string
): string {
  const tags: Record<string, string> = {
    '{{first_name}}': contact.first_name || '',
    '{{last_name}}': contact.last_name || '',
    '{{email}}': contact.email || '',
    '{{phone}}': contact.phone || '',
    '{{org_name}}': orgName || '',
    '{{assigned_to_name}}': assignedName || '',
    '{{pipeline_stage}}': contact.pipeline_stage || '',
  };

  let result = template;
  for (const [tag, value] of Object.entries(tags)) {
    result = result.replaceAll(tag, value);
  }
  // Clear any unresolved tags
  result = result.replace(/\{\{[^}]+\}\}/g, '');
  return result;
}

// ─── Log Activity ───
export async function logActivity(
  supabase: SupabaseClient,
  entry: {
    contact_id: string;
    org_id: string;
    event_type: string;
    event_data?: Record<string, unknown>;
    ref_table?: string;
    ref_id?: string;
    actor_id?: string;
  }
) {
  await supabase.from('activity_log').insert({
    ...entry,
    occurred_at: new Date().toISOString(),
  });
}

// ─── Emit Webhook Event ───
export async function emitWebhookEvent(
  supabase: SupabaseClient,
  orgId: string,
  eventType: string,
  payload: Record<string, unknown>
) {
  await supabase.from('webhook_events_out').insert({
    org_id: orgId,
    event_type: eventType,
    payload,
    status: 'pending',
  });
}

// ─── Update Last Contacted ───
export async function updateLastContacted(
  supabase: SupabaseClient,
  contactId: string
) {
  await supabase
    .from('contacts')
    .update({ last_contacted_at: new Date().toISOString() })
    .eq('id', contactId);
}

// ─── Get or Create Conversation ───
export async function getOrCreateConversation(
  supabase: SupabaseClient,
  contactId: string,
  channel: 'sms' | 'voice' | 'email'
) {
  // Try to find existing
  const { data: existing } = await supabase
    .from('conversations')
    .select('*')
    .eq('contact_id', contactId)
    .eq('channel', channel)
    .single();

  if (existing) return existing;

  // Create new
  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ contact_id: contactId, channel })
    .select()
    .single();

  if (error) throw error;
  return created;
}

// ─── Find Contact by Phone ───
export async function findContactByPhone(
  supabase: SupabaseClient,
  orgId: string,
  phone: string
) {
  const { data } = await supabase
    .from('contacts')
    .select('*')
    .eq('org_id', orgId)
    .eq('phone', phone)
    .is('merged_into_id', null)
    .single();

  return data;
}

// ─── Apply Auto-Assignment Rules ───
export async function applyAutoAssignment(
  supabase: SupabaseClient,
  orgId: string,
  contact: Partial<Contact>
): Promise<string | null> {
  const { data: rules } = await supabase
    .from('auto_assignment_rules')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('priority', { ascending: true });

  if (!rules?.length) return null;

  for (const rule of rules) {
    // Tag match
    if (rule.rule_type === 'tag_match' && contact.tags?.includes(rule.match_value)) {
      return rule.assign_to;
    }
    // Pipeline match
    if (rule.rule_type === 'pipeline_match' && contact.pipeline_stage === rule.match_value) {
      return rule.assign_to;
    }
    // Source match
    if (rule.rule_type === 'source_match' && contact.source === rule.match_value) {
      return rule.assign_to;
    }
    // Round robin
    if (rule.rule_type === 'round_robin' && rule.round_robin_pool?.length) {
      const pool = rule.round_robin_pool;
      const lastIdx = rule.last_assigned_to
        ? pool.indexOf(rule.last_assigned_to)
        : -1;
      const nextIdx = (lastIdx + 1) % pool.length;
      const nextMember = pool[nextIdx];

      // Update last_assigned_to
      await supabase
        .from('auto_assignment_rules')
        .update({ last_assigned_to: nextMember })
        .eq('id', rule.id);

      return nextMember;
    }
  }

  return null;
}

// ─── Track Response Time ───
export async function trackInboundForResponseTime(
  supabase: SupabaseClient,
  orgId: string,
  contactId: string,
  channel: 'sms' | 'voice' | 'email',
  inboundRefId: string
) {
  await supabase.from('response_time_log').insert({
    org_id: orgId,
    contact_id: contactId,
    channel,
    inbound_at: new Date().toISOString(),
    inbound_ref_id: inboundRefId,
  });
}

export async function recordResponseTime(
  supabase: SupabaseClient,
  orgId: string,
  contactId: string,
  channel: 'sms' | 'voice' | 'email',
  responderId: string
) {
  // Find the most recent unresolved inbound for this contact+channel
  const { data: pending } = await supabase
    .from('response_time_log')
    .select('*')
    .eq('org_id', orgId)
    .eq('contact_id', contactId)
    .eq('channel', channel)
    .is('first_reply_at', null)
    .order('inbound_at', { ascending: false })
    .limit(1)
    .single();

  if (!pending) return;

  const now = new Date();
  const inboundAt = new Date(pending.inbound_at);
  const responseSeconds = Math.floor((now.getTime() - inboundAt.getTime()) / 1000);

  await supabase
    .from('response_time_log')
    .update({
      first_reply_at: now.toISOString(),
      response_seconds: responseSeconds,
      responder_id: responderId,
    })
    .eq('id', pending.id);
}

// ─── Send Email via Org Webhook ───
export async function sendEmailViaWebhook(
  webhookUrl: string,
  payload: EmailWebhookPayload
): Promise<{ success: boolean; provider_message_id?: string; error?: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─── Calculate Contact Health Score ───
export async function calculateHealthScore(
  supabase: SupabaseClient,
  contactId: string
): Promise<{ score: number; tier: string; factors: Record<string, number> }> {
  // Recency (25%)
  const { data: contact } = await supabase
    .from('contacts')
    .select('last_contacted_at')
    .eq('id', contactId)
    .single();

  const daysSinceContact = contact?.last_contacted_at
    ? (Date.now() - new Date(contact.last_contacted_at).getTime()) / (1000 * 60 * 60 * 24)
    : 999;
  const recencyScore = Math.max(0, 100 - (daysSinceContact * 3.3)); // decays over ~30 days

  // Our response time (15%)
  const { data: ourResponses } = await supabase
    .from('response_time_log')
    .select('response_seconds')
    .eq('contact_id', contactId)
    .not('response_seconds', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5);

  const avgOurResponse = ourResponses?.length
    ? ourResponses.reduce((sum, r) => sum + (r.response_seconds || 0), 0) / ourResponses.length
    : 999999;
  const ourResponseScore = Math.max(0, 100 - (avgOurResponse / 3600) * 20); // 5hr = 0

  // Sentiment (20%)
  const { data: recentCalls } = await supabase
    .from('call_logs')
    .select('sentiment')
    .eq('contact_id', contactId)
    .not('sentiment', 'is', null)
    .order('started_at', { ascending: false })
    .limit(3);

  const sentimentMap: Record<string, number> = {
    positive: 100, neutral: 60, negative: 20, concerned: 30,
  };
  const sentimentScore = recentCalls?.length
    ? recentCalls.reduce((sum, c) => sum + (sentimentMap[c.sentiment || 'neutral'] || 60), 0) / recentCalls.length
    : 50;

  // Email engagement (15%)
  const { data: recentEmails } = await supabase
    .from('email_sends')
    .select('opened_at, clicked_at')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(10);

  const openRate = recentEmails?.length
    ? recentEmails.filter(e => e.opened_at).length / recentEmails.length
    : 0;
  const engagementScore = openRate * 100;

  // Lifecycle progress (10%)
  const { data: events } = await supabase
    .from('contact_lifecycle_events')
    .select('event_type')
    .eq('contact_id', contactId);

  const lifecycleWeight: Record<string, number> = {
    enrolled: 30, completed_week: 50, graduated: 90, referred: 100,
    churned: 10, reactivated: 60, custom: 40,
  };
  const lifecycleScore = events?.length
    ? Math.min(100, events.reduce((max, e) => Math.max(max, lifecycleWeight[e.event_type] || 40), 0))
    : 0;

  // Their response time (15%) — approximated from inbound message frequency
  const theirResponseScore = 50; // placeholder — requires more message analysis

  // Weighted total
  const score = Math.round(
    recencyScore * 0.25 +
    theirResponseScore * 0.15 +
    ourResponseScore * 0.15 +
    sentimentScore * 0.20 +
    engagementScore * 0.15 +
    lifecycleScore * 0.10
  );

  const tier = score >= 80 ? 'thriving' : score >= 50 ? 'stable' : score >= 20 ? 'at_risk' : 'critical';

  return {
    score,
    tier,
    factors: {
      recency: Math.round(recencyScore),
      their_response: Math.round(theirResponseScore),
      our_response: Math.round(ourResponseScore),
      sentiment: Math.round(sentimentScore),
      engagement: Math.round(engagementScore),
      lifecycle: Math.round(lifecycleScore),
    },
  };
}

// ─── Cron Auth Helper ───
export function verifyCronSecret(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}
