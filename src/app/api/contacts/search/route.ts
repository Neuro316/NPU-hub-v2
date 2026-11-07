import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  const tags = searchParams.get('tags')?.split(',').filter(Boolean);
  // Pipeline membership is contact_pipeline_positions (hub_229): filter by pipelines.id and/or pipeline_stages.id.
  // The legacy pipeline_stage parameter (contacts.pipeline_stage) is no longer read.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const pipeline_id = searchParams.get('pipeline_id');
  const stage_id = searchParams.get('stage_id');
  if ((pipeline_id && !UUID.test(pipeline_id)) || (stage_id && !UUID.test(stage_id))) {
    return NextResponse.json({ error: 'pipeline_id and stage_id must be ids' }, { status: 400 });
  }
  const byPosition = !!(pipeline_id || stage_id);
  const assigned_to = searchParams.get('assigned_to');
  const last_contacted_before = searchParams.get('last_contacted_before');
  const last_contacted_after = searchParams.get('last_contacted_after');
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');

  let query = supabase
    .from('contacts')
    .select(byPosition
      ? '*, team_members!contacts_assigned_to_fkey(display_name), contact_pipeline_positions!inner(pipeline_id, stage_id)'
      : '*, team_members!contacts_assigned_to_fkey(display_name)', { count: 'exact' })
    .is('merged_into_id', null)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  // Full-text search
  if (q) {
    query = query.textSearch('search_vector', q, { type: 'websearch' });
  }

  // Filters
  if (tags?.length) {
    query = query.overlaps('tags', tags);
  }
  if (pipeline_id) {
    query = query.eq('contact_pipeline_positions.pipeline_id', pipeline_id);
  }
  if (stage_id) {
    query = query.eq('contact_pipeline_positions.stage_id', stage_id);
  }
  if (assigned_to) {
    query = query.eq('assigned_to', assigned_to);
  }
  if (last_contacted_before) {
    query = query.lte('last_contacted_at', last_contacted_before);
  }
  if (last_contacted_after) {
    query = query.gte('last_contacted_at', last_contacted_after);
  }

  const { data, count, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ contacts: data, total: count });
}
