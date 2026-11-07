-- hub_229_pipeline_positions.sql
-- PROPOSED, NOT APPLIED. Production only (htfrfaxlcuyawtlztxxm), never npu-platform-nonprod. Touches no University table.
--
-- contact_pipeline_positions (primary key contact_id, pipeline_id) becomes the only source of truth for
-- pipeline membership and stage. A contact can be in many pipelines, and a move in one never touches another.
--
-- WHAT IT DOES, in order:
--   1. hub_pipeline_legacy_unmapped: a log of legacy column writes that name no live pipeline or stage.
--   2. Pipelines sync from org_settings for every org, not only orgs with the engine on, so a stage added in
--      the pipeline editor gets a pipeline_stages row and can hold a position. Every org is synced once now.
--   3. Backfill: one position for each unmerged contact whose contacts.pipeline_id / pipeline_stage name a
--      live pipeline and stage and who has no row for that pipeline. Exact match on the pipeline key and the
--      stage name; nothing is guessed. Values that do not map are left alone and listed by the query at the end.
--      A contact whose row already disagrees with the legacy columns keeps the row.
--   4. History and stage triggers move to the positions table: hub_positions_changed writes contact_timeline
--      (pipeline_added, stage_moved, pipeline_removed) naming the pipeline, and raises the 'stage:<stage_id>'
--      entry event. The stage part of hub_contacts_entry_events and trg_pipeline_timeline are removed, since
--      they read the legacy columns. The tag part of hub_contacts_entry_events is unchanged.
--   5. The legacy columns stop being written by the Hub (the code no longer writes them, and move_stage stops
--      mirroring). Other apps still write them: the University (Stripe checkout, webhook, onboarding,
--      auto-tagger, promo codes) and NeuroReport quiz sync. On Cameron's ruling those writes are TRANSLATED, not
--      blocked: hub_contacts_legacy_pipeline_write turns a write into a move in that pipeline only, keeps the
--      column value as written, and logs a value that does not map. It never fails the other app's write.
--      The columns are NOT dropped and keep their values; the Hub treats them as read-only until Cameron
--      confirms nothing reads them.
--   6. Hub RPCs for every Hub write: hub_pipeline_set_stage, hub_pipeline_remove, hub_pipeline_place.
--   7. hub_contact_facts returns a pipelines array in place of the single pipeline_id / pipeline_name /
--      pipeline_stage. brand is wnw when any of the contact's pipelines is a Waynesville pipeline.
--   8. Three views that read the legacy stage read positions instead (columns unchanged; one column added
--      at the end of contact_lifecycle_summary).
--   9. merge_contact_repoint: a loser's position (and deal) in a pipeline the winner is already in is dropped
--      before repointing, because the primary key would otherwise fail the merge. The winner keeps its stage.
--
-- WHAT IT DOES NOT DO: drop or clear any legacy column, change contacts.pipeline (the client track, ruled out of
-- scope), send anything, or change any campaign's live state.
--
-- ROLLBACK:
--   begin;
--   drop trigger hub_contacts_legacy_pipeline_write on public.contacts;
--   drop function public.hub_contacts_legacy_pipeline_write();
--   drop trigger hub_positions_changed on public.contact_pipeline_positions;
--   drop function public.hub_positions_changed();
--   drop function public.hub_pipeline_set_stage(uuid, uuid, uuid, text);
--   drop function public.hub_pipeline_remove(uuid, uuid, uuid, text);
--   drop function public.hub_pipeline_place(uuid, uuid, boolean, text);
--   create trigger trg_pipeline_timeline after update on public.contacts for each row execute function public.trigger_pipeline_timeline();
--   -- recreate hub_contacts_entry_events, move_stage, hub_org_settings_pipeline_sync, merge_contact_repoint,
--   -- hub_contact_facts and the three views from their definitions read on 2026-11-07 (kept in
--   -- scripts/marketing/hub_229_before.sql), then the grants as they were
--   delete from public.contact_pipeline_positions where source = 'legacy_backfill';
--   drop table public.hub_pipeline_legacy_unmapped;
--   delete from supabase_migrations.schema_migrations where name = 'hub_229_pipeline_positions';
--   commit;

