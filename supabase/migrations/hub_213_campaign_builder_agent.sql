-- hub_213_campaign_builder_agent.sql
--
-- Hub Campaign Builder Agent and Hub Guide, every phase in one bundle. Plan and rulings:
-- docs/plans/hub-agent-build-rulings.md (AG4, AG5, AG8, AG13, AG15, AG19 to AG23, section 4).
--
-- STATUS: PROPOSED 2026-10-01. NOT applied to the live project until Cameron gives an
-- explicit go. Tested on a fresh Supabase branch with scripts/agent/contract-213.sql.
--
-- ADDITIVE ONLY. Creates six tables, four functions and one trigger; adds nullable or
-- defaulted columns to funnel_campaigns, sequence_steps, form_definitions and
-- campaign_routes. It alters, drops or rewrites no existing column, table, policy or
-- function, and inserts no data. Nothing it creates runs unless something calls it, except
-- the activation trigger, which acts only on campaign_routes rows whose
-- activate_with_campaign is true. No existing row has that (the column defaults to false),
-- so every existing campaign behaves exactly as before.
--
-- ============================================================================
-- ROLLBACK (written first). Run as one transaction. Destroys every agent run, usage
-- figure, help gap, campaign task and landing page. Client Task copies in public.tasks
-- are NOT removed (they belong to the CRM once created).
-- ============================================================================
-- begin;
-- drop trigger if exists funnel_campaigns_activate_agent_routes on public.funnel_campaigns;
-- drop function if exists public.hub_activate_agent_routes();
-- drop function if exists public.agent_build(uuid);
-- drop function if exists public.agent_reserve(uuid, text, numeric);
-- drop function if exists public.agent_settle(uuid, text, text, numeric, numeric);
-- alter table public.campaign_routes drop column if exists activate_with_campaign;
-- alter table public.campaign_routes drop column if exists ai_run_id;
-- alter table public.form_definitions drop column if exists ai_reviewed_at;
-- alter table public.form_definitions drop column if exists ai_run_id;
-- alter table public.sequence_steps drop column if exists ai_reviewed_at;
-- alter table public.sequence_steps drop column if exists ai_run_id;
-- alter table public.funnel_campaigns drop column if exists ai_reviewed_at;
-- alter table public.funnel_campaigns drop column if exists ai_run_id;
-- drop table if exists public.help_gaps, public.page_definitions, public.campaign_tasks,
--   public.agent_usage, public.agent_runs, public.agent_sessions cascade;
-- delete from supabase_migrations.schema_migrations where name = 'hub_213_campaign_builder_agent';
-- commit;
-- ============================================================================

-- ─── Sessions and runs (rulings 9, 22) ────────────────────────────────────────
create table public.agent_sessions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  user_id       uuid not null,
  mode          text not null check (mode in ('builder','guide')),
  surface       text not null check (surface in ('wizard','panel')),
  campaign_id   uuid references public.funnel_campaigns(id) on delete set null,
  message_count integer not null default 0 check (message_count >= 0),
  opened_at     timestamptz not null default now(),
  last_at       timestamptz not null default now()
);
create index agent_sessions_user on public.agent_sessions (user_id, opened_at desc);

create table public.agent_runs (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references public.agent_sessions(id) on delete cascade,
  org_id             uuid not null references public.organizations(id) on delete cascade,
  user_id            uuid not null,
  mode               text not null check (mode in ('builder','guide')),
  prompt             text not null check (length(prompt) <= 8000),
  route              text,
  help_id            text,
  guide_version      text,
  model_id           text not null,
  plan               jsonb,
  tool_calls         jsonb not null default '[]'::jsonb check (jsonb_typeof(tool_calls) = 'array'),
  cited_article_ids  text[] not null default '{}',
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_usd           numeric(10,6) not null default 0 check (cost_usd >= 0),
  outcome            text not null default 'running' check (outcome in
                       ('running','planned','built','answered','no_answer','refused','cap_hit','model_unavailable','failed')),
  error              text,
  created_ids        jsonb,
  created_at         timestamptz not null default now(),
  finished_at        timestamptz,
  built_at           timestamptz,
  check (mode = 'builder' or plan is null)
);
create index agent_runs_user_recent on public.agent_runs (user_id, mode, created_at desc);
create index agent_runs_org_recent on public.agent_runs (org_id, created_at desc);

