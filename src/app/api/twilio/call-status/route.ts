import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { logActivity, emitWebhookEvent } from '@/lib/crm-server';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((val, key) => { params[key] = val.toString(); });

  const supabase = createAdminSupabase();
  const callSid = params.CallSid;
  const callStatus = params.CallStatus;
  const duration = params.CallDuration ? parseInt(params.CallDuration) : undefined;

  // Find the call log by matching the Twilio call — we use the most recent ringing/in-progress call
  // In production, store CallSid on the call_log at creation time for exact matching
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

  // Update the most recent non-completed call log
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

      await emitWebhookEvent(supabase, orgId, 'call.completed', {
        call_log_id: callLog.id,
        contact_id: callLog.contact_id,
        status: mappedStatus,
        duration,
      });
    }
  }

  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { 'Content-Type': 'text/xml' },
  });
}
