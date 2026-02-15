import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { logActivity, emitWebhookEvent, verifyCronSecret, isDNC, sendEmailViaWebhook, resolveMergeTags } from '@/lib/crm-server';
import { sendSms } from '@/lib/twilio';
import type { EmailWebhookPayload } from '@/types/crm';

// ─── POST /api/sequences/enroll ───
export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { sequence_id, contact_id } = await request.json();

  // Check not already enrolled
  const { data: existing } = await supabase
    .from('sequence_enrollments')
    .select('id')
    .eq('sequence_id', sequence_id)
    .eq('contact_id', contact_id)
    .eq('status', 'active')
    .single();

  if (existing) {
    return NextResponse.json({ error: 'Contact already enrolled in this sequence' }, { status: 409 });
  }

  // Get first step to calculate next_step_at
  const { data: firstStep } = await supabase
    .from('sequence_steps')
    .select('delay_minutes')
    .eq('sequence_id', sequence_id)
    .eq('step_order', 1)
    .single();

  const delayMs = (firstStep?.delay_minutes || 0) * 60 * 1000;
  const nextStepAt = new Date(Date.now() + delayMs).toISOString();

  const { data: enrollment } = await supabase
    .from('sequence_enrollments')
    .insert({
      sequence_id,
      contact_id,
      current_step: 1,
      status: 'active',
      next_step_at: nextStepAt,
      enrolled_by: user.id,
    })
    .select()
    .single();

  // Get org_id from sequence
  const { data: seq } = await supabase
    .from('sequences')
    .select('org_id')
    .eq('id', sequence_id)
    .single();

  if (seq) {
    await logActivity(supabase, {
      contact_id,
      org_id: seq.org_id,
      event_type: 'sequence_enrolled',
      event_data: { sequence_id, enrollment_id: enrollment?.id },
      ref_table: 'sequence_enrollments',
      ref_id: enrollment?.id,
      actor_id: user.id,
    });

    await emitWebhookEvent(supabase, seq.org_id, 'sequence.enrolled', {
      enrollment_id: enrollment?.id, sequence_id, contact_id,
    });
  }

  return NextResponse.json({ success: true, enrollment_id: enrollment?.id });
}