begin;

-- 1 ─────────────────────────────────────────────────────────────────────────────────────────────────────
create table public.hub_pipeline_legacy_unmapped (
  id           bigserial primary key,
  org_id       uuid not null,
  contact_id   uuid not null,
  pipeline_key text,
  stage_name   text,
  reason       text not null check (reason in ('pipeline_unknown', 'pipeline_archived', 'stage_unknown', 'error')),
  detail       text,
  occurred_at  timestamptz not null default now()
);
create index hub_pipeline_legacy_unmapped_org on public.hub_pipeline_legacy_unmapped (org_id, occurred_at desc);
alter table public.hub_pipeline_legacy_unmapped enable row level security;
revoke all on public.hub_pipeline_legacy_unmapped from public, anon, authenticated;
grant all on public.hub_pipeline_legacy_unmapped to service_role;
grant usage on sequence public.hub_pipeline_legacy_unmapped_id_seq to service_role;

-- 2 ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.hub_org_settings_pipeline_sync()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  begin
    -- every org: positions need a pipeline_stages row for every stage the editor saves
    perform public.sync_pipelines_from_settings(new.org_id);
  exception when others then
    raise warning 'hub pipeline sync skipped: % %', sqlstate, sqlerrm;
  end;
  return null;
end $function$;

select public.sync_pipelines_from_settings(s.org_id) from public.org_settings s where s.setting_key = 'crm_pipelines';

-- 3 ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Before the position trigger exists, so the backfill writes no history and raises no entry event.
insert into public.contact_pipeline_positions (contact_id, org_id, pipeline_id, stage_id, moved_at, moved_by, source)
select c.id, c.org_id, p.id, st.id, coalesce(c.updated_at, now()), null, 'legacy_backfill'
  from public.contacts c
  join public.pipelines p on p.org_id = c.org_id and p.legacy_key = c.pipeline_id and p.archived_at is null
  join lateral (select s.id from public.pipeline_stages s
                 where s.pipeline_id = p.id and s.name = c.pipeline_stage and s.archived_at is null
                 order by s.position limit 1) st on true
 where c.merged_into_id is null
on conflict (contact_id, pipeline_id) do nothing;

