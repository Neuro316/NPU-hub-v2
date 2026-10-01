-- hub_211_marketing_engine.sql
--
-- Hub marketing engine, Phases 1 and 2. Plan and rulings:
-- docs/plans/hub-marketing-build-rulings.md
--
-- STATUS: PROPOSED 2026-09-30. NOT applied to the live project until Cameron gives an
-- explicit go. Tested on Supabase branch hub-marketing-211 (ref ykhgxzpagiviimshzfxc):
-- applied, rolled back with the block below (left exactly the 11 bootstrap tables and
-- 0 functions), reapplied, then scripts/marketing/contract-211.sql: 45 cases green, and
-- each of 5 planted defects reddened exactly its declared set.
--
-- ADDITIVE ONLY. Creates new tables and functions, adds nullable columns to
-- sequences / sequence_steps / sequence_enrollments (0 rows each on 2026-09-30),
-- and inserts rows only into tables this file creates. It does not alter, drop or
-- rewrite any existing column, table, policy or function, and it does not touch
-- contacts.email_consent / sms_consent (Layer 1 is out of scope, see design
-- §12.2b). Every engine function is a no-op while the org's `engine` flag is off
-- (org_settings key hub_marketing_flags, absent on every org), except
-- record_consent, which always works so that an unsubscribe can never be refused.
--
-- ============================================================================
-- ROLLBACK (written first). Run as one transaction. Destroys all data in the
-- tables below, including the consent ledger; export consent_events first.
-- ============================================================================
-- begin;
-- drop function if exists public.hub_intake_contact(uuid, text, text, text, text, text, jsonb);
-- drop function if exists public.redeem_asset_grant(bytea, timestamptz);
-- drop function if exists public.grant_asset(uuid, uuid, bytea, interval, uuid);
-- drop function if exists public.route_and_enroll(uuid, uuid, text, text);
-- drop function if exists public.enroll(uuid, uuid, text, text);
-- drop function if exists public.move_stage(uuid, uuid, uuid, text);
-- drop function if exists public.claim_send(uuid, text, text, text, text, text, text, text, text, text, text, uuid, jsonb);
-- drop function if exists public.gate_check(uuid, text, text, uuid, timestamptz);
-- drop function if exists public.consent_state(uuid, text, text);
-- drop function if exists public.record_consent(uuid, text, text, text, text, text, text, jsonb, uuid);
-- drop function if exists public.sync_pipelines_from_settings(uuid);
-- drop function if exists public.hub_contact_family(uuid);
-- drop function if exists public.hub_resolve_contact(uuid);
-- drop function if exists public.hub_send_policy(uuid);
-- drop function if exists public.hub_flag(uuid, text);
-- alter table public.sequence_enrollments drop column if exists campaign_enrollment_id;
-- alter table public.sequence_steps drop column if exists asset_id;
-- alter table public.sequence_steps drop column if exists kind;
-- alter table public.sequence_steps drop column if exists step_type;
-- alter table public.sequences drop column if exists campaign_id;
-- drop table if exists public.asset_grants, public.university_assets, public.job_runs,
--   public.campaign_test_contacts, public.form_submissions, public.form_definitions,
--   public.provider_events, public.send_log, public.message_sends, public.suppressions,
--   public.consent_events, public.campaign_enrollments, public.campaign_routes,
--   public.funnel_campaigns, public.contact_pipeline_positions, public.pipeline_stages,
--   public.pipelines cascade;
-- drop function if exists public.hub_consent_events_append_only();
-- drop function if exists public.hub_team_org_ids();
-- delete from supabase_migrations.schema_migrations where name = 'hub_211_marketing_engine';
-- commit;
-- ============================================================================

-- ─── Membership helper (A16): org ids from ACTIVE team_profiles rows ───────────
create function public.hub_team_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tp.org_id from public.team_profiles tp
  where tp.user_id = auth.uid() and tp.status = 'active'
$$;
revoke execute on function public.hub_team_org_ids() from public;
grant execute on function public.hub_team_org_ids() to authenticated;

-- ─── Flags and send policy (A8), read from org_settings, absent means off ──────
create function public.hub_flag(p_org uuid, p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.setting_value ->> p_key from public.org_settings s
      where s.org_id = p_org and s.setting_key = 'hub_marketing_flags'),
    'off')
$$;

-- The sender is a placeholder until Cameron sets hub_send_policy.from_address and
-- from_domain. The provider refuses a live send while from_domain is the placeholder.
create function public.hub_send_policy(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
      'quiet_start', '08:00', 'quiet_end', '20:00',
      'default_timezone', 'America/New_York',
      'cap_count', 3, 'cap_days', 7,
      'from_address', 'Neuro Progeny <hello@sender-not-set.neuroprogeny.com>',
      'from_domain', 'sender-not-set.neuroprogeny.com')
    || coalesce((select s.setting_value from public.org_settings s
                  where s.org_id = p_org and s.setting_key = 'hub_send_policy'), '{}'::jsonb)
$$;

