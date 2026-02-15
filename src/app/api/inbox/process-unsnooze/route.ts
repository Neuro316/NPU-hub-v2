import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { verifyCronSecret } from '@/lib/crm-server';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminSupabase();

  const { data, error } = await supabase
    .from('conversations')
    .update({ snoozed_until: null })
    .lte('snoozed_until', new Date().toISOString())
    .not('snoozed_until', 'is', null)
    .select('id');

  return NextResponse.json({ unsnoozed: data?.length || 0 });
}
