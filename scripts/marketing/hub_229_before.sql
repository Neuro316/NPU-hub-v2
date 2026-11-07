-- scripts/marketing/hub_229_before.sql
-- The live definitions that hub_229_pipeline_positions.sql replaces, read from production on 2026-11-07.
-- For its rollback only. hub_contact_facts before hub_229 is the definition in
-- supabase/migrations/hub_228_lead_devices.sql (drop the hub_229 version first, since the return type differs).

CREATE OR REPLACE FUNCTION public.move_stage(p_contact uuid, p_stage uuid, p_actor uuid DEFAULT NULL::uuid, p_source text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_org uuid; st record; n_goal int;
begin
  v_id := public.hub_resolve_contact(p_contact);
  select c.org_id into v_org from public.contacts c where c.id = v_id;
  if public.hub_flag(v_org, 'engine') <> 'on' then
    return jsonb_build_object('moved', false, 'reason', 'engine_off');
  end if;
  select s.id, s.org_id, s.pipeline_id, s.name, p.legacy_key as pipeline_key into st
    from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where s.id = p_stage;
  if not found then raise exception 'hub: stage % not found', p_stage using errcode = 'P0002'; end if;
  if st.org_id <> v_org then raise exception 'hub: stage and contact belong to different orgs' using errcode = '42501'; end if;

  insert into public.contact_pipeline_positions (contact_id, org_id, pipeline_id, stage_id, moved_at, moved_by, source)
  values (v_id, v_org, st.pipeline_id, st.id, now(), p_actor, p_source)
  on conflict (contact_id, pipeline_id) do update
    set stage_id = excluded.stage_id, moved_at = excluded.moved_at, moved_by = excluded.moved_by, source = excluded.source;

  -- the existing board reads these text columns; they move only once Cameron switches it over
  if public.hub_flag(v_org, 'mirror_legacy_stage') = 'on' then
    update public.contacts x set pipeline_id = st.pipeline_key, pipeline_stage = st.name, updated_at = now() where x.id = v_id;
  end if;

  -- reaching a campaign's goal stage ends that enrollment and its drip
  with done as (
    update public.campaign_enrollments ce set status = 'goal_met', ended_at = now(), end_reason = 'goal_stage_reached'
      from public.funnel_campaigns f
     where f.id = ce.campaign_id and f.goal_stage_id = st.id and ce.contact_id = v_id and ce.status = 'active'
     returning ce.sequence_enrollment_id)
  , halted as (
    update public.sequence_enrollments se set status = 'completed', completed_at = now(), next_step_at = null
     where se.id in (select d.sequence_enrollment_id from done d) and se.status = 'active' returning se.id)
  select count(*) into n_goal from done;

  insert into public.contact_timeline (org_id, contact_id, event_type, title, metadata, source_table, actor_type, actor_id)
  values (v_org, v_id, 'stage_moved', 'Moved to ' || st.name,
          jsonb_build_object('stage_id', st.id, 'pipeline_id', st.pipeline_id, 'source', p_source, 'goals_met', n_goal),
          'contact_pipeline_positions', case when p_actor is null then 'system' else 'user' end, p_actor);
  return jsonb_build_object('moved', true, 'contact_id', v_id, 'stage_id', st.id, 'goals_met', n_goal);
end $function$;

CREATE OR REPLACE FUNCTION public.hub_contacts_entry_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; t text;
begin
  -- a contact merge sets this guard (merge_union_tags); nested writes made by other
  -- triggers are not a person's action
  if coalesce(current_setting('app.suppress_enrollment_trigger', true), '') = 'on'
     or coalesce(current_setting('app.hub_engine_write', true), '') = 'on' or pg_trigger_depth() > 1 then
    return null;
  end if;
  -- cheap exit, one query per statement: unless some org with the engine ON has an active
  -- stage or tag route, there is nothing to raise (measured on the branch: about 1 ms per
  -- 400-row update with the engine off or nobody listening)
  if not exists (select 1 from public.campaign_routes cr where cr.active and (cr.source_key like 'stage:%' or cr.source_key like 'tag:%')
                   and public.hub_flag(cr.org_id, 'engine') = 'on') then
    return null;
  end if;
  begin
    for r in
      with changed as (
        select n.id, n.org_id, n.pipeline_id, n.pipeline_stage,
               (n.pipeline_id, n.pipeline_stage) is distinct from (o.pipeline_id, o.pipeline_stage) as stage_changed
          from new_rows n join old_rows o on o.id = n.id
         where n.merged_into_id is null and o.merged_into_id is not distinct from n.merged_into_id
           and ((n.pipeline_id, n.pipeline_stage) is distinct from (o.pipeline_id, o.pipeline_stage) or n.tags is distinct from o.tags))
      select c.id, c.org_id, s.id as stage_id
        from changed c
        join public.pipelines p on p.org_id = c.org_id and p.legacy_key = c.pipeline_id and p.archived_at is null
        join public.pipeline_stages s on s.pipeline_id = p.id and s.name = c.pipeline_stage and s.archived_at is null
       where c.stage_changed and public.hub_flag(c.org_id, 'engine') = 'on'
    loop
      perform public.raise_entry_event(r.org_id, r.id, 'stage:' || r.stage_id,
        'stage_change:' || r.id || ':' || r.stage_id || ':' || txid_current(), 'stage');
    end loop;
    for r in
      select n.id, n.org_id, x.tag
        from new_rows n
        join old_rows o on o.id = n.id and n.tags is distinct from o.tags
        cross join lateral (select unnest(coalesce(n.tags, '{}'::text[])) except select unnest(coalesce(o.tags, '{}'::text[]))) as x(tag)
       where n.merged_into_id is null and o.merged_into_id is not distinct from n.merged_into_id
         and public.hub_flag(n.org_id, 'engine') = 'on'
    loop
      t := public.hub_slug(r.tag);
      if t <> '' then
        perform public.raise_entry_event(r.org_id, r.id, 'tag:' || t, 'tag_added:' || r.id || ':' || t || ':' || txid_current(), 'tag');
      end if;
    end loop;
  exception when others then
    raise warning 'hub entry events skipped for a contacts update: % %', sqlstate, sqlerrm;
  end;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.hub_org_settings_pipeline_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  begin
    if public.hub_flag(new.org_id, 'engine') = 'on' then
      perform public.sync_pipelines_from_settings(new.org_id);
    end if;
  exception when others then
    raise warning 'hub pipeline sync skipped: % %', sqlstate, sqlerrm;
  end;
  return null;
end $function$;

-- merge_contact_repoint: the hub_229 version minus its block between "One row per contact and pipeline" and the
-- loop, and minus the two set_config('app.hub_merging', ...) calls. Its definition before hub_229 is
-- supabase/migrations/073_merge_contact_repoint_fn.sql.

create or replace view public.attribution_effectiveness as SELECT org_id,
    COALESCE(source, 'unknown'::text) AS source,
    count(*) AS total_contacts,
    count(*) FILTER (WHERE (pipeline_stage = ANY (ARRAY['Qualified'::text, 'Proposal Sent'::text, 'Won'::text]))) AS converted,
    round((((count(*) FILTER (WHERE (pipeline_stage = ANY (ARRAY['Qualified'::text, 'Proposal Sent'::text, 'Won'::text]))))::numeric / (NULLIF(count(*), 0))::numeric) * (100)::numeric), 1) AS conversion_rate
   FROM contacts c
  WHERE (merged_into_id IS NULL)
  GROUP BY org_id, COALESCE(source, 'unknown'::text);

drop view public.contact_lifecycle_summary;
create view public.contact_lifecycle_summary as SELECT org_id,
    pipeline_stage,
    count(*) AS count,
    count(*) FILTER (WHERE (created_at > (now() - '7 days'::interval))) AS new_this_week,
    count(*) FILTER (WHERE (created_at > (now() - '30 days'::interval))) AS new_this_month,
    (avg((EXTRACT(epoch FROM (now() - created_at)) / (86400)::numeric)))::integer AS avg_age_days
   FROM contacts c
  WHERE (merged_into_id IS NULL)
  GROUP BY org_id, pipeline_stage;

create or replace view public.ecr_records as SELECT c.id AS contact_id,
    c.first_name,
    c.last_name,
    c.email,
    c.tags,
    c.pipeline_stage,
    c.org_id,
    p.id AS profile_id,
    p.role AS university_role,
    pay.total_paid_cents,
    pay.payment_count,
    pay.last_payment_date,
    pay.first_payment_date,
        CASE
            WHEN ('Mastermind'::text = ANY (c.tags)) THEN 'Immersive Mastermind'::text
            WHEN ('HC'::text = ANY (c.tags)) THEN 'Health Consumer'::text
            WHEN ('Clinician/Coach'::text = ANY (c.tags)) THEN 'Coach Platform'::text
            ELSE 'Unknown'::text
        END AS program_type,
        CASE
            WHEN (pay.total_paid_cents > 0) THEN 'active'::text
            ELSE 'pending'::text
        END AS ecr_status,
    (p.id IS NOT NULL) AS has_neuroreport_link
   FROM ((contacts c
     LEFT JOIN profiles p ON ((lower(c.email) = lower(p.email))))
     LEFT JOIN LATERAL ( SELECT sum(payments.amount_cents) AS total_paid_cents,
            count(*) AS payment_count,
            max(payments.paid_at) AS last_payment_date,
            min(payments.paid_at) AS first_payment_date
           FROM payments
          WHERE ((payments.participant_id = p.id) AND (payments.status = 'completed'::text))) pay ON (true))
  WHERE (c.pipeline_stage = 'Enrolled'::text);
