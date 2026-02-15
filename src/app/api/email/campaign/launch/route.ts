import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { campaign_id } = await request.json();

  // Get campaign
  const { data: campaign } = await supabase
    .from('email_campaigns')
    .select('*')
    .eq('id', campaign_id)
    .single();

  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  if (!['draft', 'scheduled', 'paused'].includes(campaign.status)) {
    return NextResponse.json({ error: `Cannot launch campaign with status ${campaign.status}` }, { status: 400 });
  }

  // Build contact query from filter_criteria
  let query = supabase
    .from('contacts')
    .select('id, email')
    .eq('org_id', campaign.org_id)
    .eq('email_consent', true)
    .eq('do_not_contact', false)
    .is('merged_into_id', null)
    .not('email', 'is', null);

  // Apply filters
  const filters = campaign.filter_criteria as Record<string, any> || {};
  if (filters.tags?.length) {
    query = query.overlaps('tags', filters.tags);
  }
  if (filters.pipeline_stage) {
    query = query.eq('pipeline_stage', filters.pipeline_stage);
  }
  if (filters.assigned_to) {
    query = query.eq('assigned_to', filters.assigned_to);
  }

  const { data: contacts } = await query;
  if (!contacts?.length) {
    return NextResponse.json({ error: 'No eligible contacts found' }, { status: 400 });
  }

  // Check DNC list
  const { data: dncList } = await supabase
    .from('do_not_contact_list')
    .select('email')
    .eq('org_id', campaign.org_id)
    .not('email', 'is', null);

  const dncEmails = new Set(dncList?.map(d => d.email?.toLowerCase()) || []);
  const eligible = contacts.filter(c => !dncEmails.has(c.email?.toLowerCase()));

  // Create email_sends rows
  const sends = eligible.map((c, i) => ({
    campaign_id,
    contact_id: c.id,
    to_email: c.email!,
    status: 'queued' as const,
    batch_number: Math.floor(i / (campaign.batch_size || 50)) + 1,
  }));

  if (sends.length > 0) {
    await supabase.from('email_sends').insert(sends);
  }

  // Update campaign
  await supabase
    .from('email_campaigns')
    .update({
      status: 'sending',
      started_at: new Date().toISOString(),
      total_recipients: eligible.length,
    })
    .eq('id', campaign_id);

  return NextResponse.json({
    success: true,
    total_recipients: eligible.length,
    total_batches: Math.ceil(eligible.length / (campaign.batch_size || 50)),
  });
}
