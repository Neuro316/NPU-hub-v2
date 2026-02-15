import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { verifyCronSecret, isDNC, sendEmailViaWebhook, resolveMergeTags, logActivity, getOrCreateConversation, updateLastContacted } from '@/lib/crm-server';
import { sendSms } from '@/lib/twilio';
import type { CrmContact as Contact, EmailWebhookPayload } from '@/types/crm';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminSupabase();

  // Find active enrollments with pending steps
  const { data: enrollments } = await supabase
    .from('sequence_enrollments')
    .select(`
      *,
      sequences!inner(org_id, name),
      contacts!inner(*)
    `)
    .eq('status', 'active')
    .lte('next_step_at', new Date().toISOString())
    .limit(50);

  if (!enrollments?.length) return NextResponse.json({ processed: 0 });

  let processed = 0;

  for (const enrollment of enrollments) {
    const contact = (enrollment as any).contacts as Contact;
    const sequence = (enrollment as any).sequences;
    const orgId = sequence.org_id;

    // Check DNC
    if (await isDNC(supabase, orgId, contact)) {
      await supabase
        .from('sequence_enrollments')
        .update({ status: 'cancelled' })
        .eq('id', enrollment.id);
      continue;
    }

    // Get current step
    const { data: step } = await supabase
      .from('sequence_steps')
      .select('*')
      .eq('sequence_id', enrollment.sequence_id)
      .eq('step_order', enrollment.current_step)
      .single();

    if (!step) {
      // No step found — mark complete
      await supabase
        .from('sequence_enrollments')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', enrollment.id);
      continue;
    }

    // Get org name for merge tags
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .single();

    const resolvedBody = resolveMergeTags(step.body, contact, org?.name);
    let success = false;

    // Send based on channel
    if (step.channel === 'sms') {
      if (!contact.sms_consent || !contact.phone) {
        // Skip this step, advance
      } else {
        try {
          const twilioMsg = await sendSms(contact.phone, resolvedBody);
          const conversation = await getOrCreateConversation(supabase, contact.id, 'sms');
          await supabase.from('crm_messages').insert({
            conversation_id: conversation.id,
            direction: 'outbound',
            body: resolvedBody,
            status: 'sent',
            twilio_sid: twilioMsg.sid,
            sent_at: new Date().toISOString(),
          });
          success = true;
        } catch (err) {
          console.error('Sequence SMS error:', err);
        }
      }
    } else if (step.channel === 'email') {
      if (!contact.email_consent || !contact.email) {
        // Skip
      } else {
        const { data: config } = await supabase
          .from('org_email_config')
          .select('*')
          .eq('org_id', orgId)
          .single();

        if (config?.webhook_url) {
          const resolvedSubject = step.subject
            ? resolveMergeTags(step.subject, contact, org?.name)
            : `Message from ${org?.name || 'us'}`;

          const payload: EmailWebhookPayload = {
            action: 'send',
            to: contact.email,
            from_name: config.sending_name,
            subject: resolvedSubject,
            body_html: resolvedBody,
            reply_to: config.sending_email,
            metadata: { send_id: '', org_id: orgId },
          };

          const result = await sendEmailViaWebhook(config.webhook_url, payload);
          success = result.success;
        }
      }
    }

    // Log activity
    await logActivity(supabase, {
      contact_id: contact.id,
      org_id: orgId,
      event_type: 'sequence_step_sent',
      event_data: {
        sequence_id: enrollment.sequence_id,
        step_order: enrollment.current_step,
        channel: step.channel,
        success,
      },
      ref_table: 'sequence_enrollments',
      ref_id: enrollment.id,
    });

    await updateLastContacted(supabase, contact.id);

    // Advance or complete
    const { data: nextStep } = await supabase
      .from('sequence_steps')
      .select('step_order, delay_minutes')
      .eq('sequence_id', enrollment.sequence_id)
      .eq('step_order', enrollment.current_step + 1)
      .single();

    if (nextStep) {
      const nextAt = new Date(Date.now() + nextStep.delay_minutes * 60 * 1000).toISOString();
      await supabase
        .from('sequence_enrollments')
        .update({ current_step: nextStep.step_order, next_step_at: nextAt })
        .eq('id', enrollment.id);
    } else {
      await supabase
        .from('sequence_enrollments')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', enrollment.id);
    }

    processed++;
  }

  return NextResponse.json({ processed });
}
