import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { logActivity, emitWebhookEvent, verifyCronSecret, isDNC, sendEmailViaWebhook, resolveMergeTags } from '@/lib/crm-server';
import { sendSms } from '@/lib/twilio';
import type { EmailWebhookPayload } from '@/types/crm';
// HUB-MARKETING-BEGIN
import { aiReviewState } from '@/lib/marketing/ai-review';
// HUB-MARKETING-END

// ─── POST /api/sequences/enroll ───
export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { sequence_id, contact_id } = await request.json();
  // HUB-MARKETING-BEGIN

  // Copy the Campaign Builder drafted is never sent before a person has reviewed it (agent
  // rulings 1 and 14). Its sequences are saved active like any other, so this path would
  // otherwise send unreviewed AI copy while the campaign still reads "draft". Read as the
  // caller, like every other read here; a failed read refuses. With the Builder never used
  // there are no AI steps, so this answers clear and the route behaves exactly as before.
  const review = await aiReviewState(supabase, String(sequence_id ?? ''));
  if (review === 'unknown') return NextResponse.json({ error: 'The sequence could not be checked. Try again.' }, { status: 503 });
  if (review === 'unreviewed') {
    return NextResponse.json({ error: 'This sequence has AI-drafted steps nobody has reviewed yet. Approve them on the campaign first.' }, { status: 409 });
  }
  // HUB-MARKETING-END

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
