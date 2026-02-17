import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { logActivity, emitWebhookEvent } from '@/lib/crm-server';

export async function POST(request: NextRequest) {
  try {
    let params: Record<string, string> = {};
    try {
      const text = await request.text();
      const searchParams = new URLSearchParams(text);
      searchParams.forEach((val, key) => { params[key] = val; });
    } catch (e) {
      console.error('call-status parse error:', e);
    }

    console.log('Call status params:', JSON.stringify(params));

    const supabase = createAdminSupabase();
    const callStatus = params.CallStatus;
    const duration = params.CallDuration ? parseInt(params.CallDuration) : undefined;

    const statusMap: Record<string, string> = {
      'ringing': 'ringing',
      'in-progress': 'in-progress',
      'completed': 'completed',
      'no-answer': 'missed',
      'busy': 'missed',
      'failed': 'missed',
      'canceled': 'missed',
    };

    const mappedStatus = statusMap[callStatus] || callStatus;

    const { data: callLog } = await supabase
      .from('call_logs')
      .select('*, contacts!inner(org_id)')
      .in('status', ['ringing', 'in-progress'])
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (callLog) {
      const updates: Record<string, unknown> = { status: mappedStatus };
      if (duration) updates.duration_seconds = duration;
      if (['completed', 'missed'].includes(mappedStatus)) {
        updates.ended_at = new Date().toISOString();
      }

      await supabase.from('call_logs').update(updates).eq('id', callLog.id);

      // ── Increment call counter when call completes ──
      if (mappedStatus === 'completed') {
        try {
          const dir = callLog.direction || 'outbound'
          const now = new Date().toISOString()

          const { data: cur } = await supabase
            .from('contacts')
            .select('total_calls, total_inbound_calls, total_outbound_calls, total_call_duration_seconds')
            .eq('id', callLog.contact_id)
            .single()

          if (cur) {
            await supabase.from('contacts').update({
              total_calls: (cur.total_calls || 0) + 1,
              total_inbound_calls: (cur.total_inbound_calls || 0) + (dir === 'inbound' ? 1 : 0),
              total_outbound_calls: (cur.total_outbound_calls || 0) + (dir === 'outbound' ? 1 : 0),
              total_call_duration_seconds: (cur.total_call_duration_seconds || 0) + (duration || 0),
              last_call_at: now,
              last_contacted_at: now,
            }).eq('id', callLog.contact_id)
          }
        } catch (e) { console.warn('Call counter increment skipped:', e) }
      }

      const orgId = (callLog as any).contacts?.org_id;
      if (orgId) {
        await logActivity(supabase, {
          contact_id: callLog.contact_id,
          org_id: orgId,
          event_type: mappedStatus === 'completed' ? 'call_completed' : 'call_missed',
          event_data: { duration, status: mappedStatus },
          ref_table: 'call_logs',
          ref_id: callLog.id,
        });
      }
    }
  } catch (e) {
    console.error('call-status error:', e);
  }

  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { 'Content-Type': 'text/xml' },
  });
}
