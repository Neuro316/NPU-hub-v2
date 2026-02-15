import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { verifyCronSecret } from '@/lib/crm-server';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminSupabase();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();

  // Clear recording URLs older than 90 days
  const { data } = await supabase
    .from('call_logs')
    .update({ recording_url: null })
    .lt('started_at', ninetyDaysAgo)
    .not('recording_url', 'is', null)
    .select('id');

  return NextResponse.json({ cleaned: data?.length || 0 });
}