-- ─── Contact identity across merges (A14) ─────────────────────────────────────
create function public.hub_resolve_contact(p_contact uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := p_contact; nxt uuid; i int := 0;
begin
  loop
    select c.merged_into_id into nxt from public.contacts c where c.id = v;
    if not found then raise exception 'hub: contact % not found', v using errcode = 'P0002'; end if;
    exit when nxt is null;
    v := nxt; i := i + 1;
    if i > 10 then raise exception 'hub: merge chain too deep or cyclic at %', p_contact; end if;
  end loop;
  return v;
end $$;

-- the survivor and every contact that was merged into it, at any depth
create function public.hub_contact_family(p_survivor uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive fam(id, depth) as (
    select p_survivor, 0
    union
    select c.id, f.depth + 1 from public.contacts c join fam f on c.merged_into_id = f.id where f.depth < 10)
  select id from fam
$$;

-- ─── Pipelines and stages with stable ids (ruling 3) ──────────────────────────
create table public.pipelines (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  legacy_key  text not null,
  name        text not null,
  is_default  boolean not null default false,
  position    integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, legacy_key),
  unique (org_id, id)
);

create table public.pipeline_stages (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  pipeline_id    uuid not null,
  legacy_key     text not null,   -- the JSON stage id, or 'name:<name>' for the 15 stages that have none (A17)
  name           text not null,
  position       integer not null default 0,
  color          text,
  is_closed_won  boolean not null default false,
  is_closed_lost boolean not null default false,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (pipeline_id, legacy_key),
  unique (pipeline_id, id),
  foreign key (org_id, pipeline_id) references public.pipelines (org_id, id) on delete cascade
);

create table public.contact_pipeline_positions (
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null,
  stage_id    uuid not null,
  moved_at    timestamptz not null default now(),
  moved_by    uuid,
  source      text not null,
  primary key (contact_id, pipeline_id),
  foreign key (pipeline_id, stage_id) references public.pipeline_stages (pipeline_id, id) on delete cascade
);
create index contact_pipeline_positions_stage on public.contact_pipeline_positions (stage_id);

-- ─── Campaigns (A1), routes, enrollments ──────────────────────────────────────
create table public.funnel_campaigns (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  name                 text not null check (btrim(name) <> ''),
  description          text,
  status               text not null default 'draft' check (status in ('draft','active','paused','archived')),
  entry_pipeline_id    uuid,
  entry_stage_id       uuid,
  goal_stage_id        uuid references public.pipeline_stages(id) on delete set null,
  goal                 jsonb not null default '{}'::jsonb,
  sequence_id          uuid references public.sequences(id) on delete set null,
  live_enabled         boolean not null default false,   -- only Cameron flips this (ruling 10)
  live_enabled_at      timestamptz,
  live_enabled_by      uuid,
  planning_campaign_id uuid references public.campaigns(id) on delete set null,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (entry_stage_id is null or entry_pipeline_id is not null),
  foreign key (entry_pipeline_id, entry_stage_id) references public.pipeline_stages (pipeline_id, id) on delete set null (entry_stage_id)
);

create table public.campaign_routes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  source_key  text not null check (source_key ~ '^[a-z0-9][a-z0-9_.:-]{0,79}$'),
  campaign_id uuid not null references public.funnel_campaigns(id) on delete cascade,
  active      boolean not null default true,
  priority    integer not null default 100,
  created_at  timestamptz not null default now(),
  unique (org_id, source_key, campaign_id)
);

create table public.campaign_enrollments (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  contact_id             uuid not null references public.contacts(id) on delete cascade,
  campaign_id            uuid not null references public.funnel_campaigns(id) on delete cascade,
  source_key             text not null,
  event_id               text not null,
  status                 text not null default 'active'
                         check (status in ('active','duplicate','goal_met','completed','exited')),
  duplicate_of           uuid references public.campaign_enrollments(id) on delete set null,
  sequence_enrollment_id uuid references public.sequence_enrollments(id) on delete set null,
  enrolled_at            timestamptz not null default now(),
  ended_at               timestamptz,
  end_reason             text,
  unique (contact_id, campaign_id, source_key, event_id)
);
create index campaign_enrollments_active on public.campaign_enrollments (contact_id, campaign_id) where status = 'active';

-- ─── Consent ledger (ruling 7, A5), append-only ────────────────────────────────
create table public.consent_events (
  id          uuid primary key default gen_random_uuid(),
  -- tiebreaker: two events in one transaction share now(), so "latest" needs an order of its own
  seq         bigint generated always as identity,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  contact_id  uuid references public.contacts(id) on delete set null,
  address     text,              -- normalized email or E.164 at the time, so the record survives a contact delete
  channel     text not null check (channel in ('email','sms')),
  kind        text not null check (kind in ('marketing','service')),
  action      text not null check (action in ('granted','revoked')),
  basis       text not null check (basis in ('express_consent','existing_business_relationship','transactional',
                                             'unsubscribe','stop','bounce','complaint','admin')),
  source      text not null,     -- form:<slug>, checkout, unsubscribe_link, sms_stop, resend_webhook, admin, import
  text_shown  text,
  evidence    jsonb not null default '{}'::jsonb,
  actor_id    uuid,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  check (action = 'revoked' or source = 'import' or coalesce(btrim(text_shown), '') <> '')
);
create index consent_events_lookup on public.consent_events (contact_id, channel, kind, occurred_at desc, seq desc);

create function public.hub_consent_events_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- the only permitted change is the FK's own ON DELETE SET NULL of contact_id
  if tg_op = 'UPDATE'
     and new.contact_id is null and old.contact_id is not null
     and (to_jsonb(new) - 'contact_id') = (to_jsonb(old) - 'contact_id') then
    return new;
  end if;
  raise exception 'consent_events is append-only (% refused)', tg_op using errcode = '42501';
