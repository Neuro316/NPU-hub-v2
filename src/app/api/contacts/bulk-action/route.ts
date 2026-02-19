import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { contact_ids, action, params } = await request.json();

  if (!contact_ids?.length || !action) {
    return NextResponse.json({ error: 'contact_ids and action required' }, { status: 400 });
  }

  let affected = 0;

  switch (action) {
    case 'add_tags': {
      const tags = params.tags as string[];
      for (const id of contact_ids) {
        const { data: contact } = await supabase.from('contacts').select('tags').eq('id', id).single();
        if (contact) {
          const merged = Array.from(new Set([...(contact.tags || []), ...tags]));
          await supabase.from('contacts').update({ tags: merged }).eq('id', id);
          affected++;
        }
      }
      break;
    }

    case 'remove_tags': {
      const tags = params.tags as string[];
      for (const id of contact_ids) {
        const { data: contact } = await supabase.from('contacts').select('tags').eq('id', id).single();
        if (contact) {
          const filtered = (contact.tags || []).filter((t: string) => !tags.includes(t));
          await supabase.from('contacts').update({ tags: filtered }).eq('id', id);
          affected++;
        }
      }
      break;
    }

    case 'set_pipeline_stage': {
      const { error } = await supabase
        .from('contacts')
        .update({ pipeline_stage: params.pipeline_stage })
        .in('id', contact_ids);
      if (!error) affected = contact_ids.length;
      break;
    }

    case 'set_pipeline': {
      const updates: Record<string, unknown> = {};
      if (params.pipeline_id) updates.pipeline_id = params.pipeline_id;
      if (params.pipeline_stage) updates.pipeline_stage = params.pipeline_stage;
      const { error } = await supabase
        .from('contacts')
        .update(updates)
        .in('id', contact_ids);
      if (!error) affected = contact_ids.length;
      break;
    }

    case 'assign_to': {
      const { error } = await supabase
        .from('contacts')
        .update({ assigned_to: params.assigned_to })
        .in('id', contact_ids);
      if (!error) affected = contact_ids.length;
      break;
    }

    case 'add_to_dnc': {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, org_id, phone, email')
        .in('id', contact_ids);

      for (const c of contacts || []) {
        await supabase.from('contacts').update({ do_not_contact: true }).eq('id', c.id);
        await supabase.from('do_not_contact_list').insert({
          org_id: c.org_id, phone: c.phone, email: c.email,
          reason: 'Bulk action', added_by: user.id,
        });
        affected++;
      }
      break;
    }

    case 'remove_from_dnc': {
      await supabase.from('contacts').update({ do_not_contact: false }).in('id', contact_ids);
      affected = contact_ids.length;
      break;
    }
  }

  return NextResponse.json({ success: true, affected });
}
