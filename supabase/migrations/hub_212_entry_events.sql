-- hub_212_entry_events.sql
--
-- Entry events for funnel campaigns: stage changes, tags added, calls answered or
-- missed, and imports a person chose to enroll. Plan: docs/plans/hub-marketing-build-rulings.md
-- section 13.
--
-- STATUS: PROPOSED 2026-10-01. Not applied to the live project until Cameron gives an
-- explicit go. Tested on a Supabase branch with scripts/marketing/contract-212.sql.
--
-- HOW IT WORKS. Nothing here enrolls anyone directly. Every source only QUEUES an event
-- in entry_events, through public.raise_entry_event, which does nothing unless the org's
-- `engine` flag is on AND an active campaign route listens for that source key. The cron
-- /api/cron/entry-events then calls public.process_entry_events, which feeds each event
-- to the existing public.route_and_enroll (so the existing enroll function and routing
-- rules decide everything), a capped number per run, with one summary row in job_runs.
-- Events never create or change consent.
--
-- WHY TRIGGERS. Stages and tags are written by at least nine paths, several of them in the
-- browser and some in the University platform, so the only way to see every change is on
-- the table. The triggers are STATEMENT level, so a bulk update of thousands of rows is one
-- set-based pass, and each is wrapped so that any failure is a warning and never blocks
-- the write it observes: contacts is shared with the platform.
--
-- ADDITIVE ONLY. New tables, new functions, three new triggers. No existing column, table,
-- trigger or function is altered. The existing trg_contact_tag_change is untouched; its
-- merge guard (app.suppress_enrollment_trigger) is honoured here too.
--
-- ============================================================================
-- ROLLBACK (written first). Run as one transaction.
-- ============================================================================
-- begin;
-- drop trigger if exists hub_contacts_entry_events on public.contacts;
-- drop trigger if exists hub_contact_tags_entry_events on public.contact_tags;
-- drop trigger if exists hub_org_settings_pipeline_sync on public.org_settings;
-- drop function if exists public.hub_contacts_entry_events();
-- drop function if exists public.hub_contact_tags_entry_events();
-- drop function if exists public.hub_org_settings_pipeline_sync();
-- drop function if exists public.process_entry_events(integer);
-- drop function if exists public.guard_entry_events(uuid, uuid[], text, integer);
-- drop function if exists public.raise_entry_event(uuid, uuid, text, text, text);
-- drop function if exists public.entry_source_status();
-- drop function if exists public.hub_slug(text);
-- drop table if exists public.entry_event_guards, public.entry_events;
-- delete from supabase_migrations.schema_migrations where name = 'hub_212_entry_events';
-- commit;
-- ============================================================================

-- the same rule as slugPart() in src/lib/marketing/ui-logic.ts
create function public.hub_slug(p text) returns text
language sql immutable set search_path = '' as $$
  select left(trim(both '-' from regexp_replace(lower(trim(coalesce(p, ''))), '[^a-z0-9]+', '-', 'g')), 60)
$$;

create table public.entry_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  contact_id   uuid references public.contacts(id) on delete set null,
  source_key   text not null check (source_key ~ '^[a-z0-9][a-z0-9_.:-]{0,79}$'),
  event_id     text not null check (length(event_id) between 1 and 200),
  origin       text not null check (origin in ('stage','tag','contact_tag','call','import')),
  status       text not null default 'pending' check (status in ('pending','enrolled','skipped','failed')),
  result       jsonb,
  created_at   timestamptz not null default now(),
  processed_at timestamptz,
  unique (org_id, source_key, event_id)
);
create index entry_events_pending on public.entry_events (created_at) where status = 'pending';