end $$;
revoke execute on function public.hub_consent_events_append_only() from public;
create trigger consent_events_append_only before update or delete on public.consent_events
  for each row execute function public.hub_consent_events_append_only();

create table public.suppressions (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  channel    text not null check (channel in ('email','sms')),
  address    text not null,
  scope      text not null check (scope in ('marketing','all')),
  reason     text not null check (reason in ('unsubscribe','stop','hard_bounce','complaint','manual')),
  source     text not null,
  created_at timestamptz not null default now(),
  lifted_at  timestamptz,
  lifted_by  uuid
);
create unique index suppressions_active on public.suppressions (org_id, channel, address, reason) where lifted_at is null;

-- ─── Outbox and decision log (ruling 8, A4) ───────────────────────────────────
create table public.message_sends (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  contact_id          uuid references public.contacts(id) on delete set null,
  channel             text not null check (channel in ('email','sms')),
  kind                text not null check (kind in ('marketing','service')),
  source_kind         text not null check (source_kind in ('campaign','sequence','stage','manual','transactional','watchdog')),
  source_id           text,
  source_step_id      text,
  dedupe_key          text not null,
  to_address          text not null,
  status              text not null default 'sending'
                      check (status in ('sending','sent','failed','skipped','suppressed','bounced','dry_run')),
  dry_run             boolean not null default true,
  skip_reason         text,
  subject             text,
  rendered_body       text,
  consent_event_id    uuid references public.consent_events(id),
  consent_snapshot    jsonb not null default '{}'::jsonb,
  provider            text,
  external_message_id text,
  error_code          text,
  error_message       text,
  attempts            integer not null default 0,
  claimed_at          timestamptz not null default now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  opened_at           timestamptz,
  clicked_at          timestamptz,
  bounced_at          timestamptz,
  complained_at       timestamptz
);
-- the 077 claim, generalized: one live send per contact, channel and logical message
create unique index message_sends_once on public.message_sends (contact_id, channel, dedupe_key)
  where status in ('sending','sent');
-- a rehearsal is recorded once too, and never blocks a later live send
create unique index message_sends_once_dry on public.message_sends (contact_id, channel, dedupe_key)
  where status = 'dry_run';
create index message_sends_stale on public.message_sends (status, claimed_at) where status = 'sending';
create index message_sends_contact on public.message_sends (contact_id, claimed_at desc);
create index message_sends_external on public.message_sends (external_message_id) where external_message_id is not null;

