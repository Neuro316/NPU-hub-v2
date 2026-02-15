import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { sendSms } from '@/lib/twilio';
import { verifyCronSecret } from '@/lib/crm-server';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminSupabase();

  // Find scheduled messages ready to send
  const { data: scheduled } = await supabase
    .from('crm_messages')
    .select(`
      *,
      conversations!inner(
        contact_id,
        contacts!inner(phone, org_id, sms_consent, do_not_contact)
      )
    `)
    .eq('status', 'scheduled')
    .lte('scheduled_for', new Date().toISOString())
    .limit(50);

  if (!scheduled?.length) {
    return NextResponse.json({ processed: 0 });
  }

  let sent = 0;
  for (const msg of scheduled) {
    const contact = (msg as any).conversations?.contacts;
    if (!contact?.phone || !contact.sms_consent || contact.do_not_contact) {
      await supabase.from('crm_messages').update({ status: 'failed' }).eq('id', msg.id);
      continue;
    }

    try {
      const twilioMsg = await sendSms(contact.phone, msg.body);
      await supabase
        .from('crm_messages')
        .update({
          status: 'sent',
          twilio_sid: twilioMsg.sid,
          sent_at: new Date().toISOString(),
        })
        .eq('id', msg.id);
      sent++;
    } catch (err) {
      await supabase.from('crm_messages').update({ status: 'failed' }).eq('id', msg.id);
    }
  }

  return NextResponse.json({ processed: sent });
}