-- ─── Usage per org, calendar month (UTC) and mode (AG8, AG23) ─────────────────
create table public.agent_usage (
  org_id       uuid not null references public.organizations(id) on delete cascade,
  month        text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  mode         text not null check (mode in ('builder','guide')),
  reserved_usd numeric(12,6) not null default 0 check (reserved_usd >= 0),
  spent_usd    numeric(12,6) not null default 0 check (spent_usd >= 0),
  updated_at   timestamptz not null default now(),
  primary key (org_id, month, mode)
);

-- ─── Follow-up tasks on the campaign (ruling 14, AG5) ─────────────────────────
create table public.campaign_tasks (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  campaign_id    uuid references public.funnel_campaigns(id) on delete cascade,
  sequence_id    uuid references public.sequences(id) on delete set null,
  run_id         uuid references public.agent_runs(id) on delete set null,
  title          text not null check (btrim(title) <> '' and length(title) <= 200),
  detail         text check (length(detail) <= 2000),
  kind           text not null check (kind in ('copy_review','attach_file','connect_source','sender_or_dns','consent','sms_registration','other')),
  status         text not null default 'open' check (status in ('open','done','dismissed')),
  assignee_id    uuid references public.team_members(id) on delete set null,
  client_task_id uuid references public.tasks(id) on delete set null,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index campaign_tasks_campaign on public.campaign_tasks (campaign_id);

-- ─── Landing pages are data (ruling 12) ───────────────────────────────────────
create table public.page_definitions (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  title              text not null check (btrim(title) <> '' and length(title) <= 200),
  status             text not null default 'draft' check (status in ('draft','published','archived')),
  blocks             jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  form_definition_id uuid references public.form_definitions(id) on delete set null,
  version            integer not null default 1,
  published_at       timestamptz,
  published_by       uuid,
  ai_run_id          uuid references public.agent_runs(id) on delete set null,
  ai_reviewed_at     timestamptz,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (status <> 'published' or published_at is not null)
);

-- ─── Questions the Guide could not answer (ruling 17, AG25) ───────────────────
create table public.help_gaps (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null,
  route      text check (length(route) <= 300),
  help_id    text check (length(help_id) <= 120),
  question   text not null check (btrim(question) <> '' and length(question) <= 2000),
  run_id     uuid references public.agent_runs(id) on delete set null,
  created_at timestamptz not null default now()
);
create index help_gaps_recent on public.help_gaps (org_id, created_at desc);

-- ─── Additive columns on existing tables (AG13, AG15) ─────────────────────────
alter table public.funnel_campaigns add column ai_run_id uuid references public.agent_runs(id) on delete set null;
alter table public.funnel_campaigns add column ai_reviewed_at timestamptz;
alter table public.sequence_steps   add column ai_run_id uuid references public.agent_runs(id) on delete set null;
alter table public.sequence_steps   add column ai_reviewed_at timestamptz;
alter table public.form_definitions add column ai_run_id uuid references public.agent_runs(id) on delete set null;
alter table public.form_definitions add column ai_reviewed_at timestamptz;
alter table public.campaign_routes  add column ai_run_id uuid references public.agent_runs(id) on delete set null;
alter table public.campaign_routes  add column activate_with_campaign boolean not null default false;

-- ─── Activation switches the agent's routes on, in the same statement (AG19) ──
-- The existing activation action is POST /api/marketing/campaigns with status 'active',
-- one UPDATE of funnel_campaigns. This AFTER ROW trigger runs inside that statement, so
-- the campaign and its routes change together or not at all. One shot: the flag is
-- cleared, so a route a person later switches off stays off through pause and resume.
create function public.hub_activate_agent_routes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    update public.campaign_routes r
       set active = true, activate_with_campaign = false
     where r.campaign_id = new.id and r.activate_with_campaign;
  end if;
  return null;
end $$;
create trigger funnel_campaigns_activate_agent_routes
  after update of status on public.funnel_campaigns
  for each row execute function public.hub_activate_agent_routes();

-- ─── Spend reservation (AG8): reserve before a model call, settle after ───────
-- The cap is read here from org_settings key hub_agent_policy, never from the caller.
-- One UPDATE decides, so two concurrent runs cannot both pass under the cap.
create function public.agent_reserve(p_org uuid, p_mode text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_month text := to_char(now() at time zone 'utc', 'YYYY-MM'); v_cap numeric; v_policy jsonb; v_row public.agent_usage;
begin
  if p_mode not in ('builder','guide') then raise exception 'hub: bad agent mode %', p_mode; end if;
  if p_amount is null or p_amount < 0 then raise exception 'hub: bad reservation %', p_amount; end if;
  select s.setting_value into v_policy from public.org_settings s where s.org_id = p_org and s.setting_key = 'hub_agent_policy';
  v_cap := coalesce(
    case when p_mode = 'builder' then (v_policy ->> 'monthly_cap_usd') else (v_policy ->> 'help_monthly_cap_usd') end,
    case when p_mode = 'builder' then '25' else '10' end)::numeric;
  insert into public.agent_usage (org_id, month, mode) values (p_org, v_month, p_mode) on conflict do nothing;
  update public.agent_usage u
     set reserved_usd = u.reserved_usd + p_amount, updated_at = now()
   where u.org_id = p_org and u.month = v_month and u.mode = p_mode
     and u.spent_usd + u.reserved_usd + p_amount <= v_cap
  returning * into v_row;
  if v_row.org_id is null then
    select * into v_row from public.agent_usage u where u.org_id = p_org and u.month = v_month and u.mode = p_mode;
    return jsonb_build_object('ok', false, 'month', v_month, 'cap_usd', v_cap, 'spent_usd', v_row.spent_usd, 'reserved_usd', v_row.reserved_usd);
  end if;
  return jsonb_build_object('ok', true, 'month', v_month, 'cap_usd', v_cap, 'spent_usd', v_row.spent_usd, 'reserved_usd', v_row.reserved_usd);
end $$;

create function public.agent_settle(p_org uuid, p_month text, p_mode text, p_reserved numeric, p_actual numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.agent_usage u
     set reserved_usd = greatest(0, u.reserved_usd - coalesce(p_reserved, 0)),
         spent_usd = u.spent_usd + greatest(0, coalesce(p_actual, 0)), updated_at = now()
   where u.org_id = p_org and u.month = p_month and u.mode = p_mode;
end $$;

-- ─── The atomic build (ruling 7, AG4) ─────────────────────────────────────────
-- Reads the validated plan stored on the run and writes everything in this one call.
-- Re-checks org ownership of every id it is handed. Everything it creates is a draft:
-- the campaign's status is always 'draft' and live_enabled false, whatever the plan says;
-- routes are inactive and armed to switch on with the campaign (AG13, AG19); forms and
-- pages are drafts. A second call for a built run returns the first call's ids.
create function public.agent_build(p_run uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.agent_runs; v_plan jsonb; v_org uuid; v_actor uuid; v_assignee uuid;
  v_campaign uuid; v_sequence uuid; v_form uuid; v_page uuid; v_task uuid; v_client uuid;
  c jsonb; s jsonb; x jsonb; v_one jsonb; i integer; v_forms jsonb := '{}'::jsonb;
  v_ids jsonb := jsonb_build_object('forms', '[]'::jsonb, 'routes', '[]'::jsonb, 'pages', '[]'::jsonb, 'tasks', '[]'::jsonb, 'client_tasks', '[]'::jsonb, 'steps', '[]'::jsonb);
begin
  select * into v_run from public.agent_runs r where r.id = p_run for update;
  if v_run.id is null then raise exception 'hub: agent run % not found', p_run; end if;
  if v_run.outcome = 'built' then return v_run.created_ids; end if;
  if v_run.mode <> 'builder' or v_run.outcome <> 'planned' or v_run.plan is null then
    raise exception 'hub: agent run % is not a planned builder run (%)', p_run, v_run.outcome;
  end if;
  v_org := v_run.org_id; v_actor := v_run.user_id; v_plan := v_run.plan;
  if public.hub_flag(v_org, 'agent_enabled') <> 'on' then raise exception 'hub: agent_disabled'; end if;
  select tm.id into v_assignee from public.team_members tm where tm.org_id = v_org and tm.user_id = v_actor and tm.is_active;

  -- forms first, so a page can refer to one by slug
  for x in select * from jsonb_array_elements(coalesce(v_plan -> 'forms', '[]'::jsonb)) loop
    insert into public.form_definitions (org_id, slug, name, status, fields, consents, source_key, success_message, created_by, ai_run_id)
    values (v_org, x ->> 'slug', x ->> 'name', 'draft', coalesce(x -> 'fields', '[]'::jsonb), coalesce(x -> 'consents', '[]'::jsonb),
            coalesce(x ->> 'source_key', 'form:' || (x ->> 'slug')),
            coalesce(nullif(btrim(x ->> 'success_message'), ''), 'Thank you. Your details have been received.'), v_actor, p_run)
    returning id into v_form;
    v_forms := v_forms || jsonb_build_object(x ->> 'slug', v_form);
    v_ids := jsonb_set(v_ids, '{forms}', (v_ids -> 'forms') || to_jsonb(v_form));
  end loop;

  c := v_plan -> 'campaign';
  if c is not null and jsonb_typeof(c) = 'object' then
    if c ->> 'entry_pipeline_id' is not null and not exists (select 1 from public.pipelines p
         where p.id = (c ->> 'entry_pipeline_id')::uuid and p.org_id = v_org and p.archived_at is null) then
      raise exception 'hub: entry pipeline not in org';
    end if;
    if c ->> 'entry_stage_id' is not null and not exists (select 1 from public.pipeline_stages st
         where st.id = (c ->> 'entry_stage_id')::uuid and st.org_id = v_org and st.archived_at is null
           and st.pipeline_id = (c ->> 'entry_pipeline_id')::uuid) then
      raise exception 'hub: entry stage not in the entry pipeline of this org';
    end if;
    if c ->> 'goal_stage_id' is not null and not exists (select 1 from public.pipeline_stages st
         where st.id = (c ->> 'goal_stage_id')::uuid and st.org_id = v_org and st.archived_at is null) then
      raise exception 'hub: goal stage not in org';
    end if;
    insert into public.funnel_campaigns (org_id, name, description, status, entry_pipeline_id, entry_stage_id, goal_stage_id, goal,
                                         live_enabled, created_by, ai_run_id)
    values (v_org, c ->> 'name', c ->> 'description', 'draft', (c ->> 'entry_pipeline_id')::uuid, (c ->> 'entry_stage_id')::uuid,
            (c ->> 'goal_stage_id')::uuid, coalesce(c -> 'goal', '{}'::jsonb), false, v_actor, p_run)
    returning id into v_campaign;
    v_ids := v_ids || jsonb_build_object('campaign', v_campaign);
  end if;

  s := v_plan -> 'sequence';
  if s is not null and jsonb_typeof(s) = 'object' then
    insert into public.sequences (org_id, name, campaign_id, created_by, is_active)
    values (v_org, s ->> 'name', v_campaign, v_assignee, true)
    returning id into v_sequence;
    v_ids := v_ids || jsonb_build_object('sequence', v_sequence);
    i := 0;
    for x in select * from jsonb_array_elements(coalesce(s -> 'steps', '[]'::jsonb)) loop
      if x ->> 'asset_id' is not null and not exists (select 1 from public.university_assets a
           where a.id = (x ->> 'asset_id')::uuid and a.org_id = v_org) then
        raise exception 'hub: asset not in org';
      end if;
      insert into public.sequence_steps (sequence_id, step_order, channel, delay_minutes, subject, body, kind, step_type, asset_id, ai_run_id)
      values (v_sequence, i, x ->> 'channel', coalesce((x ->> 'delay_minutes')::integer, 0), x ->> 'subject', x ->> 'body',
              x ->> 'kind', coalesce(x ->> 'step_type', 'message'), (x ->> 'asset_id')::uuid, p_run)
      returning to_jsonb(id) into v_one;
      v_ids := jsonb_set(v_ids, '{steps}', (v_ids -> 'steps') || v_one);
      i := i + 1;
    end loop;
    if v_campaign is not null then
      update public.funnel_campaigns set sequence_id = v_sequence where id = v_campaign;
    end if;
  end if;

  if v_campaign is not null then
    for x in select * from jsonb_array_elements(coalesce(v_plan -> 'routes', '[]'::jsonb)) loop
      insert into public.campaign_routes (org_id, source_key, campaign_id, active, activate_with_campaign, ai_run_id)
      values (v_org, lower(x ->> 'source_key'), v_campaign, false, true, p_run)
      returning to_jsonb(id) into v_one;
      v_ids := jsonb_set(v_ids, '{routes}', (v_ids -> 'routes') || v_one);
    end loop;
  end if;

  for x in select * from jsonb_array_elements(coalesce(v_plan -> 'pages', '[]'::jsonb)) loop
    insert into public.page_definitions (org_id, slug, title, status, blocks, form_definition_id, created_by, ai_run_id)
    values (v_org, x ->> 'slug', x ->> 'title', 'draft', coalesce(x -> 'blocks', '[]'::jsonb),
            coalesce((v_forms ->> (x ->> 'form_slug'))::uuid,
                     (select f.id from public.form_definitions f where f.org_id = v_org and f.slug = x ->> 'form_slug')),
            v_actor, p_run)
    returning id into v_page;
    v_ids := jsonb_set(v_ids, '{pages}', (v_ids -> 'pages') || to_jsonb(v_page));
  end loop;

  -- Tasks, each copied ONCE into Client Tasks (AG5, AG20). trg_sync_task_to_kanban would
  -- also put a card on the team's Project Board; its own transaction-local guard is set
  -- around these inserts so it does not (AG21). No contact, so trg_task_timeline writes
  -- nothing. Nothing here notifies anyone.
  for x in select * from jsonb_array_elements(coalesce(v_plan -> 'tasks', '[]'::jsonb)) loop
    insert into public.campaign_tasks (org_id, campaign_id, sequence_id, run_id, title, detail, kind, assignee_id, created_by)
    values (v_org, v_campaign, v_sequence, p_run, x ->> 'title', x ->> 'detail', x ->> 'kind', v_assignee, v_actor)
    returning id into v_task;
    perform set_config('app.is_syncing', 'true', true);
    insert into public.tasks (org_id, title, description, status, priority, assigned_to, created_by, source, source_id)
    values (v_org, left('Campaign Builder: ' || (x ->> 'title'), 300),
            concat_ws(E'\n\n', nullif(x ->> 'detail', ''),
              case when v_campaign is not null then 'From the Campaign Builder. Campaign: /campaigns?tab=funnels&funnel=' || v_campaign
                   else 'From the Campaign Builder.' end),
            'todo', 'medium', v_assignee, v_actor, 'campaign_builder', coalesce(v_campaign, v_sequence))
    returning id into v_client;
    perform set_config('app.is_syncing', '', true);
    update public.campaign_tasks set client_task_id = v_client where id = v_task;
    v_ids := jsonb_set(v_ids, '{tasks}', (v_ids -> 'tasks') || to_jsonb(v_task));
    v_ids := jsonb_set(v_ids, '{client_tasks}', (v_ids -> 'client_tasks') || to_jsonb(v_client));
  end loop;

  update public.agent_runs set outcome = 'built', built_at = now(), created_ids = v_ids where id = p_run;
  return v_ids;
end $$;

-- ─── RLS and grants (ruling 17, migration 030 posture) ────────────────────────
do $$
declare t text;
begin
  foreach t in array array['agent_sessions','agent_runs','agent_usage','campaign_tasks','page_definitions','help_gaps']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
  -- staff READ the two tables the screens show, in their own orgs. No browser writes. The
  -- agent's logs, usage and help gaps are read only through staff routes (service role).
  foreach t in array array['campaign_tasks','page_definitions']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (org_id in (select public.hub_team_org_ids()))',
                   t || '_staff_read', t);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.hub_activate_agent_routes()', 'public.agent_reserve(uuid, text, numeric)',
    'public.agent_settle(uuid, text, text, numeric, numeric)', 'public.agent_build(uuid)']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
