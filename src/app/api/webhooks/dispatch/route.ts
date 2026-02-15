import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { verifyCronSecret } from '@/lib/crm-server';
import { createHmac } from 'crypto';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminSupabase();

  // Get pending events
  const { data: events } = await supabase
    .from('webhook_events_out')
    .select('*')
    .eq('status', 'pending')
    .lt('attempts', 3)
    .order('created_at', { ascending: true })
    .limit(50);

  if (!events?.length) return NextResponse.json({ processed: 0 });

  let dispatched = 0;

  for (const event of events) {
    // Find matching subscriptions
    const { data: subs } = await supabase
      .from('webhook_subscriptions')
      .select('*')
      .eq('org_id', event.org_id)
      .eq('is_active', true)
      .contains('events', [event.event_type]);

    if (!subs?.length) {
      await supabase
        .from('webhook_events_out')
        .update({ status: 'sent' }) // No subscribers, mark as handled
        .eq('id', event.id);
      continue;
    }

    let allSuccess = true;

    for (const sub of subs) {
      // Generate HMAC signature
      const signature = createHmac('sha256', sub.secret)
        .update(JSON.stringify(event.payload))
        .digest('hex');

      try {
        const res = await fetch(sub.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Event-Type': event.event_type,
          },
          body: JSON.stringify(event.payload),
          signal: AbortSignal.timeout(10000), // 10s timeout
        });

        if (!res.ok) allSuccess = false;
      } catch {
        allSuccess = false;
      }
    }

    await supabase
      .from('webhook_events_out')
      .update({
        status: allSuccess ? 'sent' : (event.attempts + 1 >= 3 ? 'failed' : 'pending'),
        attempts: event.attempts + 1,
        last_attempt_at: new Date().toISOString(),
      })
      .eq('id', event.id);

    if (allSuccess) dispatched++;
  }

  return NextResponse.json({ processed: dispatched });
}
