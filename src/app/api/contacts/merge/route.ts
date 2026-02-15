import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { logActivity, emitWebhookEvent, applyAutoAssignment } from '@/lib/crm-server';

// ─── POST /api/contacts/merge ───
export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { surviving_contact_id, merging_contact_id } = await request.json();

  // Get both contacts
  const { data: surviving } = await supabase.from('contacts').select('*').eq('id', surviving_contact_id).single();
  const { data: merging } = await supabase.from('contacts').select('*').eq('id', merging_contact_id).single();

  if (!surviving || !merging) {
    return NextResponse.json({ error: 'Contact(s) not found' }, { status: 404 });
  }

  // Snapshot merging contact
  await supabase.from('contact_merge_log').insert({
    org_id: merging.org_id,
    surviving_contact_id,
    merged_contact_id: merging_contact_id,
    merged_contact_snapshot: merging,
    merged_by: user.id,
  });

  // Reassign all related records
  const tables = [
    { table: 'crm_messages', fk: 'conversation_id', lookup: 'conversations', lookupFk: 'contact_id' },
    { table: 'call_logs', fk: 'contact_id' },
    { table: 'email_sends', fk: 'contact_id' },
    { table: 'contact_notes', fk: 'contact_id' },
    { table: 'tasks', fk: 'contact_id' },
    { table: 'activity_log', fk: 'contact_id' },
    { table: 'sequence_enrollments', fk: 'contact_id' },
    { table: 'contact_lifecycle_events', fk: 'contact_id' },
    { table: 'response_time_log', fk: 'contact_id' },
  ];

  for (const t of tables) {
    if (t.fk === 'contact_id') {
      await supabase.from(t.table).update({ contact_id: surviving_contact_id }).eq('contact_id', merging_contact_id);
    }
  }

  // Reassign conversations
  await supabase.from('conversations').update({ contact_id: surviving_contact_id }).eq('contact_id', merging_contact_id);

  // Merge tags (union)
  const mergedTags = Array.from(new Set([...(surviving.tags || []), ...(merging.tags || [])]));
  await supabase.from('contacts').update({ tags: mergedTags }).eq('id', surviving_contact_id);

  // Soft-delete merging contact
  await supabase.from('contacts').update({
    merged_into_id: surviving_contact_id,
    do_not_contact: true,
  }).eq('id', merging_contact_id);

  // Log activity
  await logActivity(supabase, {
    contact_id: surviving_contact_id,
    org_id: surviving.org_id,
    event_type: 'contact_merged',
    event_data: { merged_contact_id: merging_contact_id, merged_name: `${merging.first_name} ${merging.last_name}` },
    actor_id: user.id,
  });

  return NextResponse.json({ success: true });
}