-- 4 ─────────────────────────────────────────────────────────────────────────────────────────────────────
create function public.hub_positions_changed()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_pipe text; v_from text; v_to text; v_actor uuid; v_src text;
begin
  -- a merge drops or repoints rows; that is not a person moving anyone
  if coalesce(current_setting('app.hub_merging', true), '') = 'on' then return null; end if;
  if tg_op = 'UPDATE' and new.stage_id = old.stage_id and new.pipeline_id = old.pipeline_id then return null; end if;

  if tg_op = 'DELETE' then
    select p.name into v_pipe from public.pipelines p where p.id = old.pipeline_id;
    select s.name into v_from from public.pipeline_stages s where s.id = old.stage_id;
    v_actor := nullif(current_setting('app.hub_pipeline_actor', true), '')::uuid;
    v_src := coalesce(nullif(current_setting('app.hub_pipeline_source', true), ''), 'manual');
    insert into public.contact_timeline (org_id, contact_id, event_type, title, metadata, source_table, actor_type, actor_id)
    values (old.org_id, old.contact_id, 'pipeline_removed', 'Removed from ' || coalesce(v_pipe, 'a pipeline'),
            jsonb_build_object('pipeline_id', old.pipeline_id, 'pipeline_name', v_pipe, 'from_stage_id', old.stage_id,
                               'from_stage', v_from, 'source', v_src),
            'contact_pipeline_positions', case when v_actor is null then 'system' else 'user' end, v_actor);
    return null;
  end if;

  select p.name into v_pipe from public.pipelines p where p.id = new.pipeline_id;
  select s.name into v_to from public.pipeline_stages s where s.id = new.stage_id;
  if tg_op = 'UPDATE' then select s.name into v_from from public.pipeline_stages s where s.id = old.stage_id; end if;
  insert into public.contact_timeline (org_id, contact_id, event_type, title, metadata, source_table, actor_type, actor_id)
  values (new.org_id, new.contact_id,
          case when tg_op = 'INSERT' then 'pipeline_added' else 'stage_moved' end,
          case when tg_op = 'INSERT' then 'Added to ' || coalesce(v_pipe, 'a pipeline') || ' at ' || coalesce(v_to, 'a stage')
               else coalesce(v_pipe, 'Pipeline') || ': ' || coalesce(v_from, 'None') || ' → ' || coalesce(v_to, 'None') end,
          jsonb_build_object('pipeline_id', new.pipeline_id, 'pipeline_name', v_pipe,
                             'from_stage_id', case when tg_op = 'UPDATE' then old.stage_id end, 'from_stage', v_from,
                             'stage_id', new.stage_id, 'to_stage', v_to, 'source', new.source),
          'contact_pipeline_positions', case when new.moved_by is null then 'system' else 'user' end, new.moved_by);

  -- the engine's own moves and merges raise nothing, as the contacts trigger did before
  if coalesce(current_setting('app.suppress_enrollment_trigger', true), '') <> 'on'
     and coalesce(current_setting('app.hub_engine_write', true), '') <> 'on' then
    begin
      perform public.raise_entry_event(new.org_id, new.contact_id, 'stage:' || new.stage_id,
        'stage_change:' || new.contact_id || ':' || new.stage_id || ':' || txid_current(), 'stage');
    exception when others then
      raise warning 'hub stage entry event skipped: % %', sqlstate, sqlerrm;
    end;
  end if;
  return null;
end $function$;

create trigger hub_positions_changed
  after insert or update of stage_id, pipeline_id or delete on public.contact_pipeline_positions
  for each row execute function public.hub_positions_changed();

-- The stage part read contacts.pipeline_id / pipeline_stage; positions raise it now. The tag part is unchanged.
create or replace function public.hub_contacts_entry_events()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r record; t text;
begin
  -- a contact merge sets this guard (merge_union_tags); nested writes made by other
  -- triggers are not a person's action
  if coalesce(current_setting('app.suppress_enrollment_trigger', true), '') = 'on'
     or coalesce(current_setting('app.hub_engine_write', true), '') = 'on' or pg_trigger_depth() > 1 then
    return null;
  end if;
  if not exists (select 1 from public.campaign_routes cr where cr.active and cr.source_key like 'tag:%'
                   and public.hub_flag(cr.org_id, 'engine') = 'on') then
    return null;
  end if;
  begin
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

drop trigger trg_pipeline_timeline on public.contacts;

