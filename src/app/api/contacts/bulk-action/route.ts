import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { summariseBulkStageMove } from '@/lib/marketing/entry-events';
import { loadPipelines, findPipeline, resolveStage, firstStage, setStage, removeFromPipeline, type PipelineRef } from '@/lib/pipelines/positions';

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
  // Funnel campaigns (hub_212): a stage move raises stage entry events through a
  // database trigger. The cron enrolls them, capped per run; this only reports.
  const stageMoveStarted = new Date().toISOString();
  let campaignNote: string | null = null;

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

    // Pipeline membership lives in contact_pipeline_positions (hub_229), one row per pipeline. A bulk move sets
    // the stage in the chosen stage's pipeline only; the contacts' other pipelines are untouched. The legacy
    // contacts.pipeline_id / pipeline_stage columns are not written.
    //
    // params: { stage_id } (uuid). Older callers may send { pipeline_id: <legacy key or uuid>, pipeline_stage?:
    // <stage name> }; that is resolved exactly (no stage name means the first stage), never guessed. A stage name
    // with no pipeline is refused, because the same name can exist in several pipelines.
    case 'set_pipeline_stage':
    case 'set_pipeline': {
      let pipelines: PipelineRef[];
      try { pipelines = await loadPipelines(supabase, orgId); }
      catch (e) {
        console.error(`[bulk-action] ${action} org=${orgId} pipelines read failed: ${(e as Error).message}`);
        return NextResponse.json({ success: false, affected: 0, error: 'Pipelines could not be read. Try again.' }, { status: 500 });
      }
      let stageId: string | null = null;
      if (typeof params?.stage_id === 'string') {
        stageId = pipelines.flatMap(p => p.stages).find(s => s.id === params.stage_id)?.id ?? null;
      } else if (typeof params?.pipeline_id === 'string' && params.pipeline_id) {
        stageId = typeof params?.pipeline_stage === 'string' && params.pipeline_stage
          ? resolveStage(pipelines, params.pipeline_id, params.pipeline_stage)?.id ?? null
          : firstStage(findPipeline(pipelines, params.pipeline_id))?.id ?? null;
      }
      if (!stageId) {
        return NextResponse.json({ success: false, affected: 0, error: 'Choose a pipeline and a stage.' }, { status: 400 });
      }
      let failed = 0;
      for (const id of validIds) {
        try { await setStage(supabase, id, stageId, user.id, 'bulk'); affected++; }
        catch (e) { failed++; console.error(`[bulk-action] set stage contact=${id} failed: ${(e as Error).message}`); }
      }
      if (failed) error = { message: `${failed} contact${failed === 1 ? '' : 's'} could not be moved. Try again.` };
      if (affected) campaignNote = (await summariseBulkStageMove(supabase, orgId, stageMoveStarted, affected, user.id)).note;
      break;
    }

    // params: { pipeline_id } (uuid or legacy key). Removes the contacts from that one pipeline only.
    case 'remove_from_pipeline': {
      let pipelines: PipelineRef[];
      try { pipelines = await loadPipelines(supabase, orgId); }
      catch (e) {
        console.error(`[bulk-action] remove org=${orgId} pipelines read failed: ${(e as Error).message}`);
        return NextResponse.json({ success: false, affected: 0, error: 'Pipelines could not be read. Try again.' }, { status: 500 });
      }
      const pl = findPipeline(pipelines, typeof params?.pipeline_id === 'string' ? params.pipeline_id : null);
      if (!pl) return NextResponse.json({ success: false, affected: 0, error: 'Choose a pipeline.' }, { status: 400 });
      let failed = 0;
      for (const id of validIds) {
        try { if (await removeFromPipeline(supabase, id, pl.id, user.id, 'bulk')) affected++; }
        catch (e) { failed++; console.error(`[bulk-action] remove contact=${id} failed: ${(e as Error).message}`); }
      }
      if (failed) error = { message: `${failed} contact${failed === 1 ? '' : 's'} could not be removed. Try again.` };
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

        // INSERT, not UPSERT. The original upsert named onConflict 'org_id,phone'
        // against an index that does not exist, so it raised 42P10 on every call,
        // the error was discarded, and affected++ ran anyway. Append-only is also
        // the right shape: a suppression entry is a fact at a point in time, and an
        // audit row that can be overwritten is not an audit row.
        //
        // REQUIRES the schema fix in docs/HUB_403_INVESTIGATION.md (Finding 8b),
        // which must be applied FIRST:
        //   - added_by was FK'd to team_members(id), a 4-row CRM assignment roster.
        //     Only 3 of 7 Hub-authority operators have a row there, so the column
        //     could not record the majority of actors — it is repointed to
        //     auth.users(id), matching crm_messages.sent_by.
        //   - contact_id did not exist. The row identified the suppressed party by
        //     phone/email only, and 153 of 282 active contacts have NEITHER, so
        //     more than half of all suppression rows named nobody.
        //
        // The actor's email is ALSO written into reason as text. added_by is a
        // reference and can be nulled if that auth user is ever deleted; a
        // compliance record must not lose its actor when that happens.
        const actor = user.email || user.id;
        const { error: auditErr } = await supabase.from('do_not_contact_list').insert({
          org_id: c.org_id,
          contact_id: c.id,
          phone: c.phone,
          email: c.email,
          reason: `Bulk action by ${actor}`,
          added_by: user.id,
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

  return NextResponse.json({ success: true, affected, ...(campaignNote ? { campaign_note: campaignNote } : {}) });
}