-- A merge or an import that updates existing contacts registers a short window here
-- first; events raised for those contacts inside it are skipped, never enrolled.
create table public.entry_event_guards (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  reason     text not null check (reason in ('contact_merge','import_merge')),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index entry_event_guards_contact on public.entry_event_guards (contact_id, ends_at);

alter table public.entry_events enable row level security;
alter table public.entry_event_guards enable row level security;
revoke all on public.entry_events from anon, authenticated;
revoke all on public.entry_event_guards from anon, authenticated;
grant select on public.entry_events to authenticated;
create policy entry_events_staff_read on public.entry_events for select to authenticated
  using (org_id in (select public.hub_team_org_ids()));
grant select, insert, update, delete on public.entry_events to service_role;
grant select, insert, update, delete on public.entry_event_guards to service_role;

-- ─── raise: the one way an event is queued ────────────────────────────────────
create function public.raise_entry_event(p_org uuid, p_contact uuid, p_source_key text, p_event_id text, p_origin text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_org is null or p_contact is null or coalesce(p_source_key, '') = '' or coalesce(p_event_id, '') = '' then return false; end if;
  if public.hub_flag(p_org, 'engine') <> 'on' then return false; end if;
  if p_source_key !~ '^[a-z0-9][a-z0-9_.:-]{0,79}$' then return false; end if;
  -- only events some active campaign listens for are queued
  if not exists (select 1 from public.campaign_routes r where r.org_id = p_org and r.source_key = p_source_key and r.active) then
    return false;
  end if;
  insert into public.entry_events (org_id, contact_id, source_key, event_id, origin)
  values (p_org, p_contact, p_source_key, left(p_event_id, 200), p_origin)
  on conflict (org_id, source_key, event_id) do nothing
  returning id into v_id;
  return v_id is not null;
end $$;

create function public.guard_entry_events(p_org uuid, p_contacts uuid[], p_reason text, p_minutes integer default 30)
returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_reason not in ('contact_merge','import_merge') then raise exception 'hub: bad guard reason %', p_reason; end if;
  insert into public.entry_event_guards (org_id, contact_id, reason, ends_at)
  select p_org, c.id, p_reason, now() + make_interval(mins => greatest(1, least(coalesce(p_minutes, 30), 240)))
    from public.contacts c where c.id = any(p_contacts) and c.org_id = p_org;
  get diagnostics n = row_count;
  return n;
end $$;

-- ─── process: a capped batch through the existing route_and_enroll ─────────────
create function public.process_entry_events(p_limit integer default 100)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e record; res jsonb; g text;
  n int := 0; n_enrolled int := 0; n_skipped int := 0; n_failed int := 0;
begin
  for e in select * from public.entry_events where status = 'pending'
            order by created_at limit greatest(1, least(coalesce(p_limit, 100), 500)) for update skip locked loop
    n := n + 1;
    if e.contact_id is null then
      update public.entry_events set status = 'skipped', result = '{"reason":"contact_deleted"}', processed_at = now() where id = e.id;
      n_skipped := n_skipped + 1; continue;
    end if;
    select x.reason into g from public.entry_event_guards x
     where x.contact_id = e.contact_id and e.created_at between x.starts_at and x.ends_at limit 1;
    if found then
      update public.entry_events set status = 'skipped', result = jsonb_build_object('reason', g), processed_at = now() where id = e.id;
      n_skipped := n_skipped + 1; continue;
    end if;
    begin
      -- stage moves the engine makes while enrolling (a campaign's entry stage) are not a
      -- person's action and must not raise new entry events. Switched on for this call
      -- only: a transaction-local setting would otherwise silence every later stage change
      -- in the same transaction. An error rolls the setting back with the subtransaction.
      perform set_config('app.hub_engine_write', 'on', true);
      res := public.route_and_enroll(e.org_id, e.contact_id, e.source_key, e.event_id);
      perform set_config('app.hub_engine_write', '', true);
      if exists (select 1 from jsonb_array_elements(res) x where coalesce((x ->> 'enrolled')::boolean, false)) then
        update public.entry_events set status = 'enrolled', result = jsonb_build_object('routes', res), processed_at = now() where id = e.id;
        n_enrolled := n_enrolled + 1;
      else
        update public.entry_events set status = 'skipped', result = jsonb_build_object('routes', res), processed_at = now() where id = e.id;
        n_skipped := n_skipped + 1;
      end if;
    exception when others then
      update public.entry_events set status = 'failed', result = jsonb_build_object('sqlstate', sqlstate), processed_at = now() where id = e.id;
      n_failed := n_failed + 1;
    end;
  end loop;
  return jsonb_build_object('processed', n, 'enrolled', n_enrolled, 'skipped', n_skipped, 'failed', n_failed,
    'waiting', (select count(*) from public.entry_events where status = 'pending'));
end $$;

-- ─── triggers ──────────────────────────────────────────────────────────────────
create function public.hub_contacts_entry_events() returns trigger
language plpgsql security definer set search_path = '' as $$
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
end $$;

create function public.hub_contact_tags_entry_events() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; t text;
begin
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
      select n.contact_id, c.org_id, d.name
        from new_rows n
        join public.contacts c on c.id = n.contact_id
        join public.contact_tag_definitions d on d.id = n.tag_definition_id
       where c.merged_into_id is null and public.hub_flag(c.org_id, 'engine') = 'on'
    loop
      t := public.hub_slug(r.name);
      if t <> '' then
        perform public.raise_entry_event(r.org_id, r.contact_id, 'tag:' || t,
          'tag_added:' || r.contact_id || ':' || t || ':' || txid_current(), 'contact_tag');
      end if;
    end loop;
  exception when others then
    raise warning 'hub entry events skipped for a contact_tags insert: % %', sqlstate, sqlerrm;
  end;
  return null;
end $$;

-- keeps pipelines and pipeline_stages in step with the pipeline editor, so a new stage
-- gets an id the moment it is saved; writes only to the hub_211 tables, and only while
-- the org's engine flag is on (sync_pipelines_from_settings itself is not gated)
create function public.hub_org_settings_pipeline_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if public.hub_flag(new.org_id, 'engine') = 'on' then
      perform public.sync_pipelines_from_settings(new.org_id);
    end if;
  exception when others then
    raise warning 'hub pipeline sync skipped: % %', sqlstate, sqlerrm;
  end;
  return null;
end $$;

create trigger hub_contacts_entry_events after update on public.contacts
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.hub_contacts_entry_events();
create trigger hub_contact_tags_entry_events after insert on public.contact_tags
  referencing new table as new_rows
  for each statement execute function public.hub_contact_tags_entry_events();
create trigger hub_org_settings_pipeline_sync after insert or update on public.org_settings
  for each row when (new.setting_key = 'crm_pipelines')
  execute function public.hub_org_settings_pipeline_sync();

-- which sources are wired, read from the database itself
create function public.entry_source_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'stage', exists (select 1 from pg_catalog.pg_trigger t where t.tgname = 'hub_contacts_entry_events' and not t.tgisinternal and t.tgenabled <> 'D'),
    'tag', exists (select 1 from pg_catalog.pg_trigger t where t.tgname = 'hub_contacts_entry_events' and not t.tgisinternal and t.tgenabled <> 'D')
           and exists (select 1 from pg_catalog.pg_trigger t where t.tgname = 'hub_contact_tags_entry_events' and not t.tgisinternal and t.tgenabled <> 'D'),
    'queue', exists (select 1 from pg_catalog.pg_proc p where p.proname = 'raise_entry_event' and p.pronamespace = 'public'::regnamespace))
$$;

do $$
declare f text;
begin
  foreach f in array array['public.hub_slug(text)', 'public.raise_entry_event(uuid, uuid, text, text, text)',
    'public.guard_entry_events(uuid, uuid[], text, integer)', 'public.process_entry_events(integer)',
    'public.hub_contacts_entry_events()', 'public.hub_contact_tags_entry_events()',
    'public.hub_org_settings_pipeline_sync()', 'public.entry_source_status()']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