-- 5 ─────────────────────────────────────────────────────────────────────────────────────────────────────
create function public.hub_contacts_legacy_pipeline_write()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_pipe uuid; v_arch timestamptz; v_stage uuid;
begin
  if new.merged_into_id is not null or coalesce(current_setting('app.hub_merging', true), '') = 'on' then return null; end if;
  if tg_op = 'UPDATE' and new.pipeline_id is not distinct from old.pipeline_id
     and new.pipeline_stage is not distinct from old.pipeline_stage then return null; end if;
  -- clearing the columns removes nobody: removal is a Hub action on one pipeline
  if new.pipeline_id is null or new.pipeline_stage is null then return null; end if;
  begin
    select p.id, p.archived_at into v_pipe, v_arch from public.pipelines p
     where p.org_id = new.org_id and p.legacy_key = new.pipeline_id;
    if v_pipe is null or v_arch is not null then
      insert into public.hub_pipeline_legacy_unmapped (org_id, contact_id, pipeline_key, stage_name, reason)
      values (new.org_id, new.id, new.pipeline_id, new.pipeline_stage,
              case when v_pipe is null then 'pipeline_unknown' else 'pipeline_archived' end);
      return null;
    end if;
    select s.id into v_stage from public.pipeline_stages s
     where s.pipeline_id = v_pipe and s.name = new.pipeline_stage and s.archived_at is null order by s.position limit 1;
    if v_stage is null then
      insert into public.hub_pipeline_legacy_unmapped (org_id, contact_id, pipeline_key, stage_name, reason)
      values (new.org_id, new.id, new.pipeline_id, new.pipeline_stage, 'stage_unknown');
      return null;
    end if;
    insert into public.contact_pipeline_positions (contact_id, org_id, pipeline_id, stage_id, moved_at, moved_by, source)
    values (new.id, new.org_id, v_pipe, v_stage, now(), null, 'legacy_write')
    on conflict (contact_id, pipeline_id) do update
      set stage_id = excluded.stage_id, moved_at = excluded.moved_at, moved_by = null, source = excluded.source
      where public.contact_pipeline_positions.stage_id <> excluded.stage_id;
  exception when others then
    -- never fail the other app's write
    begin
      insert into public.hub_pipeline_legacy_unmapped (org_id, contact_id, pipeline_key, stage_name, reason, detail)
      values (new.org_id, new.id, new.pipeline_id, new.pipeline_stage, 'error', sqlstate);
    exception when others then null;
    end;
  end;
  return null;
end $function$;

create trigger hub_contacts_legacy_pipeline_write
  after insert or update of pipeline_id, pipeline_stage on public.contacts
  for each row execute function public.hub_contacts_legacy_pipeline_write();

