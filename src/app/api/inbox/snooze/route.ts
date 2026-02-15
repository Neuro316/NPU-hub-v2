import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { verifyCronSecret } from '@/lib/crm-server';

// ─── POST /api/inbox/snooze ───
export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { conversation_id, snooze_until } = await request.json();

  const { error } = await supabase
    .from('conversations')
    .update({ snoozed_until: snooze_until })
    .eq('id', conversation_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
