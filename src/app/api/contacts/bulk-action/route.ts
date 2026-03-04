import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  // Auth check with user-context client
  const authClient = createServerSupabase();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Use admin (service role) client for actual DB ops - bypasses RLS
  const supabase = createAdminSupabase();

  const { contact_ids, action, params } = await request.json();

  if (!contact_ids?.length || !action) {
    return NextResponse.json({ error: 'contact_ids and action required' }, { status: 400 });
  }

  // Validate: get the user's org_id to ensure they own these contacts
  const { data: membership } = await supabase
    .from('org_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (!membership) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  const orgId = membership.organization_id;

  // Only operate on contacts belonging to this org
  const { data: validContacts } = await supabase
    .from('contacts')
    .select('id')
    .eq('org_id', orgId)
    .in('id', contact_ids);

  const validIds = (validContacts || []).map(c => c.id);
  if (validIds.length === 0) {
    return NextResponse.json({ success: true, affected: 0, message: 'No matching contacts found in your organization' });
  }

  let affected = 0;
  let error: any = null;

  switch (action) {
    case 'add_tags': {
      const tags = params.tags as string[];
      if (!tags?.length) break;
      for (const id of validIds) {
        const { data: contact } = await supabase.from('contacts').select('tags').eq('id', id).single();
        if (contact) {
          const merged = Array.from(new Set([...(contact.tags || []), ...tags]));
          const { error: updateErr } = await supabase.from('contacts').update({ tags: merged, updated_at: new Date().toISOString() }).eq('id', id);
          if (!updateErr) affected++;
          else console.error('Tag update error:', updateErr);
        }
      }
      break;
    }

    case 'remove_tags': {
      const tags = params.tags as string[];
      if (!tags?.length) break;
      for (const id of validIds) {
        const { data: contact } = await supabase.from('contacts').select('tags').eq('id', id).single();
        if (contact) {
          const filtered = (contact.tags || []).filter((t: string) => !tags.includes(t));
          const { error: updateErr } = await supabase.from('contacts').update({ tags: filtered, updated_at: new Date().toISOString() }).eq('id', id);
          if (!updateErr) affected++;
          else console.error('Tag remove error:', updateErr);
        }
      }
      break;
    }

    case 'set_pipeline_stage': {
      const { data, error: err } = await supabase
        .from('contacts')
        .update({ pipeline_stage: params.pipeline_stage, updated_at: new Date().toISOString() })
        .in('id', validIds)
        .select('id');
      error = err;
      affected = data?.length || 0;
      break;
    }

    case 'set_pipeline': {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (params.pipeline_id !== undefined) updates.pipeline_id = params.pipeline_id;
      if (params.pipeline_stage !== undefined) updates.pipeline_stage = params.pipeline_stage;
      const { data, error: err } = await supabase
        .from('contacts')
        .update(updates)
        .in('id', validIds)
        .select('id');
      error = err;
      affected = data?.length || 0;
      break;
    }

    case 'assign_to': {
      const { data, error: err } = await supabase
        .from('contacts')
        .update({ assigned_to: params.assigned_to, updated_at: new Date().toISOString() })
        .in('id', validIds)
        .select('id');
      error = err;
      affected = data?.length || 0;
      break;
    }

    case 'add_to_dnc': {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, org_id, phone, email')
        .in('id', validIds);

      for (const c of contacts || []) {
        const { error: updateErr } = await supabase.from('contacts').update({ do_not_contact: true, updated_at: new Date().toISOString() }).eq('id', c.id);
        if (!updateErr) {
          await supabase.from('do_not_contact_list').upsert({
            org_id: c.org_id, phone: c.phone, email: c.email,
            reason: 'Bulk action', added_by: user.id,
          }, { onConflict: 'org_id,phone' });
          affected++;
        }
      }
      break;
    }

    case 'remove_from_dnc': {
      const { data, error: err } = await supabase
        .from('contacts')
        .update({ do_not_contact: false, updated_at: new Date().toISOString() })
        .in('id', validIds)
        .select('id');
      error = err;
      affected = data?.length || 0;
      break;
    }
  }

  if (error) {
    console.error('Bulk action DB error:', error);
    return NextResponse.json({ success: false, error: error.message, affected }, { status: 500 });
  }

  return NextResponse.json({ success: true, affected });
}