-- move_stage no longer mirrors to the legacy columns, and the position trigger writes the history row.
create or replace function public.move_stage(p_contact uuid, p_stage uuid, p_actor uuid default null::uuid, p_source text default 'manual'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_id uuid; v_org uuid; st record; n_goal int;
begin
  v_id := public.hub_resolve_contact(p_contact);
  select c.org_id into v_org from public.contacts c where c.id = v_id;
  if public.hub_flag(v_org, 'engine') <> 'on' then
    return jsonb_build_object('moved', false, 'reason', 'engine_off');
  end if;
  select s.id, s.org_id, s.pipeline_id, s.name into st
    from public.pipeline_stages s where s.id = p_stage;
  if not found then raise exception 'hub: stage % not found', p_stage using errcode = 'P0002'; end if;
  if st.org_id <> v_org then raise exception 'hub: stage and contact belong to different orgs' using errcode = '42501'; end if;

  insert into public.contact_pipeline_positions (contact_id, org_id, pipeline_id, stage_id, moved_at, moved_by, source)
  values (v_id, v_org, st.pipeline_id, st.id, now(), p_actor, p_source)
  on conflict (contact_id, pipeline_id) do update
    set stage_id = excluded.stage_id, moved_at = excluded.moved_at, moved_by = excluded.moved_by, source = excluded.source;

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
  return jsonb_build_object('moved', true, 'contact_id', v_id, 'stage_id', st.id, 'goals_met', n_goal);
end $function$;

-- 6 ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Set the contact's stage in that stage's pipeline. Adds the contact to the pipeline if needed. Other pipelines
-- are untouched. Not gated on the engine flag: this is the board, the contact card and every Hub route.
create function public.hub_pipeline_set_stage(p_contact uuid, p_stage uuid, p_actor uuid default null, p_source text default 'manual')
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_id uuid; v_org uuid; st record;
begin
  v_id := public.hub_resolve_contact(p_contact);
  select c.org_id into v_org from public.contacts c where c.id = v_id;
  if v_org is null then raise exception 'hub: contact % not found', p_contact using errcode = 'P0002'; end if;
  select s.id, s.org_id, s.pipeline_id into st from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
   where s.id = p_stage and s.archived_at is null and p.archived_at is null;
  if not found then raise exception 'hub: stage % not found or archived', p_stage using errcode = 'P0002'; end if;
  if st.org_id <> v_org then raise exception 'hub: stage and contact belong to different orgs' using errcode = '42501'; end if;
  insert into public.contact_pipeline_positions (contact_id, org_id, pipeline_id, stage_id, moved_at, moved_by, source)
  values (v_id, v_org, st.pipeline_id, st.id, now(), p_actor, coalesce(nullif(btrim(p_source), ''), 'manual'))
  on conflict (contact_id, pipeline_id) do update
    set stage_id = excluded.stage_id, moved_at = excluded.moved_at, moved_by = excluded.moved_by, source = excluded.source
    where public.contact_pipeline_positions.stage_id <> excluded.stage_id;
  return jsonb_build_object('contact_id', v_id, 'pipeline_id', st.pipeline_id, 'stage_id', st.id);
end $function$;

-- Remove the contact from one pipeline. Other pipelines are untouched.
create function public.hub_pipeline_remove(p_contact uuid, p_pipeline uuid, p_actor uuid default null, p_source text default 'manual')
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_id uuid; n int;
begin
  v_id := public.hub_resolve_contact(p_contact);
  perform set_config('app.hub_pipeline_actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.hub_pipeline_source', coalesce(nullif(btrim(p_source), ''), 'manual'), true);
  delete from public.contact_pipeline_positions x where x.contact_id = v_id and x.pipeline_id = p_pipeline;
  get diagnostics n = row_count;
  perform set_config('app.hub_pipeline_actor', '', true);
  perform set_config('app.hub_pipeline_source', '', true);
  return n > 0;
end $function$;

-- A route's placement (booking, quiz, form, lead device). Adds the contact to the stage's pipeline if they are not
-- in it. If they are and p_only_forward is true, they move only when their current stage comes earlier.
-- Other pipelines are untouched.
create function public.hub_pipeline_place(p_contact uuid, p_stage uuid, p_only_forward boolean default true, p_source text default 'route')
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_id uuid; v_org uuid; st record; v_cur uuid; v_cur_pos int;
begin
  v_id := public.hub_resolve_contact(p_contact);
  select c.org_id into v_org from public.contacts c where c.id = v_id;
  if v_org is null then raise exception 'hub: contact % not found', p_contact using errcode = 'P0002'; end if;
  select s.id, s.org_id, s.pipeline_id, s.position into st from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
   where s.id = p_stage and s.archived_at is null and p.archived_at is null;
  if not found then return jsonb_build_object('placed', false, 'reason', 'stage_unknown'); end if;
  if st.org_id <> v_org then raise exception 'hub: stage and contact belong to different orgs' using errcode = '42501'; end if;
  select x.stage_id, s.position into v_cur, v_cur_pos from public.contact_pipeline_positions x
    join public.pipeline_stages s on s.id = x.stage_id
   where x.contact_id = v_id and x.pipeline_id = st.pipeline_id;
  if v_cur is not null then
    if v_cur = st.id then return jsonb_build_object('placed', false, 'reason', 'already_there'); end if;
    if p_only_forward and v_cur_pos >= st.position then return jsonb_build_object('placed', false, 'reason', 'already_further'); end if;
  end if;
  insert into public.contact_pipeline_positions (contact_id, org_id, pipeline_id, stage_id, moved_at, moved_by, source)
  values (v_id, v_org, st.pipeline_id, st.id, now(), null, coalesce(nullif(btrim(p_source), ''), 'route'))
  on conflict (contact_id, pipeline_id) do update
    set stage_id = excluded.stage_id, moved_at = excluded.moved_at, moved_by = null, source = excluded.source;
  return jsonb_build_object('placed', true, 'pipeline_id', st.pipeline_id, 'stage_id', st.id, 'moved', v_cur is not null);
end $function$;

revoke all on function public.hub_pipeline_set_stage(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.hub_pipeline_remove(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.hub_pipeline_place(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.hub_positions_changed() from public, anon, authenticated;
revoke all on function public.hub_contacts_legacy_pipeline_write() from public, anon, authenticated;
grant execute on function public.hub_pipeline_set_stage(uuid, uuid, uuid, text) to service_role;
grant execute on function public.hub_pipeline_remove(uuid, uuid, uuid, text) to service_role;
grant execute on function public.hub_pipeline_place(uuid, uuid, boolean, text) to service_role;

-- 7 ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- The return type changes, so the function is dropped and recreated. The body is the live definition read on
-- 2026-11-07 with the legacy join replaced by the positions.
drop function public.hub_contact_facts(uuid);

create function public.hub_contact_facts(p_org uuid)
 returns table(contact_id uuid, first_name text, last_name text, email text, phone text, tags text[], source text,
               contact_type text, partnership_type text, pipelines jsonb,
               brand text, created_at timestamp with time zone, last_activity_at timestamp with time zone,
               last_open_at timestamp with time zone, last_click_at timestamp with time zone,
               booked_at timestamp with time zone, booking_types text[], client_reasons text[],
               email_allowed boolean, texting_allowed boolean, purchases jsonb,
               lead_devices text[], quiz_archetypes text[])
 language sql
 stable security definer
 set search_path to ''
as $function$
  select c.id, c.first_name, c.last_name, c.email, c.phone,
         coalesce(c.tags, '{}') || coalesce(c.auto_tags, '{}'), c.source, c.contact_type, c.partnership_type,
         coalesce(pp.items, '[]'::jsonb),
         case when coalesce(pp.wnw, false) then 'wnw' else 'np' end,
         c.created_at,
         greatest(c.last_contacted_at, c.last_call_at, c.last_text_at, c.last_email_at, m.last_open, m.last_click, b.booked),
         m.last_open, m.last_click, b.booked, coalesce(b.types, '{}'),
         public.hub_current_client_reasons(c.id), public.hub_email_marketing_allowed(c.id),
         (public.hub_texting_allowed(c.id) ->> 'allowed')::boolean, coalesce(p.items, '[]'::jsonb),
         coalesce(ld.slugs, '{}'), coalesce(qa.archetypes, '{}')
    from public.contacts c
    left join lateral (
      select jsonb_agg(jsonb_build_object('pipeline_id', pl.id, 'pipeline_key', pl.legacy_key, 'pipeline_name', pl.name,
                                          'stage_id', s.id, 'stage', s.name) order by pl.position) as items,
             bool_or(pl.name ~* 'waynesville') as wnw
        from public.contact_pipeline_positions x
        join public.pipelines pl on pl.id = x.pipeline_id and pl.archived_at is null
        join public.pipeline_stages s on s.id = x.stage_id
       where x.contact_id = c.id) pp on true
    left join lateral (
      select max(ms.opened_at) as last_open, max(ms.clicked_at) as last_click from public.message_sends ms
       where ms.contact_id in (select public.hub_contact_family(c.id))) m on true
    left join lateral (
      select max(s.starts_at) as booked, array_agg(distinct s.appointment_type) filter (where s.appointment_type is not null) as types
        from public.hub_booking_syncs s where s.contact_id in (select public.hub_contact_family(c.id))) b on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('key', i.key, 'name', i.name, 'at', i.at)) as items from (
        select t.keyword as key, t.keyword as name, t.granted_at as at
          from public.entitlements t join public.profiles pr on pr.id = t.user_id
         where pr.id = c.mastermind_user_id or lower(btrim(pr.email)) = lower(btrim(c.email))
        union all
        select 'program:' || e.program_id, g.name, e.enrolled_at
          from public.enrollments e join public.profiles pr on pr.id = e.user_id
          join public.programs g on g.id = e.program_id
         where e.status not in ('cancelled','refunded')
           and (pr.id = c.mastermind_user_id or lower(btrim(pr.email)) = lower(btrim(c.email)))) i) p on true
    left join lateral (
      select array_agg(distinct d.slug) as slugs
        from public.lead_device_submissions s join public.lead_devices d on d.id = s.device_id
       where s.contact_id = c.id and s.status = 'accepted' and not s.is_test) ld on true
    left join lateral (
      select array_agg(distinct v.value) as archetypes
        from public.lead_device_submissions s join public.lead_devices d on d.id = s.device_id
        cross join lateral unnest(array[s.outcome, s.outcome_label]) as v(value)
       where s.contact_id = c.id and s.status = 'accepted' and not s.is_test
         and d.type = 'quiz' and v.value is not null) qa on true
   where c.org_id = p_org and c.merged_into_id is null and c.archived_at is null
     and not coalesce(c.tags, '{}') @> array['quarantine:test-record']
$function$;

revoke all on function public.hub_contact_facts(uuid) from public, anon, authenticated;
grant execute on function public.hub_contact_facts(uuid) to service_role;

-- 8 ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace view public.attribution_effectiveness as
 select c.org_id,
    coalesce(c.source, 'unknown'::text) as source,
    count(*) as total_contacts,
    count(*) filter (where cv.converted) as converted,
    round((((count(*) filter (where cv.converted))::numeric / (nullif(count(*), 0))::numeric) * (100)::numeric), 1) as conversion_rate
   from public.contacts c
   left join lateral (select exists (select 1 from public.contact_pipeline_positions x join public.pipeline_stages s on s.id = x.stage_id
                                     where x.contact_id = c.id and s.name = any (array['Qualified'::text, 'Proposal Sent'::text, 'Won'::text])) as converted) cv on true
  where c.merged_into_id is null
  group by c.org_id, coalesce(c.source, 'unknown'::text);

-- One row per org, pipeline and stage. A contact in two pipelines counts once in each; one in none counts under a
-- null stage. pipeline_id is new, at the end.
create or replace view public.contact_lifecycle_summary as
 select c.org_id,
    s.name as pipeline_stage,
    count(*) as count,
    count(*) filter (where c.created_at > (now() - '7 days'::interval)) as new_this_week,
    count(*) filter (where c.created_at > (now() - '30 days'::interval)) as new_this_month,
    (avg((extract(epoch from (now() - c.created_at)) / (86400)::numeric)))::integer as avg_age_days,
    x.pipeline_id
   from public.contacts c
   left join public.contact_pipeline_positions x on x.contact_id = c.id
   left join public.pipeline_stages s on s.id = x.stage_id
  where c.merged_into_id is null
  group by c.org_id, x.pipeline_id, s.name;

create or replace view public.ecr_records as
 select c.id as contact_id,
    c.first_name,
    c.last_name,
    c.email,
    c.tags,
    'Enrolled'::text as pipeline_stage,
    c.org_id,
    p.id as profile_id,
    p.role as university_role,
    pay.total_paid_cents,
    pay.payment_count,
    pay.last_payment_date,
    pay.first_payment_date,
        case
            when ('Mastermind'::text = any (c.tags)) then 'Immersive Mastermind'::text
            when ('HC'::text = any (c.tags)) then 'Health Consumer'::text
            when ('Clinician/Coach'::text = any (c.tags)) then 'Coach Platform'::text
            else 'Unknown'::text
        end as program_type,
        case
            when (pay.total_paid_cents > 0) then 'active'::text
            else 'pending'::text
        end as ecr_status,
    (p.id is not null) as has_neuroreport_link
   from ((public.contacts c
     left join public.profiles p on ((lower(c.email) = lower(p.email))))
     left join lateral ( select sum(payments.amount_cents) as total_paid_cents,
            count(*) as payment_count,
            max(payments.paid_at) as last_payment_date,
            min(payments.paid_at) as first_payment_date
           from public.payments
          where ((payments.participant_id = p.id) and (payments.status = 'completed'::text))) pay on (true))
  where exists (select 1 from public.contact_pipeline_positions x join public.pipeline_stages s on s.id = x.stage_id
                 where x.contact_id = c.id and s.name = 'Enrolled'::text);

-- 9 ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.merge_contact_repoint(p_loser uuid, p_winner uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r        record;
  n        bigint;
  counts   jsonb := '{}'::jsonb;
  total    bigint := 0;
begin
  if p_loser is null or p_winner is null then
    raise exception 'merge_contact_repoint: both contact ids are required';
  end if;
  if p_loser = p_winner then
    raise exception 'merge_contact_repoint: loser and winner must differ';
  end if;

  delete from contact_interaction_score where contact_id = p_loser;
  get diagnostics n = row_count;
  if n > 0 then
    counts := counts || jsonb_build_object('contact_interaction_score.deleted', n);
    total := total + n;
  end if;

  -- One row per contact and pipeline: where both are in a pipeline the winner keeps its stage (and deal),
  -- otherwise the repoint below breaks the primary key and the merge fails.
  perform set_config('app.hub_merging', 'on', true);
  delete from contact_pipeline_positions l
   where l.contact_id = p_loser
     and exists (select 1 from contact_pipeline_positions w where w.contact_id = p_winner and w.pipeline_id = l.pipeline_id);
  get diagnostics n = row_count;
  if n > 0 then
    counts := counts || jsonb_build_object('contact_pipeline_positions.deleted', n);
    total := total + n;
  end if;
  delete from hub_pipeline_deals l
   where l.contact_id = p_loser
     and exists (select 1 from hub_pipeline_deals w where w.contact_id = p_winner and w.pipeline_key = l.pipeline_key);
  get diagnostics n = row_count;
  if n > 0 then
    counts := counts || jsonb_build_object('hub_pipeline_deals.deleted', n);
    total := total + n;
  end if;

  for r in
    select c.table_name, c.column_name, c.data_type
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema
       and t.table_name  = c.table_name
       and t.table_type  = 'BASE TABLE'
     where c.table_schema = 'public'
       and (c.column_name like '%contact_id%'
            or (c.table_name = 'equipment' and c.column_name = 'assigned_to'))
       and c.table_name <> 'contact_interaction_score'
       and c.table_name <> 'contact_merge_log'
     order by c.table_name, c.column_name
  loop
    if r.data_type = 'uuid' then
      execute format('update public.%I set %I = $1 where %I = $2',
                     r.table_name, r.column_name, r.column_name)
        using p_winner, p_loser;
    else
      execute format('update public.%I set %I = $1::text where %I = $2::text',
                     r.table_name, r.column_name, r.column_name)
        using p_winner, p_loser;
    end if;
    get diagnostics n = row_count;
    if n > 0 then
      counts := counts || jsonb_build_object(r.table_name || '.' || r.column_name, n);
      total := total + n;
    end if;
  end loop;
  perform set_config('app.hub_merging', '', true);

  update contacts set merged_into_id = p_winner where merged_into_id = p_loser;
  get diagnostics n = row_count;
  if n > 0 then
    counts := counts || jsonb_build_object('contacts.merged_into_id', n);
    total := total + n;
  end if;

  return jsonb_build_object('repointed', counts, 'total', total);
end;
$function$;

commit;

-- AFTER APPLY: counts and the legacy values that do not map (read-only)
-- select
--   (select count(*) from public.contact_pipeline_positions where source = 'legacy_backfill') as backfilled,
--   (select count(*) from public.contact_pipeline_positions) as position_rows,
--   (select count(*) from (select contact_id from public.contact_pipeline_positions group by 1 having count(*) > 1) z) as in_two_or_more;
-- select c.id, c.pipeline_id, c.pipeline_stage, (c.merged_into_id is not null) as merged,
--        case when p.id is null then 'pipeline_unknown' when p.archived_at is not null then 'pipeline_archived' else 'stage_unknown' end as reason
--   from public.contacts c left join public.pipelines p on p.org_id = c.org_id and p.legacy_key = c.pipeline_id
--  where c.pipeline_id is not null and c.pipeline_stage is not null
--    and not exists (select 1 from public.pipeline_stages s where s.pipeline_id = p.id and s.name = c.pipeline_stage and s.archived_at is null and p.archived_at is null);
