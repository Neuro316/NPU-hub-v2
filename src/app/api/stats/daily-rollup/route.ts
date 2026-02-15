import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { verifyCronSecret } from '@/lib/crm-server';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminSupabase();
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  // Get all orgs with email configs
  const { data: configs } = await supabase.from('org_email_config').select('org_id');

  for (const config of configs || []) {
    // Ensure a stats row exists for yesterday
    await supabase
      .from('org_email_daily_stats')
      .upsert({ org_id: config.org_id, date: yesterday }, { onConflict: 'org_id,date' });
  }

  return NextResponse.json({ success: true });
}
