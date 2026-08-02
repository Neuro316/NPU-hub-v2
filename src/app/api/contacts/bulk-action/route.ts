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
  // Contacts whose do_not_contact flag was written but whose suppression-list
  // record was NOT. Tracked separately because the two writes can diverge and
  // the operator has to be told when they do.
  let dncAuditFailures = 0;

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
        if (updateErr) {
          console.error('[bulk-action] add_to_dnc: flag write failed for', c.id, updateErr);
          continue;
        }

        // INSERT, not UPSERT. The previous upsert specified onConflict
        // 'org_id,phone' against an index that does not exist — there is no
        // unique index on (org_id, phone), only a NON-UNIQUE PARTIAL one — so it
        // raised 42P10 on every call. That error was discarded and affected++ ran
        // anyway, so every bulk DNC set the flag, wrote no audit row, and reported
        // success. This is what made the DNC population unattributable.
        //
        // Append-only is also the right shape: a suppression entry is a fact at a
        // point in time. An audit row that can be overwritten is not an audit row,
        // and 90 of 96 DNC contacts have a NULL phone, so (org_id, phone) cannot
        // identify them either way.
        const { error: auditErr } = await supabase.from('do_not_contact_list').insert({
          org_id: c.org_id, phone: c.phone, email: c.email,
          reason: 'Bulk action', added_by: user.id,
        });

        if (auditErr) {
          // The flag is NOT rolled back. Leaving someone contactable who was just
          // marked do-not-contact is the worse failure of the two, so this fails
          // SAFE in the restrictive direction. But it is not counted as success,
          // and the divergence is reported below.
          console.error('[bulk-action] add_to_dnc: flag set but audit row FAILED for', c.id, auditErr);
          dncAuditFailures++;
          continue;
        }
        affected++;
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

  // Reported BEFORE the generic error tail, and deliberately with HTTP 200.
  // Routing this through the 500 path below would make bulkUpdateContacts
  // (crm-client.ts:433) discard `affected` and report 0, telling the operator
  // nothing happened when flags in fact landed — the same silent divergence in
  // the opposite direction.
  if (dncAuditFailures > 0) {
    return NextResponse.json({
      success: false,
      affected,
      audit_failures: dncAuditFailures,
      error:
        `${dncAuditFailures} contact(s) were flagged do-not-contact, but their suppression-list ` +
        `record could not be written. The flag STANDS and was not rolled back. Those contacts ` +
        `now carry no audit trail for why they were suppressed — record them manually.`,
    });
  }

  if (error) {
    console.error('Bulk action DB error:', error);
    return NextResponse.json({ success: false, error: error.message, affected }, { status: 500 });
  }

  return NextResponse.json({ success: true, affected });
}
