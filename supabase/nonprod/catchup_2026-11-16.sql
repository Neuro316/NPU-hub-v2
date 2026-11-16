-- supabase/nonprod/catchup_2026-11-16.sql
--
-- STATUS: PROPOSED, NOT APPLIED. For nonprod (cpasntagxhxitavivwlb) ONLY. Never run this on production
-- (htfrfaxlcuyawtlztxxm): production already has every object here, plus the data this file leaves out.
-- Applied from the Hub chat on Shane's or Cameron's go, like any migration.
--
-- PURPOSE: bring nonprod's Hub schema level with production. Nonprod's ledger has hub_211 to hub_213 only;
-- production has hub_214 to hub_231 and hub_233. This file is the SCHEMA part of those migrations, in
-- production ledger order, with every seed, backfill and row write naming a specific org, user, contact or
-- setting row removed. Each section lists what it removed and the original file's line numbers. Every kept
-- statement is copied byte for byte from supabase/migrations/hub_NNN_*.sql; the only edits are
-- "on conflict (id) do nothing" on the two storage bucket rows, and dropping each file's own begin/commit.
--
-- EXCLUDED (not applied to production, so not part of a catch-up; each goes nonprod first on its own go):
--   hub_232_org_settings_lockdown  proposed, revised on PR #44 (fix/team-profiles-lockdown), applied nowhere
--   hub_234_scheduling_agent       on the open branch feat/scheduling-agent-phase3 (PR #46), applied nowhere
--   hub_235_metric_targets_direction  on the open branch feat/metrics-targets (PR #47), applied nowhere
--   hub_236_mail_sent_metadata     merged to main (#48) but absent from the production ledger
--
-- PRE-CHECK, read only on nonprod 2026-11-16 (information_schema / pg_catalog / storage.buckets):
--   NOTE: no BLOCKER found. Every table, view, function, constraint, trigger, column and extension the kept
--         statements reference but do not create exists on nonprod (contacts, organizations, org_settings,
--         contact_timeline, auth.users, consent_events, send_log, message_sends, suppressions,
--         do_not_contact_list, campaign_test_contacts, funnel_campaigns, entry_events, pipelines (legacy_key),
--         pipeline_stages, contact_pipeline_positions, contact_merge_log, campaign_routes, campaign_enrollments,
--         sequence_enrollments, contact_interaction_score, enrollments, entitlements, payments, profiles,
--         programs, nr_bookings, nr_booking_leads, hub_team_org_ids, hub_resolve_contact, hub_contact_family,
--         consent_state, hub_send_policy, hub_flag, gate_check, update_updated_at, hub_intake_contact (same
--         signature), sync_pipelines_from_settings, raise_entry_event, hub_slug, move_stage,
--         merge_contact_repoint, hub_contacts_entry_events, trigger trg_pipeline_timeline, supabase_vault 0.3.1).
--   NOTE: none of the objects this file creates exists on nonprod yet (21 tables, the new functions, the
--         hub-resources and lead-devices buckets).
--   NOTE: consent_events_basis_check, consent_events_check and entry_events_origin_check on nonprod match the
--         hub_211/hub_212 definitions that hub_225 and hub_231 drop and recreate.
--   NOTE: the three views hub_229 replaces (attribution_effectiveness, contact_lifecycle_summary, ecr_records)
--         have the column lists hub_229 expects; contact_lifecycle_summary gains pipeline_id at the end.
--   NOTE: hub_219 drops hub_sched_recurring_blocks_check2, the auto-generated name of hub_218's third table
--         check. It does not exist on nonprod today and is created by the hub_218 section above it.
--   NOTE: hub_215 and hub_224 are skipped as a pair (create then drop of the Quick Send tables). Nonprod ends
--         with the same schema as production either way, and skipping avoids hub_224's org_settings delete.
--   NOTE: hub_229's one-off sync_pipelines_from_settings call for every org is cut (it writes rows). Its
--         rewritten hub_org_settings_pipeline_sync trigger syncs an org on that org's next crm_pipelines save.
--   NOTE: hub_221 and hub_227 are data only, so their sections are empty.
--
-- RE-RUNNING: the whole file is one transaction. A failure anywhere leaves nonprod unchanged, so there is
-- nothing partial to clean up. It is not written to be re-run after a success: guards such as
-- "create table if not exists" would hide a drifted object instead of failing on it.
--
-- LEDGER: this file writes no supabase_migrations rows. If the Hub chat wants nonprod's ledger to show
-- hub_214..hub_233, it records them separately; that is its call.
--
-- ROLLBACK (nonprod only; reverse order; buckets must be empty first):
--   begin;
--   drop function if exists public.hub_org_vault_put(uuid, text, text, text), public.hub_org_vault_get(uuid, text),
--     public.hub_org_vault_field_ok(text, text);
--   drop table if exists public.hub_lead_alerts;
--   alter table public.entry_events drop constraint entry_events_origin_check;
--   alter table public.entry_events add constraint entry_events_origin_check
--     check (origin in ('stage','tag','contact_tag','call','import'));
--   drop function if exists public.hub_purge_test_submission_identity(integer);
--   -- hub_229 objects: drop triggers hub_contacts_legacy_pipeline_write and hub_positions_changed, their
--   -- functions, hub_pipeline_legacy_mirror, hub_pipeline_set_stage, hub_pipeline_remove, hub_pipeline_place,
--   -- hub_pipeline_legacy_unmapped; recreate trg_pipeline_timeline, and restore move_stage,
--   -- hub_contacts_entry_events, hub_org_settings_pipeline_sync, merge_contact_repoint and the three views
--   -- from nonprod's current definitions (capture them with pg_get_functiondef / pg_get_viewdef before applying)
--   drop function if exists public.hub_contact_facts(uuid), public.hub_lead_device_contact(uuid, text, text, text, text, text, jsonb);
--   alter function public.hub_intake_contact(uuid, text, text, text, text, text, jsonb) set search_path to '';
--   drop table if exists public.lead_device_events, public.lead_device_submissions;
--   alter table public.lead_devices drop constraint if exists lead_devices_live_version_fk;
--   drop table if exists public.lead_device_versions, public.lead_devices;
--   delete from storage.buckets where id in ('lead-devices', 'hub-resources');
--   drop function if exists public.hub_contact_is_blocked_test_record(uuid), public.hub_contact_has_real_dnc(uuid),
--     public.hub_texting_allowed(uuid), public.hub_email_marketing_allowed(uuid), public.hub_current_client_reasons(uuid);
--   -- restore gate_check from nonprod's current definition (hub_211), captured before applying
--   alter table public.funnel_campaigns drop column if exists smart_list_id, drop column if exists brand;
--   drop table if exists public.smart_lists;
--   drop index if exists public.consent_events_backfill_once;
--   -- restore consent_events_basis_check and consent_events_check to the hub_211 definitions (see hub_225's header)
--   drop table if exists public.hub_metric_alerts, public.hub_metric_exclusions, public.hub_metric_targets,
--     public.hub_metrics_daily, public.hub_resource_sends, public.hub_resources, public.hub_booking_syncs;
--   drop function if exists public.hub_sched_check(uuid, text, timestamptz, timestamptz),
--     public.hub_sched_recurring_blocked(uuid, text, date, time, time);
--   drop table if exists public.hub_sched_recurring_block_days, public.hub_sched_exception_requests,
--     public.hub_sched_reply_rules, public.hub_sched_trusted_senders, public.hub_sched_one_off_blocks,
--     public.hub_sched_recurring_overrides, public.hub_sched_recurring_blocks, public.hub_sched_kids_home_dates,
--     public.hub_sched_blocked_windows, public.hub_sched_category_windows, public.hub_sched_settings;
--   drop function if exists public.hub_sched_reply_rules_owner_check();
--   drop table if exists public.hub_mail_messages, public.hub_mail_connections;  -- the delete trigger removes Vault rows
--   drop function if exists public.hub_mail_connection_put(uuid, uuid, text, text, text[]),
--     public.hub_mail_token_get(uuid), public.hub_mail_connection_revoke(uuid), public.hub_mail_connections_drop_secret();
--   drop table if exists public.hub_pipeline_deals;
--   commit;
--   notify pgrst, 'reload schema';

begin;

-- ===== hub_214_pipeline_deals =====
-- removed:
--   backfill insert into hub_pipeline_deals from contacts/org_settings/contact_timeline (lines 77-143)

create table public.hub_pipeline_deals (
  org_id           uuid not null,
  contact_id       uuid not null references public.contacts(id) on delete cascade,
  pipeline_key     text not null check (length(pipeline_key) between 1 and 200),
  value            numeric(12,2) check (value is null or (value >= 0 and value < 10000000000)),
  entered_at       timestamptz not null default now(),
  stage_changed_at timestamptz not null default now(),
  won_at           timestamptz,
  lost_at          timestamptz,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  primary key (contact_id, pipeline_key),
  check (won_at is null or lost_at is null)
);

create index hub_pipeline_deals_org_pipeline on public.hub_pipeline_deals (org_id, pipeline_key);

alter table public.hub_pipeline_deals enable row level security;
revoke all on public.hub_pipeline_deals from anon;
revoke insert, update, delete, truncate, references, trigger on public.hub_pipeline_deals from authenticated;
grant select on public.hub_pipeline_deals to authenticated;
create policy hub_pipeline_deals_staff_read on public.hub_pipeline_deals for select to authenticated
  using (org_id in (select public.hub_team_org_ids()));
grant all on public.hub_pipeline_deals to service_role;

comment on table public.hub_pipeline_deals is
  'Lead value and close timing for one contact''s placement in one CRM pipeline (pipeline_key = '
  'stable pipeline id from org_settings.crm_pipelines = contacts.pipeline_id). value NULL means no value. '
  'won_at/lost_at follow the stage''s is_closed_won/is_closed_lost flags. Staff read by org; '
  'writes are service_role only via POST /api/crm/pipeline-deals.';

-- ===== hub_215_quick_send =====
-- removed:
--   whole file skipped: hub_224 drops every object it creates (see hub_224 below); net schema effect is nil
-- (no statements kept)

-- ===== hub_216_mail_connections =====
-- removed:
--   nothing (schema and functions only)

create table public.hub_mail_connections (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  owner_user_id    uuid not null references auth.users(id) on delete cascade,
  email_address    text not null unique
                   check (email_address = lower(email_address) and email_address like '%@neuroprogeny.com'),
  visibility       text not null default 'private' check (visibility in ('private', 'shared')),
  vault_secret_id  uuid,
  scopes           text[] not null default '{}',
  status           text not null default 'active' check (status in ('active', 'revoked', 'error')),
  connected_at     timestamptz not null default now(),
  last_checked_at  timestamptz,
  last_error       text check (last_error is null or length(last_error) <= 300),
  check (status = 'revoked' or vault_secret_id is not null)
);

create index hub_mail_connections_owner on public.hub_mail_connections (owner_user_id);
create index hub_mail_connections_org on public.hub_mail_connections (org_id);

alter table public.hub_mail_connections enable row level security;
revoke all on public.hub_mail_connections from public, anon, authenticated;
grant all on public.hub_mail_connections to service_role;

comment on table public.hub_mail_connections is
  'Gmail mailboxes connected through Google OAuth (inbox agent phase 1). Refresh token is in '
  'Vault only (vault_secret_id). private = owner only; shared = superadmins of org_id. '
  'service_role only via /api/mail/*.';

-- ─── put: create or reconnect, writing the refresh token to Vault ────────────
-- Raises 'mailbox_owned_by_other' when the address is live (active or error) under
-- another user, so one user can never take over another user's mailbox.
-- A revoked row may be claimed by whoever reconnects it; it resets to private.
create function public.hub_mail_connection_put(
  p_org_id uuid, p_owner uuid, p_email text, p_secret text, p_scopes text[]
) returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_email     text := lower(trim(p_email));
  v_row       public.hub_mail_connections%rowtype;
  v_id        uuid;
  v_secret_id uuid;
begin
  if p_secret is null or length(p_secret) = 0 then
    raise exception 'mailbox_secret_missing';
  end if;

  select * into v_row from public.hub_mail_connections c where c.email_address = v_email for update;

  if found and v_row.status <> 'revoked' and v_row.owner_user_id <> p_owner then
    raise exception 'mailbox_owned_by_other';
  end if;

  v_id := coalesce(v_row.id, gen_random_uuid());
  v_secret_id := v_row.vault_secret_id;

  if v_secret_id is null then
    select s.id into v_secret_id from vault.secrets s where s.name = 'hub_mail_connection:' || v_id::text;
  end if;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_secret, 'hub_mail_connection:' || v_id::text,
      'Gmail refresh token for hub_mail_connections ' || v_id::text || ' (hub_216)');
  else
    perform vault.update_secret(v_secret_id, p_secret);
  end if;

  if v_row.id is null then
    insert into public.hub_mail_connections
      (id, org_id, owner_user_id, email_address, vault_secret_id, scopes, status, connected_at)
    values
      (v_id, p_org_id, p_owner, v_email, v_secret_id, coalesce(p_scopes, '{}'), 'active', now());
  else
    update public.hub_mail_connections c
       set org_id          = p_org_id,
           owner_user_id   = p_owner,
           visibility      = case when v_row.owner_user_id = p_owner then c.visibility else 'private' end,
           vault_secret_id = v_secret_id,
           scopes          = coalesce(p_scopes, '{}'),
           status          = 'active',
           connected_at    = now(),
           last_error      = null
     where c.id = v_id;
  end if;

  return v_id;
end
$function$;

-- ─── get: the refresh token, for a live connection only ─────────────────────
create function public.hub_mail_token_get(p_connection_id uuid)
returns text
language sql
stable
set search_path to ''
as $function$
  select s.decrypted_secret
    from vault.decrypted_secrets s
    join public.hub_mail_connections c on c.vault_secret_id = s.id
   where c.id = p_connection_id
     and c.status <> 'revoked'
$function$;

-- ─── revoke: delete the Vault secret and mark the row revoked ───────────────
create function public.hub_mail_connection_revoke(p_connection_id uuid)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  v_secret_id uuid;
begin
  select c.vault_secret_id into v_secret_id
    from public.hub_mail_connections c where c.id = p_connection_id for update;

  update public.hub_mail_connections c
     set status = 'revoked', vault_secret_id = null, last_error = null
   where c.id = p_connection_id;

  if v_secret_id is not null then
    delete from vault.secrets s where s.id = v_secret_id;
  end if;
end
$function$;

-- ─── a deleted row (including an auth.users cascade) takes its secret with it ─
-- SECURITY DEFINER: a user deletion cascades from auth.users and runs as the auth
-- admin role, which has no vault access; as invoker this trigger would make every
-- Hub user deletion fail. Owned by the migration role (postgres), which does.
create function public.hub_mail_connections_drop_secret()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if old.vault_secret_id is not null then
    delete from vault.secrets s where s.id = old.vault_secret_id;
  end if;
  return old;
end
$function$;

create trigger hub_mail_connections_drop_secret
  after delete on public.hub_mail_connections
  for each row execute function public.hub_mail_connections_drop_secret();

revoke all on function public.hub_mail_connection_put(uuid, uuid, text, text, text[]) from public, anon, authenticated;
revoke all on function public.hub_mail_token_get(uuid) from public, anon, authenticated;
revoke all on function public.hub_mail_connection_revoke(uuid) from public, anon, authenticated;
revoke all on function public.hub_mail_connections_drop_secret() from public, anon, authenticated;
grant execute on function public.hub_mail_connection_put(uuid, uuid, text, text, text[]) to service_role;
grant execute on function public.hub_mail_token_get(uuid) to service_role;
grant execute on function public.hub_mail_connection_revoke(uuid) to service_role;

-- ===== hub_217_mail_triage =====
-- removed:
--   nothing (schema only)

alter table public.hub_mail_connections
  add column gmail_history_id text check (gmail_history_id is null or gmail_history_id ~ '^[0-9]{1,30}$'),
  add column last_synced_at   timestamptz;

create table public.hub_mail_messages (
  id                 uuid primary key default gen_random_uuid(),
  connection_id      uuid not null references public.hub_mail_connections(id) on delete cascade,
  gmail_message_id   text not null check (gmail_message_id ~ '^[0-9a-f]{1,32}$'),
  gmail_thread_id    text not null check (gmail_thread_id ~ '^[0-9a-f]{1,32}$'),
  from_address       text check (from_address is null or length(from_address) <= 320),
  from_name          text check (from_name is null or length(from_name) <= 200),
  subject            text check (subject is null or length(subject) <= 500),
  received_at        timestamptz,
  category           text check (category is null or category in (
                       'scheduling', 'lead', 'participant_support', 'partner_outreach',
                       'personal', 'legal_financial', 'clinical', 'vendor_billing',
                       'security_alert', 'newsletter', 'spam')),
  priority           text check (priority is null or priority in ('urgent', 'normal', 'low')),
  summary            text check (summary is null or length(summary) <= 300),
  suggested_action   text check (suggested_action is null or length(suggested_action) <= 300),
  status             text not null default 'new' check (status in ('new', 'seen', 'done')),
  triaged_at         timestamptz,
  triage_attempts    smallint not null default 0 check (triage_attempts between 0 and 10),
  triage_error       text check (triage_error is null or length(triage_error) <= 300),
  created_at         timestamptz not null default now(),
  unique (connection_id, gmail_message_id)
);

-- the inbox list (newest first per mailbox) and the triage queue (oldest waiting first)
create index hub_mail_messages_list on public.hub_mail_messages (connection_id, received_at desc nulls last);
create index hub_mail_messages_queue on public.hub_mail_messages (connection_id, created_at)
  where triaged_at is null and triage_attempts < 3;

alter table public.hub_mail_messages enable row level security;
revoke all on public.hub_mail_messages from public, anon, authenticated;
grant all on public.hub_mail_messages to service_role;

comment on table public.hub_mail_messages is
  'New INBOX messages from connected Gmail mailboxes with AI triage (inbox agent phase 2). '
  'Metadata and AI summary only, never bodies. Visibility follows hub_mail_connections. '
  'service_role only via /api/cron/mail-sync and /api/mail/messages.';

-- ===== hub_218_scheduling_rules =====
-- removed:
--   seed DO block for one owner (settings, category windows, blocked window, kids-home dates, recurring block, reply rules) (lines 389-442)

create table public.hub_sched_settings (
  owner_user_id    uuid primary key references auth.users(id) on delete cascade,
  timezone         text not null default 'America/New_York' check (length(timezone) between 1 and 64),
  earliest_start   time not null default '08:00',
  -- weekdays after this date are 'summer' days; NULL means no school year is set
  school_year_end  date,
  updated_at       timestamptz not null default now()
);

-- ─── category windows: when each category may be booked, by kind of day ──────
-- day_kind: school (weekday, not a kids-home day), kids_home, weekend, summer
create table public.hub_sched_category_windows (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  category       text not null check (category in ('one_on_one', 'podcast', 'in_person', 'group_coaching', 'team_familiar')),
  day_kind       text not null check (day_kind in ('school', 'kids_home', 'weekend', 'summer')),
  start_time     time not null,
  end_time       time not null,
  check (end_time > start_time)
);
create index hub_sched_category_windows_owner on public.hub_sched_category_windows (owner_user_id, category, day_kind);

-- ─── blocked windows: daily blocks by kind of day (e.g. kindergarten pickup) ─
create table public.hub_sched_blocked_windows (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  day_kind       text not null check (day_kind in ('school', 'kids_home', 'weekend', 'summer')),
  start_time     time not null,
  end_time       time not null,
  label          text not null check (length(label) between 1 and 120),
  categories     text[] check (categories is null or (cardinality(categories) > 0 and categories <@ array['one_on_one', 'podcast', 'in_person', 'group_coaching', 'team_familiar'])),
  check (end_time > start_time)
);
create index hub_sched_blocked_windows_owner on public.hub_sched_blocked_windows (owner_user_id, day_kind);

-- ─── kids-home dates: from_time NULL = whole day, else kids home from that time ─
create table public.hub_sched_kids_home_dates (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  date           date not null,
  from_time      time,
  label          text not null default '' check (length(label) <= 120),
  source         text not null default 'manual' check (source ~ '^[a-z0-9_]{1,40}$'),
  unique (owner_user_id, date)
);

-- ─── recurring blocks (every N weeks on a weekday) and their per-date overrides ─
create table public.hub_sched_recurring_blocks (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references auth.users(id) on delete cascade,
  name            text not null check (length(name) between 1 and 120),
  active          boolean not null default false,
  anchor_date     date,
  interval_weeks  smallint not null default 1 check (interval_weeks between 1 and 52),
  weekday         smallint not null check (weekday between 1 and 7),   -- ISO: 1 = Monday
  start_time      time,
  end_time        time,
  categories      text[] check (categories is null or (cardinality(categories) > 0 and categories <@ array['one_on_one', 'podcast', 'in_person', 'group_coaching', 'team_familiar'])),
  unique (id, owner_user_id),
  check (end_time is null or start_time is null or end_time > start_time),
  check (anchor_date is null or extract(isodow from anchor_date) = weekday),
  check (not active or (anchor_date is not null and start_time is not null and end_time is not null))
);

-- skip: no occurrence that date. add / change: an occurrence that date, with these
-- times (or the block's own when NULL). Overrides of an inactive block do nothing.
create table public.hub_sched_recurring_overrides (
  id             uuid primary key default gen_random_uuid(),
  block_id       uuid not null,
  owner_user_id  uuid not null,
  date           date not null,
  kind           text not null check (kind in ('skip', 'add', 'change')),
  start_time     time,
  end_time       time,
  foreign key (block_id, owner_user_id) references public.hub_sched_recurring_blocks (id, owner_user_id) on delete cascade,
  unique (block_id, date),
  check (end_time is null or start_time is null or end_time > start_time),
  check (kind <> 'change' or (start_time is not null and end_time is not null))
);

-- ─── one-off blocks (page today; sms / slack / agent in a later phase) ───────
create table public.hub_sched_one_off_blocks (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  label          text not null default '' check (length(label) <= 200),
  categories     text[] check (categories is null or (cardinality(categories) > 0 and categories <@ array['one_on_one', 'podcast', 'in_person', 'group_coaching', 'team_familiar'])),
  source         text not null default 'page' check (source in ('page', 'sms', 'slack', 'agent')),
  created_by     text not null default '' check (length(created_by) <= 200),
  created_at     timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index hub_sched_one_off_blocks_owner on public.hub_sched_one_off_blocks (owner_user_id, starts_at);

-- ─── trusted senders (managed by the owner; no inbound handling in this build) ─
create table public.hub_sched_trusted_senders (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references auth.users(id) on delete cascade,
  display_name    text not null check (length(display_name) between 1 and 120),
  channel         text not null check (channel in ('sms', 'slack')),
  sender_address  text not null,
  permission      text not null default 'block_only' check (permission in ('block_only', 'block_and_reschedule')),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (owner_user_id, channel, sender_address),
  check ((channel = 'sms' and sender_address ~ '^\+[1-9][0-9]{6,14}$')
      or (channel = 'slack' and sender_address ~ '^[UW][A-Z0-9]{6,20}$'))
);

-- ─── reply rules: one per mailbox, only for mailboxes the owner connected ────
create table public.hub_sched_reply_rules (
  id                       uuid primary key default gen_random_uuid(),
  owner_user_id            uuid not null references auth.users(id) on delete cascade,
  connection_id            uuid not null unique references public.hub_mail_connections(id) on delete cascade,
  reply_from               text not null check (reply_from = lower(reply_from) and reply_from like '%@neuroprogeny.com'),
  mode                     text not null default 'draft_only' check (mode in ('draft_only', 'auto_send')),
  always_draft_categories  text[] not null default '{}' check (always_draft_categories <@ array[
                             'scheduling', 'lead', 'participant_support', 'partner_outreach', 'personal',
                             'legal_financial', 'clinical', 'vendor_billing', 'security_alert', 'newsletter', 'spam']),
  voice_note               text not null default '' check (length(voice_note) <= 2000),
  updated_at               timestamptz not null default now()
);

create function public.hub_sched_reply_rules_owner_check()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if not exists (select 1 from public.hub_mail_connections c
                  where c.id = new.connection_id and c.owner_user_id = new.owner_user_id) then
    raise exception 'reply_rule_mailbox_not_owned';
  end if;
  return new;
end
$function$;

create trigger hub_sched_reply_rules_owner_check
  before insert or update on public.hub_sched_reply_rules
  for each row execute function public.hub_sched_reply_rules_owner_check();

-- ─── exception requests: anything outside the rules waits for the owner ──────
create table public.hub_sched_exception_requests (
  id                   uuid primary key default gen_random_uuid(),
  owner_user_id        uuid not null references auth.users(id) on delete cascade,
  category             text not null check (category in ('one_on_one', 'podcast', 'in_person', 'group_coaching', 'team_familiar')),
  requested_starts_at  timestamptz not null,
  requested_ends_at    timestamptz not null,
  requester_name       text not null default '' check (length(requester_name) <= 200),
  requester_email      text not null default '' check (length(requester_email) <= 320),
  note                 text not null default '' check (length(note) <= 2000),
  source               text not null default 'platform' check (source in ('platform', 'hub', 'agent')),
  check_reason         text check (check_reason is null or length(check_reason) <= 60),
  status               text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'booked', 'cancelled')),
  decided_at           timestamptz,
  booking_ref          text check (booking_ref is null or length(booking_ref) <= 200),
  created_at           timestamptz not null default now(),
  check (requested_ends_at > requested_starts_at)
);
create index hub_sched_exception_requests_owner on public.hub_sched_exception_requests (owner_user_id, status, created_at desc);

-- ─── access: service role only ───────────────────────────────────────────────
alter table public.hub_sched_settings enable row level security;
alter table public.hub_sched_category_windows enable row level security;
alter table public.hub_sched_blocked_windows enable row level security;
alter table public.hub_sched_kids_home_dates enable row level security;
alter table public.hub_sched_recurring_blocks enable row level security;
alter table public.hub_sched_recurring_overrides enable row level security;
alter table public.hub_sched_one_off_blocks enable row level security;
alter table public.hub_sched_trusted_senders enable row level security;
alter table public.hub_sched_reply_rules enable row level security;
alter table public.hub_sched_exception_requests enable row level security;

revoke all on public.hub_sched_settings, public.hub_sched_category_windows, public.hub_sched_blocked_windows,
  public.hub_sched_kids_home_dates, public.hub_sched_recurring_blocks, public.hub_sched_recurring_overrides,
  public.hub_sched_one_off_blocks, public.hub_sched_trusted_senders, public.hub_sched_reply_rules,
  public.hub_sched_exception_requests
  from public, anon, authenticated;
grant all on public.hub_sched_settings, public.hub_sched_category_windows, public.hub_sched_blocked_windows,
  public.hub_sched_kids_home_dates, public.hub_sched_recurring_blocks, public.hub_sched_recurring_overrides,
  public.hub_sched_one_off_blocks, public.hub_sched_trusted_senders, public.hub_sched_reply_rules,
  public.hub_sched_exception_requests
  to service_role;
revoke all on function public.hub_sched_reply_rules_owner_check() from public, anon, authenticated;

-- ─── the check ───────────────────────────────────────────────────────────────
-- Reason codes, in the order they are tested (first failure wins):
--   invalid_request         missing owner/time, end <= start, unknown category
--   no_rules_set            the owner has no category windows at all
--   spans_days              start and end fall on different local dates
--   before_earliest_start   local start is before settings.earliest_start (08:00 default)
--   summer_rules_undefined  a weekday after school_year_end and no 'summer' windows exist
--   one_off_block           overlaps a one-off block that applies to the category
--   recurring_block         overlaps an occurrence of an active recurring block
--   blocked_window          overlaps a daily blocked window for that kind of day
--   kids_home               a kids-home day (or the part after from_time) and the
--                           category has no kids_home windows
--   weekend                 a weekend and the category has no weekend windows
--   outside_window          not inside one window for the category and kind of day
--   ok                      allowed
-- A half day (from_time set) is checked in two parts: before from_time as a school day,
-- from from_time as a kids-home day. A booking must sit inside ONE window per part.
create function public.hub_sched_check(
  p_owner uuid, p_category text, p_starts_at timestamptz, p_ends_at timestamptz,
  out allowed boolean, out reason text
)
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_tz        text;
  v_earliest  time;
  v_year_end  date;
  v_ls        timestamp;
  v_le        timestamp;
  v_d         date;
  v_st        time;
  v_et        time;
  v_dow       int;
  v_from      time;
  v_kh_found  boolean;
  v_kinds     text[] := '{}';
  v_ss        time[] := '{}';
  v_es        time[] := '{}';
  i           int;
begin
  allowed := false;

  if p_owner is null or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or p_category is null
     or p_category not in ('one_on_one', 'podcast', 'in_person', 'group_coaching', 'team_familiar') then
    reason := 'invalid_request'; return;
  end if;

  if not exists (select 1 from public.hub_sched_category_windows w where w.owner_user_id = p_owner) then
    reason := 'no_rules_set'; return;
  end if;

  select s.timezone, s.earliest_start, s.school_year_end
    into v_tz, v_earliest, v_year_end
    from public.hub_sched_settings s where s.owner_user_id = p_owner;
  v_tz := coalesce(v_tz, 'America/New_York');
  v_earliest := coalesce(v_earliest, '08:00'::time);

  v_ls := p_starts_at at time zone v_tz;
  v_le := p_ends_at at time zone v_tz;
  v_d := v_ls::date;
  v_st := v_ls::time;
  v_et := v_le::time;
  v_dow := extract(isodow from v_d)::int;

  if v_le::date <> v_d then reason := 'spans_days'; return; end if;
  if v_st < v_earliest then reason := 'before_earliest_start'; return; end if;

  -- the kind of day, split into parts on a half day
  if v_dow >= 6 then
    v_kinds := array['weekend']; v_ss := array[v_st]; v_es := array[v_et];
  elsif v_year_end is not null and v_d > v_year_end then
    if not exists (select 1 from public.hub_sched_category_windows w
                    where w.owner_user_id = p_owner and w.day_kind = 'summer') then
      reason := 'summer_rules_undefined'; return;
    end if;
    v_kinds := array['summer']; v_ss := array[v_st]; v_es := array[v_et];
  else
    select true, k.from_time into v_kh_found, v_from
      from public.hub_sched_kids_home_dates k
     where k.owner_user_id = p_owner and k.date = v_d;
    if v_kh_found is null then
      v_kinds := array['school']; v_ss := array[v_st]; v_es := array[v_et];
    elsif v_from is null then
      v_kinds := array['kids_home']; v_ss := array[v_st]; v_es := array[v_et];
    else
      if v_st < v_from then
        v_kinds := v_kinds || 'school'::text; v_ss := v_ss || v_st; v_es := v_es || least(v_et, v_from);
      end if;
      if v_et > v_from then
        v_kinds := v_kinds || 'kids_home'::text; v_ss := v_ss || greatest(v_st, v_from); v_es := v_es || v_et;
      end if;
    end if;
  end if;

  if exists (select 1 from public.hub_sched_one_off_blocks b
              where b.owner_user_id = p_owner
                and (b.categories is null or p_category = any (b.categories))
                and b.starts_at < p_ends_at and b.ends_at > p_starts_at) then
    reason := 'one_off_block'; return;
  end if;

  if exists (
    select 1
      from public.hub_sched_recurring_blocks b
      left join public.hub_sched_recurring_overrides o on o.block_id = b.id and o.date = v_d
     where b.owner_user_id = p_owner
       and b.active
       and (b.categories is null or p_category = any (b.categories))
       and (
             (o.id is not null and o.kind in ('add', 'change'))
          or (o.id is null and b.weekday = v_dow and ((v_d - b.anchor_date) % (7 * b.interval_weeks)) = 0)
           )
       and coalesce(o.start_time, b.start_time) < v_et
       and coalesce(o.end_time, b.end_time) > v_st
  ) then
    reason := 'recurring_block'; return;
  end if;

  for i in 1 .. coalesce(array_length(v_kinds, 1), 0) loop
    if exists (select 1 from public.hub_sched_blocked_windows b
                where b.owner_user_id = p_owner and b.day_kind = v_kinds[i]
                  and (b.categories is null or p_category = any (b.categories))
                  and b.start_time < v_es[i] and b.end_time > v_ss[i]) then
      reason := 'blocked_window'; return;
    end if;
  end loop;

  for i in 1 .. coalesce(array_length(v_kinds, 1), 0) loop
    if not exists (select 1 from public.hub_sched_category_windows w
                    where w.owner_user_id = p_owner and w.category = p_category and w.day_kind = v_kinds[i]
                      and w.start_time <= v_ss[i] and w.end_time >= v_es[i]) then
      if v_kinds[i] in ('kids_home', 'weekend')
         and not exists (select 1 from public.hub_sched_category_windows w
                          where w.owner_user_id = p_owner and w.category = p_category and w.day_kind = v_kinds[i]) then
        reason := v_kinds[i];
      else
        reason := 'outside_window';
      end if;
      return;
    end if;
  end loop;

  allowed := true;
  reason := 'ok';
end
$function$;

revoke all on function public.hub_sched_check(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.hub_sched_check(uuid, text, timestamptz, timestamptz) to service_role;

-- ===== hub_219_recurring_spans =====
-- removed:
--   update public.hub_sched_recurring_blocks converting existing rows (lines 83-87); the table is empty on nonprod because the hub_218 seed is cut

alter table public.hub_sched_recurring_blocks rename column weekday to from_weekday;

alter table public.hub_sched_recurring_blocks
  add column repeat        text,
  add column to_weekday    smallint,
  add column days          smallint[] not null default '{1,2,3,4,5,6,7}',
  add column all_day       boolean not null default false,
  add column per_day_times boolean not null default false;

alter table public.hub_sched_recurring_blocks
  alter column repeat set not null,
  alter column repeat set default 'weekly',
  alter column to_weekday set not null,
  alter column to_weekday set default 7,
  add constraint hub_sched_recurring_blocks_to_weekday_check check (to_weekday between 1 and 7),
  add constraint hub_sched_recurring_blocks_repeat_check check (
       (repeat = 'weekly' and interval_weeks = 1)
    or (repeat = 'every_other_week' and interval_weeks = 2)
    or (repeat = 'custom' and interval_weeks between 1 and 52)),
  add constraint hub_sched_recurring_blocks_days_check check (
    cardinality(days) between 1 and 7 and days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  add constraint hub_sched_recurring_blocks_times_check check (
    not all_day or (start_time is null and end_time is null));

-- "active needs an anchor and times" now allows all-day and per-day times
alter table public.hub_sched_recurring_blocks drop constraint hub_sched_recurring_blocks_check2;
alter table public.hub_sched_recurring_blocks
  add constraint hub_sched_recurring_blocks_active_check check (
    not active or (anchor_date is not null
                   and (all_day or per_day_times or (start_time is not null and end_time is not null))));

-- ─── per-day times (per span offset) ─────────────────────────────────────────
create table public.hub_sched_recurring_block_days (
  block_id       uuid not null,
  owner_user_id  uuid not null,
  span_offset    smallint not null check (span_offset between 0 and 7),
  all_day        boolean not null default false,
  start_time     time,
  end_time       time,
  primary key (block_id, span_offset),
  foreign key (block_id, owner_user_id) references public.hub_sched_recurring_blocks (id, owner_user_id) on delete cascade,
  check ((all_day and start_time is null and end_time is null)
      or (not all_day and start_time is not null and end_time is not null and end_time > start_time))
);

alter table public.hub_sched_recurring_block_days enable row level security;
revoke all on public.hub_sched_recurring_block_days from public, anon, authenticated;
grant all on public.hub_sched_recurring_block_days to service_role;

-- ─── overrides: span-level kinds ─────────────────────────────────────────────
alter table public.hub_sched_recurring_overrides drop constraint hub_sched_recurring_overrides_kind_check;
alter table public.hub_sched_recurring_overrides drop constraint hub_sched_recurring_overrides_block_id_date_key;
alter table public.hub_sched_recurring_overrides
  add column scope text generated always as (case when kind in ('skip_span', 'add_span') then 'span' else 'date' end) stored;
alter table public.hub_sched_recurring_overrides
  add constraint hub_sched_recurring_overrides_kind_check
    check (kind in ('skip', 'add', 'change', 'skip_span', 'add_span')),
  add constraint hub_sched_recurring_overrides_block_date_scope_key unique (block_id, date, scope),
  add constraint hub_sched_recurring_overrides_span_times_check
    check (kind not in ('skip_span', 'add_span') or (start_time is null and end_time is null));

-- ─── is a time on a date blocked by any recurring block? ─────────────────────
create function public.hub_sched_recurring_blocked(
  p_owner uuid, p_category text, p_date date, p_start time, p_end time
) returns boolean
language plpgsql
stable
set search_path to ''
as $function$
declare
  b        record;
  o        record;
  d        record;
  v_len    int;
  v_off    int;
  v_span   date;
  v_dow    int := extract(isodow from p_date)::int;
  v_all    boolean;
  v_s      time;
  v_e      time;
begin
  for b in
    select * from public.hub_sched_recurring_blocks rb
     where rb.owner_user_id = p_owner and rb.active
       and (rb.categories is null or p_category = any (rb.categories))
  loop
    -- a date-level override decides its date outright
    select * into o from public.hub_sched_recurring_overrides x
     where x.block_id = b.id and x.date = p_date and x.scope = 'date';
    if found then
      if o.kind = 'skip' then continue; end if;
      v_s := coalesce(o.start_time, b.start_time);
      v_e := coalesce(o.end_time, b.end_time);
      if o.start_time is null and (b.all_day or v_s is null or v_e is null) then return true; end if;
      if v_s < p_end and v_e > p_start then return true; end if;
      continue;
    end if;

    if not (v_dow = any (b.days)) then continue; end if;
    v_len := case when b.to_weekday = b.from_weekday then 8 else ((b.to_weekday - b.from_weekday + 7) % 7) + 1 end;

    for v_off in 0 .. v_len - 1 loop
      v_span := p_date - v_off;
      if not (
           (v_span >= b.anchor_date
            and ((v_span - b.anchor_date) % (7 * b.interval_weeks)) = 0
            and not exists (select 1 from public.hub_sched_recurring_overrides x
                             where x.block_id = b.id and x.date = v_span and x.kind = 'skip_span'))
        or exists (select 1 from public.hub_sched_recurring_overrides x
                    where x.block_id = b.id and x.date = v_span and x.kind = 'add_span')
      ) then
        continue;
      end if;

      -- times for this day of the span
      v_all := b.all_day; v_s := b.start_time; v_e := b.end_time;
      if b.per_day_times then
        select * into d from public.hub_sched_recurring_block_days y
         where y.block_id = b.id and y.span_offset = v_off;
        if found then v_all := d.all_day; v_s := d.start_time; v_e := d.end_time; end if;
      end if;
      if v_all or v_s is null or v_e is null then return true; end if;
      if v_s < p_end and v_e > p_start then return true; end if;
    end loop;
  end loop;
  return false;
end
$function$;

revoke all on function public.hub_sched_recurring_blocked(uuid, text, date, time, time) from public, anon, authenticated;
grant execute on function public.hub_sched_recurring_blocked(uuid, text, date, time, time) to service_role;

-- ─── hub_sched_check: same signature and reason codes; recurring via the helper ─
create or replace function public.hub_sched_check(
  p_owner uuid, p_category text, p_starts_at timestamptz, p_ends_at timestamptz,
  out allowed boolean, out reason text
)
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_tz        text;
  v_earliest  time;
  v_year_end  date;
  v_ls        timestamp;
  v_le        timestamp;
  v_d         date;
  v_st        time;
  v_et        time;
  v_dow       int;
  v_from      time;
  v_kh_found  boolean;
  v_kinds     text[] := '{}';
  v_ss        time[] := '{}';
  v_es        time[] := '{}';
  i           int;
begin
  allowed := false;

  if p_owner is null or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or p_category is null
     or p_category not in ('one_on_one', 'podcast', 'in_person', 'group_coaching', 'team_familiar') then
    reason := 'invalid_request'; return;
  end if;

  if not exists (select 1 from public.hub_sched_category_windows w where w.owner_user_id = p_owner) then
    reason := 'no_rules_set'; return;
  end if;

  select s.timezone, s.earliest_start, s.school_year_end
    into v_tz, v_earliest, v_year_end
    from public.hub_sched_settings s where s.owner_user_id = p_owner;
  v_tz := coalesce(v_tz, 'America/New_York');
  v_earliest := coalesce(v_earliest, '08:00'::time);

  v_ls := p_starts_at at time zone v_tz;
  v_le := p_ends_at at time zone v_tz;
  v_d := v_ls::date;
  v_st := v_ls::time;
  v_et := v_le::time;
  v_dow := extract(isodow from v_d)::int;

  if v_le::date <> v_d then reason := 'spans_days'; return; end if;
  if v_st < v_earliest then reason := 'before_earliest_start'; return; end if;

  if v_dow >= 6 then
    v_kinds := array['weekend']; v_ss := array[v_st]; v_es := array[v_et];
  elsif v_year_end is not null and v_d > v_year_end then
    if not exists (select 1 from public.hub_sched_category_windows w
                    where w.owner_user_id = p_owner and w.day_kind = 'summer') then
      reason := 'summer_rules_undefined'; return;
    end if;
    v_kinds := array['summer']; v_ss := array[v_st]; v_es := array[v_et];
  else
    select true, k.from_time into v_kh_found, v_from
      from public.hub_sched_kids_home_dates k
     where k.owner_user_id = p_owner and k.date = v_d;
    if v_kh_found is null then
      v_kinds := array['school']; v_ss := array[v_st]; v_es := array[v_et];
    elsif v_from is null then
      v_kinds := array['kids_home']; v_ss := array[v_st]; v_es := array[v_et];
    else
      if v_st < v_from then
        v_kinds := v_kinds || 'school'::text; v_ss := v_ss || v_st; v_es := v_es || least(v_et, v_from);
      end if;
      if v_et > v_from then
        v_kinds := v_kinds || 'kids_home'::text; v_ss := v_ss || greatest(v_st, v_from); v_es := v_es || v_et;
      end if;
    end if;
  end if;

  if exists (select 1 from public.hub_sched_one_off_blocks b
              where b.owner_user_id = p_owner
                and (b.categories is null or p_category = any (b.categories))
                and b.starts_at < p_ends_at and b.ends_at > p_starts_at) then
    reason := 'one_off_block'; return;
  end if;

  if public.hub_sched_recurring_blocked(p_owner, p_category, v_d, v_st, v_et) then
    reason := 'recurring_block'; return;
  end if;

  for i in 1 .. coalesce(array_length(v_kinds, 1), 0) loop
    if exists (select 1 from public.hub_sched_blocked_windows b
                where b.owner_user_id = p_owner and b.day_kind = v_kinds[i]
                  and (b.categories is null or p_category = any (b.categories))
                  and b.start_time < v_es[i] and b.end_time > v_ss[i]) then
      reason := 'blocked_window'; return;
    end if;
  end loop;

  for i in 1 .. coalesce(array_length(v_kinds, 1), 0) loop
    if not exists (select 1 from public.hub_sched_category_windows w
                    where w.owner_user_id = p_owner and w.category = p_category and w.day_kind = v_kinds[i]
                      and w.start_time <= v_ss[i] and w.end_time >= v_es[i]) then
      if v_kinds[i] in ('kids_home', 'weekend')
         and not exists (select 1 from public.hub_sched_category_windows w
                          where w.owner_user_id = p_owner and w.category = p_category and w.day_kind = v_kinds[i]) then
        reason := v_kinds[i];
      else
        reason := 'outside_window';
      end if;
      return;
    end if;
  end loop;

  allowed := true;
  reason := 'ok';
end
$function$;

revoke all on function public.hub_sched_check(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.hub_sched_check(uuid, text, timestamptz, timestamptz) to service_role;

-- ===== hub_220_booking_sync =====
-- removed:
--   nothing (schema only)

create table public.hub_booking_syncs (
  booking_id            uuid primary key,
  org_id                uuid not null,
  contact_id            uuid references public.contacts(id) on delete set null,
  route_id              uuid,
  appointment_type_id   uuid not null,
  appointment_type      text not null,
  starts_at             timestamptz not null,
  ends_at               timestamptz,
  status                text not null,
  answers               jsonb not null default '[]' check (jsonb_typeof(answers) = 'array'),
  placement             text not null default 'none'
                        check (placement in ('moved', 'entered', 'kept', 'other_pipeline', 'none')),
  first_synced_at       timestamptz not null default now(),
  last_synced_at        timestamptz not null default now()
);

create index hub_booking_syncs_contact on public.hub_booking_syncs (contact_id, starts_at desc);

alter table public.hub_booking_syncs enable row level security;
revoke all on public.hub_booking_syncs from public, anon, authenticated;
grant all on public.hub_booking_syncs to service_role;

-- ===== hub_221_booking_routes_seed =====
-- removed:
--   whole body: DO block writing org_settings crm_pipelines and upserting nr_booking_pipeline_routes for org 00000000-...-0001 (lines 37-98). DATA ONLY, no schema; nothing kept
-- (no statements kept)

-- ===== hub_222_resource_library =====
-- removed:
--   nothing; the storage bucket row is kept as infrastructure, guarded with on conflict (id) do nothing

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hub-resources', 'hub-resources', false, 52428800, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp'
]) on conflict (id) do nothing;

create table public.hub_resources (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  name                  text not null check (length(btrim(name)) between 1 and 200),
  description           text check (description is null or length(description) <= 2000),
  file_name             text not null check (length(file_name) between 1 and 255),
  storage_path          text not null unique,
  mime_type             text not null check (mime_type in (
                          'application/pdf',
                          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                          'image/jpeg', 'image/png', 'image/gif', 'image/webp')),
  size_bytes            bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  is_default_followup   boolean not null default false,
  sort_order            integer not null default 0,
  archived_at           timestamptz,
  created_by            uuid not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index hub_resources_org_order on public.hub_resources (org_id, sort_order) where archived_at is null;

create table public.hub_resource_sends (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  contact_id        uuid references public.contacts(id) on delete set null,
  sent_by           uuid not null,
  mailbox_id        uuid references public.hub_mail_connections(id) on delete set null,  -- nullable: deleting a Hub user cascades to hub_mail_connections
  from_address      text not null,
  to_address        text not null,
  subject           text not null check (length(subject) between 1 and 250),
  attached          jsonb not null default '[]' check (jsonb_typeof(attached) = 'array'),  -- [{id, name, size_bytes}]
  linked            jsonb not null default '[]' check (jsonb_typeof(linked) = 'array'),    -- [{id, name, size_bytes, expires_at}]
  gmail_message_id  text,
  sent_at           timestamptz not null default now()
);

create index hub_resource_sends_contact on public.hub_resource_sends (contact_id, sent_at desc);

alter table public.hub_resources enable row level security;
alter table public.hub_resource_sends enable row level security;
revoke all on public.hub_resources, public.hub_resource_sends from public, anon, authenticated;
grant all on public.hub_resources, public.hub_resource_sends to service_role;

-- ===== hub_223_growth_metrics =====
-- removed:
--   insert into hub_metric_targets, November 2026 seed (lines 110-115)
--   insert into hub_metric_exclusions, test-address seed (lines 117-123)

create table public.hub_metrics_daily (
  date             date not null,
  metric_key       text not null check (metric_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  dimension_key    text not null default '' check (length(dimension_key) <= 64),
  dimension_value  text not null default '' check (length(dimension_value) <= 200),
  value            numeric not null,
  computed_at      timestamptz not null default now(),
  primary key (date, metric_key, dimension_key, dimension_value)
);

create index hub_metrics_daily_metric_date on public.hub_metrics_daily (metric_key, date);

create table public.hub_metric_targets (
  metric_key       text not null check (metric_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  month            date not null check (extract(day from month) = 1),
  target_value     numeric not null check (target_value >= 0),
  amber_threshold  numeric not null default 0.90 check (amber_threshold > 0 and amber_threshold <= 1),
  red_threshold    numeric not null default 0.75 check (red_threshold > 0 and red_threshold <= 1),
  updated_by       uuid,
  updated_at       timestamptz not null default now(),
  primary key (metric_key, month),
  check (red_threshold <= amber_threshold)
);

create table public.hub_metric_exclusions (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('contact', 'profile', 'email', 'email_pattern')),
  decision       text not null default 'exclude' check (decision in ('exclude', 'keep')),
  contact_id     uuid references public.contacts(id) on delete cascade,
  profile_id     uuid,
  email          text check (email is null or email = lower(btrim(email))),
  email_pattern  text check (email_pattern is null or (email_pattern = lower(btrim(email_pattern))
                   and email_pattern like '%@%' and length(email_pattern) <= 200)),
  reason         text check (reason is null or length(reason) <= 200),
  created_by     uuid,   -- null: seeded by this migration
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check ((kind = 'contact' and contact_id is not null and profile_id is null and email is null and email_pattern is null)
      or (kind = 'profile' and profile_id is not null and contact_id is null and email is null and email_pattern is null)
      or (kind = 'email' and email is not null and contact_id is null and profile_id is null and email_pattern is null)
      or (kind = 'email_pattern' and email_pattern is not null and contact_id is null and profile_id is null and email is null))
);

create unique index hub_metric_exclusions_contact on public.hub_metric_exclusions (contact_id) where contact_id is not null;
create unique index hub_metric_exclusions_profile on public.hub_metric_exclusions (profile_id) where profile_id is not null;
create unique index hub_metric_exclusions_email on public.hub_metric_exclusions (email) where email is not null;
create unique index hub_metric_exclusions_pattern on public.hub_metric_exclusions (email_pattern) where email_pattern is not null;

create table public.hub_metric_alerts (
  alert_key   text not null check (alert_key ~ '^[a-z][a-z0-9_:.-]{1,120}$'),
  period_key  text not null check (length(period_key) between 1 and 40),
  sent_at     timestamptz not null default now(),
  detail      jsonb not null default '{}',
  primary key (alert_key, period_key)
);

alter table public.hub_metrics_daily enable row level security;
alter table public.hub_metric_targets enable row level security;
alter table public.hub_metric_exclusions enable row level security;
alter table public.hub_metric_alerts enable row level security;
revoke all on public.hub_metrics_daily, public.hub_metric_targets, public.hub_metric_exclusions, public.hub_metric_alerts
  from public, anon, authenticated;
grant all on public.hub_metrics_daily, public.hub_metric_targets, public.hub_metric_exclusions, public.hub_metric_alerts
  to service_role;

-- ===== hub_224_drop_quick_send =====
-- removed:
--   whole file skipped together with hub_215: its DO guard, the three drop tables (lines 40-49) only undo hub_215, and the org_settings delete by row id 1337d718-... (lines 51-53) is data
-- (no statements kept)

-- ===== hub_225_marketing_foundations_smart_lists =====
-- removed:
--   update org_settings hub_send_policy from_address for org 00000000-...-0001 (lines 338-343)
--   DO block: email consent backfill into consent_events (lines 345-377)
--   insert into smart_lists, 20 starter lists for org 00000000-...-0001 (lines 379-420)

-- ─── 1. Consent ledger accepts the backfill ───────────────────────────────────
-- A backfill row shows no text to anyone, so it is exempt by its exact source rather than
-- carrying invented wording. The same exemption the 'import' source already has.
alter table public.consent_events drop constraint consent_events_basis_check;
alter table public.consent_events add constraint consent_events_basis_check
  check (basis in ('express_consent','existing_business_relationship','existing_relationship','transactional',
                   'unsubscribe','stop','bounce','complaint','admin'));
alter table public.consent_events drop constraint consent_events_check;
alter table public.consent_events add constraint consent_events_check
  check (action = 'revoked' or source in ('import','existing_relationship_2026_11')
         or coalesce(btrim(text_shown), '') <> '');
-- one backfill row per contact, enforced
create unique index consent_events_backfill_once on public.consent_events (contact_id)
  where source = 'existing_relationship_2026_11';

-- ─── 2. Computed status. Never stored by hand. ────────────────────────────────
-- Why a contact is a current client. Empty array means not one.
create function public.hub_current_client_reasons(p_contact uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  with fam as (
    select c.id, c.mastermind_user_id, lower(btrim(c.email)) as em from public.contacts c
     where c.id in (select public.hub_contact_family(public.hub_resolve_contact(p_contact)))),
  prof as (
    select p.id from public.profiles p
     where p.id in (select f.mastermind_user_id from fam f where f.mastermind_user_id is not null)
        or lower(btrim(p.email)) in (select f.em from fam f where coalesce(f.em, '') <> ''))
  select array_remove(array[
    case when exists (select 1 from public.enrollments e where e.user_id in (select id from prof)
                       and e.status = 'active' and (e.access_ends_at is null or e.access_ends_at > now()))
         then 'enrollment' end,
    case when exists (select 1 from public.entitlements t where t.user_id in (select id from prof)
                       and (t.expires_at is null or t.expires_at > now()))
         then 'entitlement' end,
    -- a $0 payment is a comp (definitions.md G3) and a fully refunded one is not a payment
    case when exists (select 1 from public.payments y where y.participant_id in (select id from prof)
                       and y.status in ('succeeded','partially_refunded')
                       and y.amount_cents > coalesce(y.amount_refunded_cents, 0)
                       and coalesce(y.paid_at, y.created_at) > now() - interval '120 days')
         then 'payment' end,
    case when exists (select 1 from public.nr_bookings b
                       left join public.nr_booking_leads l on l.id = b.lead_id
                       where b.status = 'confirmed' and b.ends_at > now()
                         and (b.participant_id in (select id from prof)
                              or lower(btrim(l.email)) in (select f.em from fam f where coalesce(f.em, '') <> '')))
           or exists (select 1 from public.hub_booking_syncs s
                       where s.contact_id in (select f.id from fam f) and s.status = 'confirmed' and s.starts_at > now())
         then 'booking' end
  ], null)
$$;

create function public.hub_email_marketing_allowed(p_contact uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; c record; v_addr text;
begin
  v_id := public.hub_resolve_contact(p_contact);
  select x.org_id, x.email into c from public.contacts x where x.id = v_id;
  v_addr := lower(btrim(c.email));
  if v_addr is null or v_addr !~ '^[^@\s:]+@[^@\s]+\.[a-z]{2,}$' then return false; end if;
  if not (public.consent_state(v_id, 'email', 'marketing') ->> 'allowed')::boolean then return false; end if;
  if exists (select 1 from public.contacts f where f.id in (select public.hub_contact_family(v_id)) and f.do_not_contact) then return false; end if;
  if exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and lower(btrim(d.email)) = v_addr) then return false; end if;
  if exists (select 1 from public.suppressions su where su.org_id = c.org_id and su.channel = 'email'
              and su.address = v_addr and su.lifted_at is null) then return false; end if;
  return true;
end $$;

-- Texting allowed = current client or an SMS opt-in, minus STOP and DNC.
-- The opt-in is a ledger event. contacts.sms_consent is not read: inbound-sms sets it true on any
-- new inbound texter, which is not an opt-in to marketing.
create function public.hub_texting_allowed(p_contact uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; c record; v_addr text; cs jsonb; v_client boolean; v_optin boolean;
begin
  v_id := public.hub_resolve_contact(p_contact);
  select x.org_id, x.phone into c from public.contacts x where x.id = v_id;
  v_addr := btrim(c.phone);
  v_client := cardinality(public.hub_current_client_reasons(v_id)) > 0;
  cs := public.consent_state(v_id, 'sms', 'marketing');
  v_optin := (cs ->> 'allowed')::boolean;
  return jsonb_build_object('current_client', v_client, 'opt_in', v_optin, 'reason',
    case
      when v_addr is null or v_addr !~ '^\+[1-9][0-9]{7,14}$' then 'no_valid_e164_phone'
      when cs ->> 'reason' = 'marketing_revoked' then 'marketing_revoked'
      when exists (select 1 from public.contacts f where f.id in (select public.hub_contact_family(v_id)) and f.do_not_contact) then 'do_not_contact_flag'
      when exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and btrim(d.phone) = v_addr) then 'do_not_contact_list'
      when exists (select 1 from public.suppressions su where su.org_id = c.org_id and su.channel = 'sms'
                    and su.address = v_addr and su.lifted_at is null) then 'suppressed'
      when v_optin then 'opt_in'
      when v_client then 'current_client'
      else 'no_marketing_consent'
    end)
  || jsonb_build_object('allowed',
    v_addr is not null and v_addr ~ '^\+[1-9][0-9]{7,14}$'
    and cs ->> 'reason' <> 'marketing_revoked'
    and (v_optin or v_client)
    and not exists (select 1 from public.contacts f where f.id in (select public.hub_contact_family(v_id)) and f.do_not_contact)
    and not exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and btrim(d.phone) = v_addr)
    and not exists (select 1 from public.suppressions su where su.org_id = c.org_id and su.channel = 'sms'
                     and su.address = v_addr and su.lifted_at is null));
end $$;

-- ─── 3. The send gate. Same as hub_211 except where marked HUB_225. ───────────
create or replace function public.gate_check(p_contact uuid, p_channel text, p_kind text, p_campaign uuid default null,
                                  p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; c record; pol jsonb; v_mode text := 'dry_run'; v_addr text; cs jsonb; v_tz text;
  v_local timestamp; v_start time; v_end time; v_next timestamp; v_retry timestamptz; v_n int; v_live_ok boolean;
  v_decision text; v_step text; v_reason text; v_detail jsonb := '{}'::jsonb;
  v_text jsonb; v_brand text;  -- HUB_225
begin
  v_id := public.hub_resolve_contact(p_contact);
  select x.id, x.org_id, x.email, x.phone, x.timezone, x.do_not_contact into c from public.contacts x where x.id = v_id;
  pol := public.hub_send_policy(c.org_id);
  v_text := public.hub_texting_allowed(v_id);  -- HUB_225: exposed in the result below

  <<gate>>
  begin
    -- 1. flag: engine on, then live or dry-run
    if public.hub_flag(c.org_id, 'engine') <> 'on' then
      v_decision := 'deny'; v_step := 'flag'; v_reason := 'engine_off'; exit gate;
    end if;
    -- HUB_225: a WNW send is blocked, dry runs included, until a WNW sender is configured
    select case when f.brand = 'wnw' or o.slug = 'waynesville-neuro-wellness' then 'wnw' else 'np' end into v_brand
      from public.organizations o left join public.funnel_campaigns f on f.id = p_campaign where o.id = c.org_id;
    if v_brand = 'wnw' and coalesce(pol -> 'brand_senders' -> 'wnw' ->> 'from_address', '') = '' then
      v_decision := 'deny'; v_step := 'sender'; v_reason := 'wnw_sender_not_configured'; exit gate;
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
    -- HUB_225: a current client with no SMS record may get a marketing text. A recorded revoke still wins.
    if p_channel = 'sms' and p_kind = 'marketing' and cs ->> 'reason' = 'no_marketing_consent'
       and (v_text ->> 'current_client')::boolean then
      cs := jsonb_build_object('allowed', true, 'event_id', null, 'reason', 'current_client');
    end if;
    if not (cs ->> 'allowed')::boolean then
      v_decision := 'deny'; v_step := 'consent'; v_reason := cs ->> 'reason'; exit gate;
    end if;
    -- HUB_225: any text step in a campaign is limited to Texting allowed, whatever its kind
    if p_channel = 'sms' and p_kind <> 'marketing' and p_campaign is not null
       and not ((v_text ->> 'current_client')::boolean or (v_text ->> 'opt_in')::boolean) then
      v_decision := 'deny'; v_step := 'consent'; v_reason := 'texting_not_allowed'; exit gate;
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
    -- HUB_225: a merged-in duplicate's DNC or marketing revoke also stops a campaign text
    if p_channel = 'sms' and p_campaign is not null and not (v_text ->> 'allowed')::boolean then
      v_decision := 'deny'; v_step := 'suppression'; v_reason := v_text ->> 'reason'; exit gate;
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
                            'consent_event_id', cs ->> 'event_id',
                            'current_client', (v_text ->> 'current_client')::boolean,  -- HUB_225
                            'texting_allowed', (v_text ->> 'allowed')::boolean) || v_detail;
end $$;

-- ─── 4. Smart lists ───────────────────────────────────────────────────────────
create table public.smart_lists (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  description text,
  brand       text not null default 'np' check (brand in ('np','wnw')),
  definition  jsonb not null default '{"match":"all","rules":[]}'::jsonb
              check (jsonb_typeof(definition) = 'object' and definition ->> 'match' in ('all','any')
                     and jsonb_typeof(definition -> 'rules') = 'array'),
  seed_key    text,
  created_by  uuid,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, seed_key)
);
create index smart_lists_org on public.smart_lists (org_id) where archived_at is null;
alter table public.smart_lists enable row level security;
revoke all on public.smart_lists from public, anon, authenticated;
grant all on public.smart_lists to service_role;

alter table public.funnel_campaigns
  add column smart_list_id uuid references public.smart_lists(id) on delete set null,
  add column brand text not null default 'np' check (brand in ('np','wnw'));
create index funnel_campaigns_smart_list on public.funnel_campaigns (smart_list_id) where smart_list_id is not null;

-- One row per live contact, with everything a list can filter on. Lists are evaluated from this
-- on every read, so they are always current and nothing about membership is stored.
create function public.hub_contact_facts(p_org uuid)
returns table (contact_id uuid, first_name text, last_name text, email text, phone text, tags text[], source text,
               contact_type text, partnership_type text, pipeline_id text, pipeline_name text, pipeline_stage text, brand text,
               created_at timestamptz, last_activity_at timestamptz, last_open_at timestamptz, last_click_at timestamptz,
               booked_at timestamptz, booking_types text[], client_reasons text[], email_allowed boolean,
               texting_allowed boolean, purchases jsonb)
language sql stable security definer set search_path = '' as $$
  select c.id, c.first_name, c.last_name, c.email, c.phone,
         coalesce(c.tags, '{}') || coalesce(c.auto_tags, '{}'), c.source, c.contact_type, c.partnership_type,
         c.pipeline_id, pl.name, c.pipeline_stage,
         case when pl.name ~* 'waynesville' then 'wnw' else 'np' end,
         c.created_at,
         greatest(c.last_contacted_at, c.last_call_at, c.last_text_at, c.last_email_at, m.last_open, m.last_click, b.booked),
         m.last_open, m.last_click, b.booked, coalesce(b.types, '{}'),
         public.hub_current_client_reasons(c.id), public.hub_email_marketing_allowed(c.id),
         (public.hub_texting_allowed(c.id) ->> 'allowed')::boolean, coalesce(p.items, '[]'::jsonb)
    from public.contacts c
    left join public.pipelines pl on pl.org_id = c.org_id and pl.legacy_key = c.pipeline_id
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
   where c.org_id = p_org and c.merged_into_id is null and c.archived_at is null
     and not coalesce(c.tags, '{}') @> array['quarantine:test-record']
$$;

revoke execute on function public.hub_current_client_reasons(uuid) from public, anon, authenticated;
revoke execute on function public.hub_email_marketing_allowed(uuid) from public, anon, authenticated;
revoke execute on function public.hub_texting_allowed(uuid) from public, anon, authenticated;
revoke execute on function public.hub_contact_facts(uuid) from public, anon, authenticated;
grant execute on function public.hub_current_client_reasons(uuid) to service_role;
grant execute on function public.hub_email_marketing_allowed(uuid) to service_role;
grant execute on function public.hub_texting_allowed(uuid) to service_role;
grant execute on function public.hub_contact_facts(uuid) to service_role;

-- ===== hub_226_merge_flag_is_not_an_opt_out =====
-- removed:
--   DO precondition checking contact e734ad21-... carries the test tag (lines 59-65); it would always raise on nonprod
--   DO block: cold outreach revoke rows into consent_events for 12 named contacts (lines 268-313)
--   DO block: email consent backfill into consent_events (lines 315-344)

-- True when this contact, or a merged duplicate that opted out before its merge, is do-not-contact.
create function public.hub_contact_has_real_dnc(p_contact uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with fam as (select public.hub_resolve_contact(p_contact) as survivor)
  select exists (
    select 1 from public.contacts c, fam
     where c.do_not_contact
       and c.id in (select public.hub_contact_family(fam.survivor))
       and (c.id = fam.survivor
            or exists (select 1 from public.contact_merge_log m where m.loser_id = c.id
                        and m.merge_details -> 'loser_snapshot' ->> 'do_not_contact' = 'true')
            or not exists (select 1 from public.contact_merge_log m where m.loser_id = c.id
                            and m.merge_details ? 'loser_snapshot')))
$$;
revoke execute on function public.hub_contact_has_real_dnc(uuid) from public, anon, authenticated;
grant execute on function public.hub_contact_has_real_dnc(uuid) to service_role;

-- True when the surviving contact is tagged a test record and neither its email nor its phone is on the
-- test allowlist. Phones compare on the last 10 digits, the way gate_check compares them.
create function public.hub_contact_is_blocked_test_record(p_contact uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with s as (
    select x.org_id, x.tags, nullif(lower(btrim(x.email)), '') as email,
           nullif(right(regexp_replace(coalesce(x.phone, ''), '\D', '', 'g'), 10), '') as phone
      from public.contacts x where x.id = public.hub_resolve_contact(p_contact))
  select coalesce(s.tags, '{}') @> array['quarantine:test-record']
     and not exists (select 1 from public.campaign_test_contacts t where t.org_id = s.org_id
                      and (lower(btrim(t.email)) = s.email
                           or right(regexp_replace(coalesce(t.phone, ''), '\D', '', 'g'), 10) = s.phone))
    from s
$$;
revoke execute on function public.hub_contact_is_blocked_test_record(uuid) from public, anon, authenticated;
grant execute on function public.hub_contact_is_blocked_test_record(uuid) to service_role;

create or replace function public.hub_email_marketing_allowed(p_contact uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; c record; v_addr text;
begin
  v_id := public.hub_resolve_contact(p_contact);
  if public.hub_contact_is_blocked_test_record(v_id) then return false; end if;
  select x.org_id, x.email into c from public.contacts x where x.id = v_id;
  v_addr := lower(btrim(c.email));
  if v_addr is null or v_addr !~ '^[^@\s:]+@[^@\s]+\.[a-z]{2,}$' then return false; end if;
  if not (public.consent_state(v_id, 'email', 'marketing') ->> 'allowed')::boolean then return false; end if;
  if public.hub_contact_has_real_dnc(v_id) then return false; end if;
  if exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and lower(btrim(d.email)) = v_addr) then return false; end if;
  if exists (select 1 from public.suppressions su where su.org_id = c.org_id and su.channel = 'email'
              and su.address = v_addr and su.lifted_at is null) then return false; end if;
  return true;
end $$;

create or replace function public.hub_texting_allowed(p_contact uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; c record; v_addr text; cs jsonb; v_client boolean; v_optin boolean; v_dnc boolean; v_test boolean;
begin
  v_id := public.hub_resolve_contact(p_contact);
  select x.org_id, x.phone into c from public.contacts x where x.id = v_id;
  v_addr := btrim(c.phone);
  v_client := cardinality(public.hub_current_client_reasons(v_id)) > 0;
  cs := public.consent_state(v_id, 'sms', 'marketing');
  v_optin := (cs ->> 'allowed')::boolean;
  v_dnc := public.hub_contact_has_real_dnc(v_id);
  v_test := public.hub_contact_is_blocked_test_record(v_id);
  return jsonb_build_object('current_client', v_client, 'opt_in', v_optin, 'reason',
    case
      when v_test then 'test_record'
      when v_addr is null or v_addr !~ '^\+[1-9][0-9]{7,14}$' then 'no_valid_e164_phone'
      when cs ->> 'reason' = 'marketing_revoked' then 'marketing_revoked'
      when v_dnc then 'do_not_contact_flag'
      when exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and btrim(d.phone) = v_addr) then 'do_not_contact_list'
      when exists (select 1 from public.suppressions su where su.org_id = c.org_id and su.channel = 'sms'
                    and su.address = v_addr and su.lifted_at is null) then 'suppressed'
      when v_optin then 'opt_in'
      when v_client then 'current_client'
      else 'no_marketing_consent'
    end)
  || jsonb_build_object('allowed',
    not v_test
    and v_addr is not null and v_addr ~ '^\+[1-9][0-9]{7,14}$'
    and cs ->> 'reason' <> 'marketing_revoked'
    and (v_optin or v_client)
    and not v_dnc
    and not exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and btrim(d.phone) = v_addr)
    and not exists (select 1 from public.suppressions su where su.org_id = c.org_id and su.channel = 'sms'
                     and su.address = v_addr and su.lifted_at is null));
end $$;

-- gate_check as live on 2026-11-06, with one addition marked HUB_226.
create or replace function public.gate_check(p_contact uuid, p_channel text, p_kind text, p_campaign uuid default null,
                                             p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; c record; pol jsonb; v_mode text := 'dry_run'; v_addr text; cs jsonb; v_tz text;
  v_local timestamp; v_start time; v_end time; v_next timestamp; v_retry timestamptz; v_n int; v_live_ok boolean;
  v_decision text; v_step text; v_reason text; v_detail jsonb := '{}'::jsonb;
  v_text jsonb; v_brand text;  -- HUB_225
begin
  v_id := public.hub_resolve_contact(p_contact);
  select x.id, x.org_id, x.email, x.phone, x.timezone, x.do_not_contact into c from public.contacts x where x.id = v_id;
  pol := public.hub_send_policy(c.org_id);
  v_text := public.hub_texting_allowed(v_id);  -- HUB_225: exposed in the result below

  <<gate>>
  begin
    -- 1. flag: engine on, then live or dry-run
    if public.hub_flag(c.org_id, 'engine') <> 'on' then
      v_decision := 'deny'; v_step := 'flag'; v_reason := 'engine_off'; exit gate;
    end if;
    -- HUB_225: a WNW send is blocked, dry runs included, until a WNW sender is configured
    select case when f.brand = 'wnw' or o.slug = 'waynesville-neuro-wellness' then 'wnw' else 'np' end into v_brand
      from public.organizations o left join public.funnel_campaigns f on f.id = p_campaign where o.id = c.org_id;
    if v_brand = 'wnw' and coalesce(pol -> 'brand_senders' -> 'wnw' ->> 'from_address', '') = '' then
      v_decision := 'deny'; v_step := 'sender'; v_reason := 'wnw_sender_not_configured'; exit gate;
    end if;
    v_addr := case when p_channel = 'email' then lower(btrim(c.email)) else btrim(c.phone) end;
    -- HUB_226: a test record outside the test allowlist is denied on every channel and kind
    if public.hub_contact_is_blocked_test_record(v_id) then
      v_decision := 'deny'; v_step := 'suppression'; v_reason := 'test_record'; exit gate;
    end if;
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
    -- HUB_225: a current client with no SMS record may get a marketing text. A recorded revoke still wins.
    if p_channel = 'sms' and p_kind = 'marketing' and cs ->> 'reason' = 'no_marketing_consent'
       and (v_text ->> 'current_client')::boolean then
      cs := jsonb_build_object('allowed', true, 'event_id', null, 'reason', 'current_client');
    end if;
    if not (cs ->> 'allowed')::boolean then
      v_decision := 'deny'; v_step := 'consent'; v_reason := cs ->> 'reason'; exit gate;
    end if;
    -- HUB_225: any text step in a campaign is limited to Texting allowed, whatever its kind
    if p_channel = 'sms' and p_kind <> 'marketing' and p_campaign is not null
       and not ((v_text ->> 'current_client')::boolean or (v_text ->> 'opt_in')::boolean) then
      v_decision := 'deny'; v_step := 'consent'; v_reason := 'texting_not_allowed'; exit gate;
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
    -- HUB_225: a merged-in duplicate's DNC or marketing revoke also stops a campaign text
    if p_channel = 'sms' and p_campaign is not null and not (v_text ->> 'allowed')::boolean then
      v_decision := 'deny'; v_step := 'suppression'; v_reason := v_text ->> 'reason'; exit gate;
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
                            'consent_event_id', cs ->> 'event_id',
                            'current_client', (v_text ->> 'current_client')::boolean,  -- HUB_225
                            'texting_allowed', (v_text ->> 'allowed')::boolean) || v_detail;
end $$;

-- ===== hub_227_podcast_hosts_email_allowed =====
-- removed:
--   whole body: DO block granting email consent to 20 named contacts (lines 33-81). DATA ONLY, nothing kept
-- (no statements kept)

-- ===== hub_228_lead_devices =====
-- removed:
--   nothing; the storage bucket row is kept as infrastructure, guarded with on conflict (id) do nothing

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lead-devices', 'lead-devices', false, 2097152, array['text/html']) on conflict (id) do nothing;

create table public.lead_devices (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  slug               text not null unique
                     check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80
                            and slug not in ('api', 'favicon', 'health', 'lead-device', 'robots', 'sitemap')),
  name               text not null check (length(btrim(name)) between 1 and 200),
  brand              text not null check (brand in ('neuro_progeny', 'wnw')),
  type               text not null check (type in ('quiz', 'lead_magnet', 'webinar', 'tool', 'form', 'booking')),
  hosting            text not null check (hosting in ('hub', 'external')),
  -- html: an uploaded file in the framed player. form: the Hub lead form alone, with no file.
  content            text not null default 'html' check (content in ('html', 'form')),
  status             text not null default 'draft' check (status in ('draft', 'live', 'paused')),
  -- description, outcomes [{key,label}], questions [{key,label}], fields, email_consent_text,
  -- sms_consent_text, result_consent_text, asset_url, hot_lead_rule, script_allowlist, embed_origins
  manifest           jsonb not null default '{}' check (jsonb_typeof(manifest) = 'object'),
  pipeline_id        uuid references public.pipelines(id) on delete set null,
  live_version_id    uuid,
  -- What was created around the device: smart list and campaign ids, by outcome
  assets             jsonb not null default '{}' check (jsonb_typeof(assets) = 'object'),
  provisioned_at     timestamptz,
  provision_error    text,
  test_drive_passed_at timestamptz,
  test_drive_passed_by uuid,
  went_live_at       timestamptz,
  went_live_by       uuid,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint lead_devices_live_needs_who check (status <> 'live' or (went_live_at is not null and went_live_by is not null)),
  constraint lead_devices_external_has_no_file check (hosting = 'hub' or (content = 'form' and live_version_id is null))
);

create index lead_devices_org on public.lead_devices (org_id, created_at desc);

create trigger trg_updated_at before update on public.lead_devices
  for each row execute function public.update_updated_at();

create table public.lead_device_versions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  device_id       uuid not null references public.lead_devices(id) on delete cascade,
  version         integer not null check (version > 0),
  storage_path    text not null unique,
  file_name       text not null check (length(file_name) between 1 and 255),
  size_bytes      bigint not null check (size_bytes > 0 and size_bytes <= 2097152),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- what the uploader's inspection found in the file
  inspection      jsonb not null default '{}' check (jsonb_typeof(inspection) = 'object'),
  approved_at     timestamptz,
  approved_by     uuid,
  uploaded_by     uuid,
  created_at      timestamptz not null default now(),
  unique (device_id, version),
  unique (id, device_id)
);

-- A device can only go live on one of its own versions. Deferred so deleting a device can cascade.
alter table public.lead_devices
  add constraint lead_devices_live_version_fk foreign key (live_version_id, id)
  references public.lead_device_versions (id, device_id) deferrable initially deferred;

create table public.lead_device_submissions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  device_id       uuid not null references public.lead_devices(id) on delete cascade,
  version_id      uuid references public.lead_device_versions(id) on delete set null,
  contact_id      uuid references public.contacts(id) on delete set null,
  channel         text not null check (channel in ('hosted', 'form', 'external')),
  idempotency_key text not null check (length(idempotency_key) between 1 and 120),
  outcome         text check (outcome is null or length(outcome) <= 80),
  -- stored with the row, so renaming an outcome or a question later does not rewrite what was shown
  outcome_label   text check (outcome_label is null or length(outcome_label) <= 200),
  answers         jsonb not null default '{}' check (jsonb_typeof(answers) = 'object'),
  question_labels jsonb not null default '{}' check (jsonb_typeof(question_labels) = 'object'),
  -- [{channel, kind, granted, text}]: what was offered and given, with the exact text
  consents        jsonb not null default '[]' check (jsonb_typeof(consents) = 'array'),
  utm             jsonb check (utm is null or jsonb_typeof(utm) = 'object'),
  page_url        text check (page_url is null or length(page_url) <= 2000),
  ip_hash         text,
  -- true while the device is not live. A test submission never counts in a list or in conversion.
  is_test         boolean not null,
  status          text not null default 'received' check (status in ('received', 'accepted', 'contact_failed')),
  submitted_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (device_id, idempotency_key)
);

create index lead_device_submissions_device on public.lead_device_submissions (device_id, created_at desc);
create index lead_device_submissions_contact on public.lead_device_submissions (contact_id, created_at desc) where contact_id is not null;

create table public.lead_device_events (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  device_id   uuid not null references public.lead_devices(id) on delete cascade,
  version_id  uuid references public.lead_device_versions(id) on delete set null,
  -- view, start and author-named events from NPU.track; 'attempt' is written only by the server
  event       text not null check (event ~ '^[a-z0-9_]{1,40}$'),
  ip_hash     text,
  utm_source  text check (utm_source is null or length(utm_source) <= 200),
  is_test     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index lead_device_events_device on public.lead_device_events (device_id, event, created_at desc);
create index lead_device_events_rate on public.lead_device_events (ip_hash, created_at desc) where ip_hash is not null;

alter table public.lead_devices enable row level security;
alter table public.lead_device_versions enable row level security;
alter table public.lead_device_submissions enable row level security;
alter table public.lead_device_events enable row level security;
revoke all on public.lead_devices, public.lead_device_versions, public.lead_device_submissions, public.lead_device_events
  from public, anon, authenticated;
grant all on public.lead_devices, public.lead_device_versions, public.lead_device_submissions, public.lead_device_events
  to service_role;

-- The same match as hub_intake_contact: by email, or by phone when there is no email. An existing contact
-- is returned untouched, so it keeps its source.
create function public.hub_lead_device_contact(p_org uuid, p_email text, p_phone text, p_first text, p_last text, p_slug text, p_utm jsonb default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v uuid; e text := nullif(lower(btrim(p_email)), ''); ph text := nullif(btrim(p_phone), '');
begin
  if e is null and ph is null then raise exception 'hub: a lead device submission needs an email or a phone'; end if;
  select c.id into v from public.contacts c
   where c.org_id = p_org and c.merged_into_id is null and c.archived_at is null
     and ((e is not null and lower(btrim(c.email)) = e) or (e is null and ph is not null and btrim(c.phone) = ph))
   order by c.created_at limit 1;
  if v is not null then return v; end if;
  insert into public.contacts (org_id, first_name, last_name, email, phone, source, acquisition_source, acquisition_utm)
  values (p_org, coalesce(nullif(btrim(p_first), ''), 'Unknown'), coalesce(btrim(p_last), ''), e, ph,
          p_slug, 'lead_device:' || p_slug, p_utm)
  returning id into v;
  return v;
end $function$;

revoke all on function public.hub_lead_device_contact(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.hub_lead_device_contact(uuid, text, text, text, text, text, jsonb) to service_role;

-- The form intake's empty search path carries into trg_contact_identity, which names its objects without a
-- schema, so a new contact with an email could not be created. Its body already qualifies everything it uses.
alter function public.hub_intake_contact(uuid, text, text, text, text, text, jsonb) set search_path to 'public', 'extensions', 'pg_temp';

-- The return type changes, so the function is dropped and recreated rather than replaced. The body is
-- the live definition read on 2026-11-06, with the two new columns and their two joins added.
drop function public.hub_contact_facts(uuid);

create function public.hub_contact_facts(p_org uuid)
 returns table(contact_id uuid, first_name text, last_name text, email text, phone text, tags text[], source text,
               contact_type text, partnership_type text, pipeline_id text, pipeline_name text, pipeline_stage text,
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
         c.pipeline_id, pl.name, c.pipeline_stage,
         case when pl.name ~* 'waynesville' then 'wnw' else 'np' end,
         c.created_at,
         greatest(c.last_contacted_at, c.last_call_at, c.last_text_at, c.last_email_at, m.last_open, m.last_click, b.booked),
         m.last_open, m.last_click, b.booked, coalesce(b.types, '{}'),
         public.hub_current_client_reasons(c.id), public.hub_email_marketing_allowed(c.id),
         (public.hub_texting_allowed(c.id) ->> 'allowed')::boolean, coalesce(p.items, '[]'::jsonb),
         coalesce(ld.slugs, '{}'), coalesce(qa.archetypes, '{}')
    from public.contacts c
    left join public.pipelines pl on pl.org_id = c.org_id and pl.legacy_key = c.pipeline_id
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

-- ===== hub_229_pipeline_positions =====
-- removed:
--   select sync_pipelines_from_settings(...) for every org (line 99); it writes pipelines/pipeline_stages rows from org_settings
--   backfill insert into contact_pipeline_positions from contacts (lines 101-111)
--   backfill insert into hub_pipeline_legacy_unmapped (lines 113-123)
--   update contact_pipeline_positions, Sales Pipeline legacy-stage sync (lines 125-137)
--   trailing commented AFTER APPLY read-back queries (lines 697-714)

-- 1 ─────────────────────────────────────────────────────────────────────────────────────────────────────
create table public.hub_pipeline_legacy_unmapped (
  id           bigserial primary key,
  org_id       uuid not null,
  contact_id   uuid not null,
  pipeline_key text,
  stage_name   text,
  reason       text not null check (reason in ('pipeline_unknown', 'pipeline_archived', 'stage_unknown', 'error', 'mirror_error')),
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

-- 4 ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- The legacy mirror (Cameron, 2026-11-07), so NeuroReport's participant list and the University's auto-tagger keep
-- reading current values from contacts.pipeline_id / pipeline_stage, exactly as they do today:
--   * a position added or moved in the pipeline contacts.pipeline_id already names, or for a contact whose
--     pipeline_id is empty, writes pipeline_id (the pipeline's legacy key) and pipeline_stage (the stage name);
--   * a removal from the pipeline contacts.pipeline_id names clears both, as the Hub's remove did before;
--   * a position in any other pipeline never touches the legacy columns.
-- Recursion: the mirror's write sets app.hub_legacy_mirroring, which the translation trigger skips, and a
-- translated write sets app.hub_legacy_translating, which the mirror skips (the columns already hold it).
-- It never fails the move: an error is logged to hub_pipeline_legacy_unmapped as 'mirror_error'.
-- The mirror lives in the database only; Hub app code still never writes the legacy columns (guard G7).
create function public.hub_pipeline_legacy_mirror(p_contact uuid, p_pipeline uuid, p_stage uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_key text; v_stage text; v_org uuid;
begin
  if coalesce(current_setting('app.hub_legacy_translating', true), '') = 'on' then return; end if;
  begin
    select p.legacy_key, p.org_id into v_key, v_org from public.pipelines p where p.id = p_pipeline;
    if v_key is null then return; end if;
    perform set_config('app.hub_legacy_mirroring', 'on', true);
    if p_stage is null then
      update public.contacts c set pipeline_id = null, pipeline_stage = null
       where c.id = p_contact and c.merged_into_id is null and c.pipeline_id = v_key;
    else
      select s.name into v_stage from public.pipeline_stages s where s.id = p_stage;
      update public.contacts c set pipeline_id = v_key, pipeline_stage = v_stage
       where c.id = p_contact and c.merged_into_id is null
         and (nullif(c.pipeline_id, '') is null or c.pipeline_id = v_key)
         and (c.pipeline_id is distinct from v_key or c.pipeline_stage is distinct from v_stage);
    end if;
    perform set_config('app.hub_legacy_mirroring', '', true);
  exception when others then
    perform set_config('app.hub_legacy_mirroring', '', true);
    begin
      insert into public.hub_pipeline_legacy_unmapped (org_id, contact_id, pipeline_key, stage_name, reason, detail)
      values (v_org, p_contact, v_key, v_stage, 'mirror_error', sqlstate);
    exception when others then null;
    end;
  end;
end $function$;

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
    -- a contact delete cascades here: no history for a contact that no longer exists
    if not exists (select 1 from public.contacts c where c.id = old.contact_id) then return null; end if;
    perform public.hub_pipeline_legacy_mirror(old.contact_id, old.pipeline_id, null);
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

  perform public.hub_pipeline_legacy_mirror(new.contact_id, new.pipeline_id, new.stage_id);
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
  -- the Hub's own mirror wrote this; translating it back would loop
  if coalesce(current_setting('app.hub_legacy_mirroring', true), '') = 'on' then return null; end if;
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
    -- Cameron, 2026-11-07: the NeuroReport sync's 'Signed up' is the Enrolled pipeline's first stage. This one
    -- value in this one pipeline, by the stage's key; nothing else is mapped by likeness.
    if v_stage is null and new.pipeline_id = 'pipeline-1771530511407' and new.pipeline_stage = 'Signed up' then
      select s.id into v_stage from public.pipeline_stages s
       where s.pipeline_id = v_pipe and s.legacy_key = 'stage-1772022700334' and s.archived_at is null;
    end if;
    if v_stage is null then
      insert into public.hub_pipeline_legacy_unmapped (org_id, contact_id, pipeline_key, stage_name, reason)
      values (new.org_id, new.id, new.pipeline_id, new.pipeline_stage, 'stage_unknown');
      return null;
    end if;
    perform set_config('app.hub_legacy_translating', 'on', true);
    insert into public.contact_pipeline_positions (contact_id, org_id, pipeline_id, stage_id, moved_at, moved_by, source)
    values (new.id, new.org_id, v_pipe, v_stage, now(), null, 'legacy_write')
    on conflict (contact_id, pipeline_id) do update
      set stage_id = excluded.stage_id, moved_at = excluded.moved_at, moved_by = null, source = excluded.source
      where public.contact_pipeline_positions.stage_id <> excluded.stage_id;
    perform set_config('app.hub_legacy_translating', '', true);
  exception when others then
    perform set_config('app.hub_legacy_translating', '', true);
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
revoke all on function public.hub_pipeline_legacy_mirror(uuid, uuid, uuid) from public, anon, authenticated;
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
-- security_invoker stays on (platform 157): create or replace without WITH would clear it.
create or replace view public.attribution_effectiveness with (security_invoker = on) as
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
-- security_invoker stays on (platform 157): create or replace without WITH would clear it.
create or replace view public.contact_lifecycle_summary with (security_invoker = on) as
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

-- ===== hub_230_lead_submission_identity =====
-- removed:
--   nothing (schema and function only)

alter table public.lead_device_submissions
  add column first_name text check (first_name is null or length(first_name) <= 120),
  add column last_name text check (last_name is null or length(last_name) <= 120),
  add column email text check (email is null or length(email) <= 320),
  add column phone text check (phone is null or length(phone) <= 32),
  add column identity_purged_at timestamptz;

create function public.hub_purge_test_submission_identity(p_days integer default 30)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare n int;
begin
  if p_days is null or p_days < 30 then raise exception 'hub: test identity is kept at least 30 days'; end if;
  update public.lead_device_submissions s
     set first_name = null, last_name = null, email = null, phone = null, identity_purged_at = now()
   where s.is_test and s.identity_purged_at is null
     and coalesce(s.submitted_at, s.created_at) < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.hub_purge_test_submission_identity(integer) from public, anon, authenticated;
grant execute on function public.hub_purge_test_submission_identity(integer) to service_role;

-- ===== hub_231_lead_alerts =====
-- removed:
--   insert into org_settings hub_lead_alerts for org 00000000-...-0001 naming a recipient user id (lines 77-81)

create table public.hub_lead_alerts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  source       text not null check (source in ('lead_device', 'form', 'booking', 'university_signup', 'test')),
  source_id    text not null check (length(source_id) between 1 and 100),
  contact_id   uuid references public.contacts(id) on delete set null,
  occurred_at  timestamptz not null,
  -- a booking's start, for the quiet-hours exception; null for every other source
  starts_at    timestamptz,
  due_at       timestamptz not null,
  status       text not null default 'pending'
               check (status in ('pending', 'sending', 'sent', 'partial', 'failed', 'skipped')),
  push_status  text check (push_status in ('sent', 'failed', 'skipped')),
  sms_status   text check (sms_status in ('sent', 'failed', 'skipped')),
  attempts     int not null default 0,
  -- codes only (e.g. slack_not_in_channel, twilio_400_21610), never message text
  error_code   text check (error_code is null or length(error_code) <= 120),
  claimed_at   timestamptz,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (org_id, source, source_id)
);

create index hub_lead_alerts_due_idx on public.hub_lead_alerts (due_at) where status = 'pending';

alter table public.hub_lead_alerts enable row level security;
revoke all on public.hub_lead_alerts from anon, authenticated;

comment on table public.hub_lead_alerts is
  'Speed-to-lead queue (hub_231). One row per new lead, deduplicated on (org_id, source, source_id). '
  '/api/cron/lead-alerts sends due rows by Slack DM and SMS to the recipient in org_settings hub_lead_alerts. '
  'Holds no name, email, phone or answer. Service role only: RLS on, no policies.';

alter table public.entry_events drop constraint entry_events_origin_check;
alter table public.entry_events add constraint entry_events_origin_check
  check (origin in ('stage', 'tag', 'contact_tag', 'call', 'import', 'signup'));

-- ===== hub_233_org_vault =====
-- removed:
--   nothing (functions only; no Vault entries are written)

create function public.hub_org_vault_field_ok(p_key text, p_field text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select (p_key, p_field) in (
    ('crm_twilio', 'auth_token'), ('crm_twilio', 'api_key'), ('crm_twilio', 'api_secret'),
    ('crm_ai', 'anthropic_key'), ('crm_ai', 'openai_key'), ('crm_ai', 'gemini_key'), ('crm_ai', 'api_key'),
    ('slack_config', 'bot_token'),
    ('slack_crm_due_dates', 'webhook_url'),
    ('google_drive', 'refresh_token'),
    ('neuroreport_api_key', 'key'), ('neuroreport_api_key', 'api_key'),
    ('stage_email_script', 'secret'), ('stage_email_script', 'url'),
    ('apps_script', 'url'),
    ('gmail', 'apps_script_url')
  )
$function$;

-- ─── get: every stored field for one org and key ─────────────────────────────
create function public.hub_org_vault_get(p_org uuid, p_key text)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select coalesce(jsonb_object_agg(substr(s.name, length('org_cred:' || p_org::text || ':' || p_key || '.') + 1), s.decrypted_secret), '{}'::jsonb)
    from vault.decrypted_secrets s
   where s.name like 'org_cred:' || p_org::text || ':' || replace(replace(p_key, '_', '\_'), '%', '\%') || '.%'
$function$;

-- ─── put: create, update, or delete one field ───────────────────────────────
create function public.hub_org_vault_put(p_org uuid, p_key text, p_field text, p_value text)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  v_name text := 'org_cred:' || p_org::text || ':' || p_key || '.' || p_field;
  v_id   uuid;
begin
  if not public.hub_org_vault_field_ok(p_key, p_field) then
    raise exception 'org_vault_field_not_allowed';
  end if;
  select s.id into v_id from vault.secrets s where s.name = v_name;
  if p_value is null or length(p_value) = 0 then
    if v_id is not null then delete from vault.secrets s where s.id = v_id; end if;
    return;
  end if;
  if v_id is null then
    perform vault.create_secret(p_value, v_name, 'org_settings ' || p_key || '.' || p_field || ' for org ' || p_org::text || ' (hub_233)');
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end
$function$;

revoke all on function public.hub_org_vault_field_ok(text, text) from public, anon, authenticated;
revoke all on function public.hub_org_vault_get(uuid, text) from public, anon, authenticated;
revoke all on function public.hub_org_vault_put(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.hub_org_vault_field_ok(text, text) to service_role;
grant execute on function public.hub_org_vault_get(uuid, text) to service_role;
grant execute on function public.hub_org_vault_put(uuid, text, text, text) to service_role;

commit;

notify pgrst, 'reload schema';