create table public.send_log (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  contact_id      uuid references public.contacts(id) on delete set null,
  campaign_id     uuid references public.funnel_campaigns(id) on delete set null,
  message_send_id uuid references public.message_sends(id) on delete set null,
  channel         text not null,
  kind            text not null,
  decision        text not null check (decision in ('allow','deny','defer')),
  mode            text check (mode in ('live','dry_run')),
  step            text not null,
  reason          text not null,
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index send_log_contact on public.send_log (contact_id, created_at desc);

create table public.provider_events (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid references public.organizations(id) on delete cascade,
  provider            text not null,
  provider_event_id   text not null,
  event_type          text not null,
  external_message_id text,
  message_send_id     uuid references public.message_sends(id) on delete set null,
  payload             jsonb not null,
  received_at         timestamptz not null default now(),
  processed_at        timestamptz,
  unique (provider, provider_event_id)
);

-- ─── Forms and intake (ruling 12) ─────────────────────────────────────────────
create table public.form_definitions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  slug            text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  name            text not null,
  status          text not null default 'draft' check (status in ('draft','published','archived')),
  version         integer not null default 1,
  fields          jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  consents        jsonb not null default '[]'::jsonb check (jsonb_typeof(consents) = 'array'),
  source_key      text not null check (source_key ~ '^[a-z0-9][a-z0-9_.:-]{0,79}$'),
  success_message text not null default 'Thank you. Your details have been received.',
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.form_submissions (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  form_id    uuid references public.form_definitions(id) on delete set null,
  form_version integer,
  contact_id uuid references public.contacts(id) on delete set null,
  ip_hash    text,
  outcome    text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index form_submissions_ip on public.form_submissions (ip_hash, created_at desc);

-- ─── Safety allowlist (ruling 10) ─────────────────────────────────────────────
create table public.campaign_test_contacts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  email      text,
  phone      text,
  label      text not null,
  created_at timestamptz not null default now(),
  check (email is not null or phone is not null)
);

-- ─── Health (ruling 13). Service role only: RLS on, no policy, no grant. ──────
create table public.job_runs (
  id           uuid primary key default gen_random_uuid(),
  job          text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  rows_touched integer,
  error        text,
  detail       jsonb not null default '{}'::jsonb
);
create index job_runs_job on public.job_runs (job, started_at desc);

-- ─── University assets and grants (ruling 11, A9, A10) ────────────────────────
create table public.university_assets (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  title       text not null,
  description text,
  -- a path on https://university.neuroprogeny.com only; the host is fixed in code
  path        text not null check (path ~ '^/[A-Za-z0-9/_.~%=&?-]*$' and path !~ '^//' and path !~ '\\'),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.asset_grants (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  contact_id      uuid references public.contacts(id) on delete set null,
  asset_id        uuid not null references public.university_assets(id) on delete cascade,
  token_hash      bytea not null unique,   -- sha256 of a random token; the token itself is never stored
  expires_at      timestamptz not null,
  message_send_id uuid references public.message_sends(id) on delete set null,
  created_at      timestamptz not null default now(),
  first_redeemed_at timestamptz,
  redeem_count    integer not null default 0
);

-- ─── Sequences carry campaign steps (ruling 6). Nullable, 0 rows today. ───────
alter table public.sequences add column campaign_id uuid references public.funnel_campaigns(id) on delete set null;
alter table public.sequence_steps add column step_type text not null default 'message' check (step_type in ('message','deliver_asset'));
alter table public.sequence_steps add column kind text check (kind in ('marketing','service'));
alter table public.sequence_steps add column asset_id uuid references public.university_assets(id) on delete set null;
alter table public.sequence_enrollments add column campaign_enrollment_id uuid references public.campaign_enrollments(id) on delete set null;

-- ─── RLS and grants on every new table (ruling 17, migration 030 posture) ─────
do $$
declare t text;
begin
  foreach t in array array['pipelines','pipeline_stages','contact_pipeline_positions','funnel_campaigns',
    'campaign_routes','campaign_enrollments','consent_events','suppressions','message_sends','send_log',
    'provider_events','form_definitions','form_submissions','campaign_test_contacts','job_runs',
    'university_assets','asset_grants']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  -- staff READ in their own orgs. No browser writes: every write is a function or a
  -- service-role route, so no INSERT/UPDATE/DELETE policy exists and none is granted.
  foreach t in array array['pipelines','pipeline_stages','contact_pipeline_positions','funnel_campaigns',
    'campaign_routes','campaign_enrollments','consent_events','suppressions','message_sends','send_log',
    'provider_events','form_definitions','form_submissions','campaign_test_contacts',
    'university_assets','asset_grants']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (org_id in (select public.hub_team_org_ids()))',
                   t || '_staff_read', t);
  end loop;
end $$;
-- service_role privileges stated explicitly rather than inherited from default ACLs, which
-- differ between this project and its branches. The ledger gets SELECT and INSERT only:
-- it cannot be rewritten by any API role, whatever the trigger says.
do $$
declare t text;
begin
  foreach t in array array['pipelines','pipeline_stages','contact_pipeline_positions','funnel_campaigns',
    'campaign_routes','campaign_enrollments','suppressions','message_sends','send_log',
    'provider_events','form_definitions','form_submissions','campaign_test_contacts','job_runs',
    'university_assets','asset_grants']
  loop
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
grant select, insert on public.consent_events to service_role;
revoke update, delete, truncate on public.consent_events from service_role;

-- ─── Pipeline sync from the legacy JSON (A3, A17) ─────────────────────────────
create function public.sync_pipelines_from_settings(p_org uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb; p jsonb; s jsonb; pid uuid; pos int; spos int; seen_p text[] := '{}'; seen_s text[];
  n_p int := 0; n_s int := 0; skey text;
begin
  select st.setting_value into cfg from public.org_settings st where st.org_id = p_org and st.setting_key = 'crm_pipelines';
  if cfg is null or jsonb_typeof(cfg -> 'pipelines') <> 'array' then
    return jsonb_build_object('org', p_org, 'pipelines', 0, 'stages', 0, 'note', 'no crm_pipelines setting');
  end if;
  pos := 0;
  for p in select x from jsonb_array_elements(cfg -> 'pipelines') x loop
    continue when coalesce(p ->> 'id', '') = '' or coalesce(p ->> 'name', '') = '';
    insert into public.pipelines (org_id, legacy_key, name, is_default, position, archived_at, updated_at)
    values (p_org, p ->> 'id', p ->> 'name', coalesce((p ->> 'is_default')::boolean, false), pos, null, now())
    on conflict (org_id, legacy_key) do update
      set name = excluded.name, is_default = excluded.is_default, position = excluded.position,
          archived_at = null, updated_at = now()
    returning id into pid;
    seen_p := seen_p || (p ->> 'id'); n_p := n_p + 1; pos := pos + 1;
    seen_s := '{}'; spos := 0;
    for s in select y from jsonb_array_elements(coalesce(p -> 'stages', '[]'::jsonb)) y loop
      continue when coalesce(s ->> 'name', '') = '';
      skey := coalesce(nullif(s ->> 'id', ''), 'name:' || (s ->> 'name'));
      continue when skey = any(seen_s);
      insert into public.pipeline_stages (org_id, pipeline_id, legacy_key, name, position, color,
                                          is_closed_won, is_closed_lost, archived_at, updated_at)
      values (p_org, pid, skey, s ->> 'name', coalesce((s ->> 'position')::int, spos), s ->> 'color',
              coalesce((s ->> 'is_closed_won')::boolean, false), coalesce((s ->> 'is_closed_lost')::boolean, false), null, now())
      on conflict (pipeline_id, legacy_key) do update
        set name = excluded.name, position = excluded.position, color = excluded.color,
            is_closed_won = excluded.is_closed_won, is_closed_lost = excluded.is_closed_lost,
            archived_at = null, updated_at = now();
      seen_s := seen_s || skey; n_s := n_s + 1; spos := spos + 1;
    end loop;
    -- a stage removed from the JSON is archived, never deleted: its id stays valid
    update public.pipeline_stages ps set archived_at = now()
      where ps.pipeline_id = pid and ps.archived_at is null and not (ps.legacy_key = any(seen_s));
  end loop;
  update public.pipelines pl set archived_at = now()
    where pl.org_id = p_org and pl.archived_at is null and not (pl.legacy_key = any(seen_p));
  return jsonb_build_object('org', p_org, 'pipelines', n_p, 'stages', n_s);
end $$;

-- ─── Consent: record (the single write door) and read ─────────────────────────
create function public.record_consent(
  p_contact uuid, p_channel text, p_kind text, p_action text, p_basis text,
  p_source text, p_text_shown text, p_evidence jsonb default '{}'::jsonb, p_actor uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; v_org uuid; v_addr text; k text; n int := 0; v_scope text; v_reason text;
begin
  if p_kind not in ('marketing','service','all') then raise exception 'hub: bad kind %', p_kind; end if;
  if p_channel not in ('email','sms') then raise exception 'hub: bad channel %', p_channel; end if;
  v_id := public.hub_resolve_contact(p_contact);
  select c.org_id, case when p_channel = 'email' then lower(btrim(c.email)) else btrim(c.phone) end
    into v_org, v_addr from public.contacts c where c.id = v_id;
  for k in select unnest(case when p_kind = 'all' then array['marketing','service'] else array[p_kind] end) loop
    insert into public.consent_events (org_id, contact_id, address, channel, kind, action, basis, source, text_shown, evidence, actor_id)
    values (v_org, v_id, v_addr, p_channel, k, p_action, p_basis, p_source, p_text_shown,
            coalesce(p_evidence, '{}'::jsonb) || jsonb_build_object('requested_contact_id', p_contact), p_actor);
    n := n + 1;
  end loop;
  if v_addr is not null and v_addr <> '' then
    if p_action = 'revoked' and p_basis in ('unsubscribe','stop','bounce','complaint') then
      v_reason := case p_basis when 'bounce' then 'hard_bounce' else p_basis end;
      v_scope  := case when p_basis = 'unsubscribe' and p_kind = 'marketing' then 'marketing' else 'all' end;
      insert into public.suppressions (org_id, channel, address, scope, reason, source)
      values (v_org, p_channel, v_addr, v_scope, v_reason, p_source)
      on conflict do nothing;
    elsif p_action = 'granted' then
      -- a fresh opt-in lifts an opt-out, never a bounce or a complaint
      update public.suppressions su set lifted_at = now(), lifted_by = p_actor
        where su.org_id = v_org and su.channel = p_channel and su.address = v_addr and su.lifted_at is null
          and su.reason in ('unsubscribe','stop')
          and (su.scope = 'marketing' or p_kind in ('service','all') or p_channel = 'sms');
    end if;
  end if;
  return n;
end $$;

create function public.consent_state(p_contact uuid, p_channel text, p_kind text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; e record;
begin
  v_id := public.hub_resolve_contact(p_contact);
  select ce.id, ce.action, ce.kind into e from public.consent_events ce
   where ce.contact_id in (select public.hub_contact_family(v_id)) and ce.channel = p_channel and ce.kind = p_kind
   order by ce.occurred_at desc, ce.seq desc limit 1;
  if found then
    return jsonb_build_object('allowed', e.action = 'granted', 'event_id', e.id,
                              'reason', case when e.action = 'granted' then p_kind || '_granted' else p_kind || '_revoked' end);
  end if;
  if p_kind = 'service' then
    -- no service record: a standing marketing grant on the same channel covers service messages
    select ce.id, ce.action into e from public.consent_events ce
     where ce.contact_id in (select public.hub_contact_family(v_id)) and ce.channel = p_channel and ce.kind = 'marketing'
     order by ce.occurred_at desc, ce.seq desc limit 1;
    if found and e.action = 'granted' then
      return jsonb_build_object('allowed', true, 'event_id', e.id, 'reason', 'marketing_grant_covers_service');
    end if;
    return jsonb_build_object('allowed', false, 'event_id', null, 'reason', 'no_service_basis');
  end if;
  return jsonb_build_object('allowed', false, 'event_id', null, 'reason', 'no_marketing_consent');
end $$;

-- ─── The send gate (ruling 8). Every decision is written to send_log. ─────────
create function public.gate_check(p_contact uuid, p_channel text, p_kind text, p_campaign uuid default null,
                                  p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; c record; pol jsonb; v_mode text := 'dry_run'; v_addr text; cs jsonb; v_tz text;
  v_local timestamp; v_start time; v_end time; v_next timestamp; v_retry timestamptz; v_n int; v_live_ok boolean;
  v_decision text; v_step text; v_reason text; v_detail jsonb := '{}'::jsonb;
begin
  v_id := public.hub_resolve_contact(p_contact);
  select x.id, x.org_id, x.email, x.phone, x.timezone, x.do_not_contact into c from public.contacts x where x.id = v_id;
  pol := public.hub_send_policy(c.org_id);

  <<gate>>
  begin
    -- 1. flag: engine on, then live or dry-run
    if public.hub_flag(c.org_id, 'engine') <> 'on' then
      v_decision := 'deny'; v_step := 'flag'; v_reason := 'engine_off'; exit gate;
    end if;
    v_addr := case when p_channel = 'email' then lower(btrim(c.email)) else btrim(c.phone) end;
    if p_channel = 'email' and (v_addr is null or v_addr !~ '^[^@\s:]+@[^@\s]+\.[a-z]{2,}$') then
      v_decision := 'deny'; v_step := 'address'; v_reason := 'no_valid_email'; exit gate;
    end if;
    if p_channel = 'sms' and (v_addr is null or v_addr !~ '^\+[1-9][0-9]{7,14}$') then
      v_decision := 'deny'; v_step := 'address'; v_reason := 'no_valid_e164_phone'; exit gate;
    end if;
    if public.hub_flag(c.org_id, 'gate_live_sends') = 'on' then
      select exists (select 1 from public.campaign_test_contacts t where t.org_id = c.org_id and
               ((p_channel = 'email' and lower(btrim(t.email)) = v_addr) or
                (p_channel = 'sms' and right(regexp_replace(coalesce(t.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(v_addr, '\D', '', 'g'), 10)
                                   and coalesce(t.phone, '') <> '')))
        or exists (select 1 from public.funnel_campaigns f where f.id = p_campaign and f.org_id = c.org_id and f.live_enabled)
        into v_live_ok;
      if v_live_ok then v_mode := 'live'; end if;
    end if;
    -- 2. consent for this kind and channel
    cs := public.consent_state(v_id, p_channel, p_kind);
    if not (cs ->> 'allowed')::boolean then
      v_decision := 'deny'; v_step := 'consent'; v_reason := cs ->> 'reason'; exit gate;
    end if;
    -- 3. DNC and suppression
    if c.do_not_contact then
      v_decision := 'deny'; v_step := 'suppression'; v_reason := 'do_not_contact_flag'; exit gate;
    end if;
    if exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and
               ((p_channel = 'email' and lower(btrim(d.email)) = v_addr) or (p_channel = 'sms' and btrim(d.phone) = v_addr))) then
      v_decision := 'deny'; v_step := 'suppression'; v_reason := 'do_not_contact_list'; exit gate;
    end if;
    select su.reason into v_reason from public.suppressions su
      where su.org_id = c.org_id and su.channel = p_channel and su.address = v_addr and su.lifted_at is null
        and (su.scope = 'all' or p_kind = 'marketing') limit 1;
    if found then
      v_decision := 'deny'; v_step := 'suppression'; v_reason := 'suppressed_' || v_reason; exit gate;
    end if;
    -- 4. quiet hours in the contact's local time
    v_tz := coalesce((select z.name from pg_catalog.pg_timezone_names z where z.name = c.timezone), pol ->> 'default_timezone');
    v_start := (pol ->> 'quiet_start')::time; v_end := (pol ->> 'quiet_end')::time;
    v_local := p_now at time zone v_tz;
    if not (v_local::time >= v_start and v_local::time < v_end) then
      v_next := case when v_local::time < v_start then v_local::date + v_start else (v_local::date + 1) + v_start end;
      v_retry := v_next at time zone v_tz;
      v_decision := 'defer'; v_step := 'quiet_hours'; v_reason := 'outside_send_window';
      v_detail := jsonb_build_object('timezone', v_tz, 'local_time', v_local, 'retry_at', v_retry); exit gate;
    end if;
    -- 5. frequency cap, marketing only, across channels and across merged contacts
    if p_kind = 'marketing' then
      select count(*) into v_n from public.message_sends m
        where m.contact_id in (select public.hub_contact_family(v_id)) and m.kind = 'marketing'
          and m.claimed_at > p_now - make_interval(days => (pol ->> 'cap_days')::int)
          and (m.status in ('sending','sent') or (v_mode = 'dry_run' and m.status = 'dry_run'));
      if v_n >= (pol ->> 'cap_count')::int then
        v_decision := 'deny'; v_step := 'frequency_cap'; v_reason := 'cap_reached';
        v_detail := jsonb_build_object('count', v_n, 'cap', (pol ->> 'cap_count')::int, 'days', (pol ->> 'cap_days')::int); exit gate;
      end if;
    end if;
    v_decision := 'allow'; v_step := 'all'; v_reason := 'passed';
  end gate;

  insert into public.send_log (org_id, contact_id, campaign_id, channel, kind, decision, mode, step, reason, detail)
  values (c.org_id, v_id, p_campaign, p_channel, p_kind, v_decision, v_mode, v_step, v_reason, v_detail);

  return jsonb_build_object('decision', v_decision, 'mode', v_mode, 'step', v_step, 'reason', v_reason,
                            'contact_id', v_id, 'org_id', c.org_id, 'to_address', v_addr,
                            'consent_event_id', cs ->> 'event_id') || v_detail;
end $$;

-- claim-then-send: returns the row id, or NULL when the slot is already taken
create function public.claim_send(
  p_contact uuid, p_channel text, p_kind text, p_dedupe_key text, p_source_kind text, p_source_id text,
  p_step_id text, p_mode text, p_to text, p_subject text, p_body text, p_consent_event uuid, p_snapshot jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_org uuid; v_row uuid;
begin
  if p_mode not in ('live','dry_run') then raise exception 'hub: bad mode %', p_mode; end if;
  v_id := public.hub_resolve_contact(p_contact);
  select c.org_id into v_org from public.contacts c where c.id = v_id;
  insert into public.message_sends (org_id, contact_id, channel, kind, source_kind, source_id, source_step_id, dedupe_key,
                                    to_address, status, dry_run, subject, rendered_body, consent_event_id, consent_snapshot)
  values (v_org, v_id, p_channel, p_kind, p_source_kind, p_source_id, p_step_id, p_dedupe_key, p_to,
          case when p_mode = 'live' then 'sending' else 'dry_run' end, p_mode <> 'live',
          p_subject, p_body, p_consent_event, coalesce(p_snapshot, '{}'::jsonb))
  on conflict do nothing
  returning id into v_row;
  return v_row;
end $$;

-- ─── Stage moves (ruling 4) ───────────────────────────────────────────────────
create function public.move_stage(p_contact uuid, p_stage uuid, p_actor uuid default null, p_source text default 'manual')
returns jsonb
language plpgsql security definer set search_path = '' as $$
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
end $$;

-- ─── The one enrollment engine (ruling 5, A14) ────────────────────────────────
create function public.enroll(p_contact uuid, p_campaign uuid, p_source_key text, p_event_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_org uuid; f record; v_row uuid; v_prior uuid; v_seq uuid;
begin
  if coalesce(p_source_key, '') = '' or coalesce(p_event_id, '') = '' then
    raise exception 'hub: source_key and event_id are required';
  end if;
  v_id := public.hub_resolve_contact(p_contact);
  select c.org_id into v_org from public.contacts c where c.id = v_id;
  if public.hub_flag(v_org, 'engine') <> 'on' then
    return jsonb_build_object('enrolled', false, 'reason', 'engine_off');
  end if;
  select x.* into f from public.funnel_campaigns x where x.id = p_campaign;
  if not found then raise exception 'hub: campaign % not found', p_campaign using errcode = 'P0002'; end if;
  if f.org_id <> v_org then raise exception 'hub: campaign and contact belong to different orgs' using errcode = '42501'; end if;
  if f.status <> 'active' then return jsonb_build_object('enrolled', false, 'reason', 'campaign_not_' || f.status); end if;

  -- the same event twice is the same enrollment
  select ce.id into v_row from public.campaign_enrollments ce
   where ce.contact_id = v_id and ce.campaign_id = p_campaign and ce.source_key = p_source_key and ce.event_id = p_event_id;
  if found then return jsonb_build_object('enrolled', false, 'reason', 'duplicate_event', 'enrollment_id', v_row); end if;

  -- a new event while already active in this campaign is recorded, and starts nothing
  select ce.id into v_prior from public.campaign_enrollments ce
   where ce.contact_id = v_id and ce.campaign_id = p_campaign and ce.status = 'active' limit 1;

  insert into public.campaign_enrollments (org_id, contact_id, campaign_id, source_key, event_id, status, duplicate_of)
  values (v_org, v_id, p_campaign, p_source_key, p_event_id,
          case when v_prior is null then 'active' else 'duplicate' end, v_prior)
  on conflict (contact_id, campaign_id, source_key, event_id) do nothing
  returning id into v_row;
  if v_row is null then
    return jsonb_build_object('enrolled', false, 'reason', 'duplicate_event_race');
  end if;
  if v_prior is not null then
    return jsonb_build_object('enrolled', false, 'reason', 'already_active', 'enrollment_id', v_row, 'active_enrollment_id', v_prior);
  end if;

  if f.entry_stage_id is not null then
    perform public.move_stage(v_id, f.entry_stage_id, null, 'campaign:' || f.id);
  end if;
  if f.sequence_id is not null then
    insert into public.sequence_enrollments (sequence_id, contact_id, current_step, status, next_step_at, campaign_enrollment_id)
    values (f.sequence_id, v_id, 0, 'active', now(), v_row) returning id into v_seq;
    update public.campaign_enrollments ce set sequence_enrollment_id = v_seq where ce.id = v_row;
  end if;

  insert into public.contact_timeline (org_id, contact_id, event_type, title, metadata, source_table, source_id)
  values (v_org, v_id, 'campaign_enrolled', 'Entered campaign ' || f.name,
          jsonb_build_object('campaign_id', f.id, 'source_key', p_source_key, 'event_id', p_event_id),
          'campaign_enrollments', v_row);
  return jsonb_build_object('enrolled', true, 'enrollment_id', v_row, 'contact_id', v_id, 'sequence_enrollment_id', v_seq);
end $$;

create function public.route_and_enroll(p_org uuid, p_contact uuid, p_source_key text, p_event_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; out jsonb := '[]'::jsonb;
begin
  if public.hub_flag(p_org, 'engine') <> 'on' then
    return jsonb_build_array(jsonb_build_object('enrolled', false, 'reason', 'engine_off'));
  end if;
  for r in select cr.campaign_id from public.campaign_routes cr
            where cr.org_id = p_org and cr.source_key = p_source_key and cr.active order by cr.priority, cr.created_at loop
    out := out || jsonb_build_array(public.enroll(p_contact, r.campaign_id, p_source_key, p_event_id)
                                    || jsonb_build_object('campaign_id', r.campaign_id));
  end loop;
  return out;
end $$;

-- ─── Intake contact write (ruling 12). Matches an existing live contact first. ─
create function public.hub_intake_contact(p_org uuid, p_email text, p_phone text, p_first text, p_last text,
                                          p_source_key text, p_utm jsonb default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid; e text := nullif(lower(btrim(p_email)), ''); ph text := nullif(btrim(p_phone), '');
begin
  if e is null and ph is null then raise exception 'hub: intake needs an email or a phone'; end if;
  select c.id into v from public.contacts c
   where c.org_id = p_org and c.merged_into_id is null and c.archived_at is null
     and ((e is not null and lower(btrim(c.email)) = e) or (e is null and ph is not null and btrim(c.phone) = ph))
   order by c.created_at limit 1;
  if v is not null then return v; end if;
  insert into public.contacts (org_id, first_name, last_name, email, phone, source, acquisition_source, acquisition_utm)
  values (p_org, coalesce(nullif(btrim(p_first), ''), 'Unknown'), coalesce(btrim(p_last), ''), e, ph,
          'hub_form', p_source_key, p_utm)
  returning id into v;
  return v;
end $$;

-- ─── University asset grants (ruling 11, A10) ─────────────────────────────────
create function public.grant_asset(p_contact uuid, p_asset uuid, p_token_hash bytea, p_ttl interval, p_send uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_org uuid; v_row uuid;
begin
  if p_ttl <= interval '0' or p_ttl > interval '30 days' then raise exception 'hub: asset link ttl must be within 30 days'; end if;
  v_id := public.hub_resolve_contact(p_contact);
  select c.org_id into v_org from public.contacts c where c.id = v_id;
  if public.hub_flag(v_org, 'deliver_asset') <> 'on' then return null; end if;
  if not exists (select 1 from public.university_assets a where a.id = p_asset and a.org_id = v_org and a.active) then
    raise exception 'hub: asset % is not an active asset of this org', p_asset using errcode = '42501';
  end if;
  insert into public.asset_grants (org_id, contact_id, asset_id, token_hash, expires_at, message_send_id)
  values (v_org, v_id, p_asset, p_token_hash, now() + p_ttl, p_send) returning id into v_row;
  return v_row;
end $$;

-- returns only the University path, never anything about the person
create function public.redeem_asset_grant(p_token_hash bytea, p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  select ag.id, ag.expires_at, a.path, a.active into g
    from public.asset_grants ag join public.university_assets a on a.id = ag.asset_id
   where ag.token_hash = p_token_hash;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if g.expires_at <= p_now then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if not g.active then return jsonb_build_object('ok', false, 'reason', 'asset_inactive'); end if;
  update public.asset_grants set redeem_count = redeem_count + 1, first_redeemed_at = coalesce(first_redeemed_at, p_now)
   where id = g.id;
  return jsonb_build_object('ok', true, 'path', g.path);
end $$;

-- ─── Function privileges (migration 031 posture): service_role only ───────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.hub_flag(uuid, text)', 'public.hub_send_policy(uuid)', 'public.hub_resolve_contact(uuid)',
    'public.hub_contact_family(uuid)', 'public.sync_pipelines_from_settings(uuid)',
    'public.record_consent(uuid, text, text, text, text, text, text, jsonb, uuid)',
    'public.consent_state(uuid, text, text)', 'public.gate_check(uuid, text, text, uuid, timestamptz)',
    'public.claim_send(uuid, text, text, text, text, text, text, text, text, text, text, uuid, jsonb)',
    'public.move_stage(uuid, uuid, uuid, text)', 'public.enroll(uuid, uuid, text, text)',
    'public.route_and_enroll(uuid, uuid, text, text)',
    'public.hub_intake_contact(uuid, text, text, text, text, text, jsonb)',
    'public.grant_asset(uuid, uuid, bytea, interval, uuid)', 'public.redeem_asset_grant(bytea, timestamptz)']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ============================================================================
-- DATA. Inserts only into tables created above.
-- ============================================================================

-- pipelines and stages for every org that has the legacy setting
select public.sync_pipelines_from_settings(s.org_id) from public.org_settings s where s.setting_key = 'crm_pipelines';

-- current positions, matched on the legacy pipeline key and the exact stage name
insert into public.contact_pipeline_positions (contact_id, org_id, pipeline_id, stage_id, source)
select c.id, c.org_id, p.id, s.id, 'backfill_211'
  from public.contacts c
  join public.pipelines p on p.org_id = c.org_id and p.legacy_key = c.pipeline_id
  join public.pipeline_stages s on s.pipeline_id = p.id and s.name = c.pipeline_stage and s.archived_at is null
 where c.merged_into_id is null
on conflict do nothing;

-- the two real SMS decisions (design §4.2.1, A15), with their original timestamps
insert into public.consent_events (org_id, contact_id, address, channel, kind, action, basis, source, text_shown, evidence, occurred_at)
select c.org_id, c.id, btrim(m.phone), 'sms', k, v.action, 'express_consent', 'import', null,
       jsonb_build_object('method', 'checkout', 'merged_row_id', m.id, 'imported_by', 'hub_211'),
       v.occurred_at
  from (values
          ('4cb236f6-30c8-4d24-a91a-9db786425cee'::uuid, '68099477-b7a6-4807-b339-6a89ab101c4e'::uuid, 'granted',
           '2026-07-14 07:30:57.093+00'::timestamptz, array['service']),
          ('5c661e5c-d7d6-495d-b1c9-436edc2b1fbe'::uuid, '9af172f5-7b77-4b79-be8d-7ddb040d912c'::uuid, 'revoked',
           '2026-07-15 20:43:44.094+00'::timestamptz, array['service','marketing'])
       ) as v(survivor, merged, action, occurred_at, kinds)
  join public.contacts c on c.id = v.survivor
  join public.contacts m on m.id = v.merged and m.merged_into_id = v.survivor
  cross join lateral unnest(v.kinds) as k;

-- the live-send allowlist: Cameron's own email and the phone on his Hub profile
insert into public.campaign_test_contacts (org_id, email, phone, label)
select '00000000-0000-0000-0000-000000000001', lower(p.email), nullif(btrim(p.phone), ''), 'Cameron Allen (owner)'
  from public.profiles p where p.id = '22456608-5f7d-495e-af02-7037fea125cc';
