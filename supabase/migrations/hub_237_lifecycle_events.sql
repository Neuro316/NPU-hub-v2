-- hub_237_lifecycle_events.sql
--
-- STATUS: APPLIED 2026-11-16 14:47 CST, nonprod then production, by the Hub chat on Shane's go. Order: nonprod (cpasntagxhxitavivwlb) first, then production
-- (htfrfaxlcuyawtlztxxm), from the Hub chat, each followed by NOTIFY pgrst and the read-back at the bottom.
-- Nonprod needs supabase/nonprod/catchup_2026-11-16.sql first (this depends on hub_212 and hub_231's origin check).
--
-- PURPOSE: the lifecycle engine (Hub Running List q06, q07, q19, q20, q21; src/lib/lifecycle).
--   1. public.hub_lifecycle_events: one row per lifecycle event (booking made, held, missed, cancelled; checkout
--      started and unpaid after an hour; purchase; consent signed; first lesson; first practice; 5 and 10 days
--      inactive; activity resumed; program end; lead follow-ups). UNIQUE (org_id, event_key) is what makes each
--      event happen once. In dry_run a row records what WOULD happen (planned) and is never applied; in live it is
--      applied once (applied_at). Ids, codes and product classes only: no names, addresses, answers or amounts.
--   2. One open follow-up task per contact per reason: a partial unique index on public.tasks for rows whose
--      source starts 'hub_followup:' and whose status is todo or in_progress. No existing row has that source
--      (checked 2026-11-16), so the index builds without conflict.
--   3. entry_events.origin gains 'lifecycle', so a lifecycle event can queue a campaign entry through the existing
--      raise_entry_event (which still queues nothing unless the engine flag is on AND an ACTIVE route listens).
--
-- ADDITIVE ONLY. No existing table, column, trigger or function changes, except the origin check, which widens.
--
-- ACCESS: hub_lifecycle_events has RLS on with NO policies and no grants to anon or authenticated: service role only.
--
-- ROLLBACK:
--   begin;
--   drop table if exists public.hub_lifecycle_events;
--   drop index if exists public.tasks_hub_followup_one_open;
--   delete from public.entry_events where origin = 'lifecycle';
--   alter table public.entry_events drop constraint entry_events_origin_check;
--   alter table public.entry_events add constraint entry_events_origin_check
--     check (origin in ('stage', 'tag', 'contact_tag', 'call', 'import', 'signup'));
--   commit;
--   notify pgrst, 'reload schema';

begin;

create table public.hub_lifecycle_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  contact_id   uuid references public.contacts(id) on delete set null,
  event_key    text not null check (length(event_key) between 1 and 200),
  event_type   text not null check (event_type in (
                 'lead_arrived', 'lead_no_touch_24h',
                 'booking_made', 'booking_held', 'booking_no_show', 'booking_cancelled', 'held_no_purchase_2d',
                 'coaching_booked', 'coaching_held',
                 'checkout_started', 'checkout_unpaid_1h', 'purchase', 'consent_signed', 'first_lesson_opened', 'first_practice',
                 'inactive_5d', 'inactive_10d', 'activity_resumed', 'program_end')),
  occurred_at  timestamptz not null,
  source       text not null,
  source_id    text,
  detail       jsonb not null default '{}'::jsonb,
  mode         text not null check (mode in ('dry_run', 'live')),
  planned      jsonb not null default '{}'::jsonb,
  applied_at   timestamptz,
  applied      jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  unique (org_id, event_key),
  check (mode = 'live' or applied_at is null)
);
create index hub_lifecycle_events_contact on public.hub_lifecycle_events (org_id, contact_id, event_type, occurred_at desc);
create index hub_lifecycle_events_pending on public.hub_lifecycle_events (org_id, occurred_at) where mode = 'live' and applied_at is null;
alter table public.hub_lifecycle_events enable row level security;
revoke all on public.hub_lifecycle_events from anon, authenticated;
comment on table public.hub_lifecycle_events is
  'Hub lifecycle engine ledger (hub_237). One row per event, unique on (org_id, event_key). dry_run rows are never applied. Service role only.';

create unique index tasks_hub_followup_one_open on public.tasks (contact_id, source)
  where source like 'hub_followup:%' and status in ('todo', 'in_progress');

alter table public.entry_events drop constraint entry_events_origin_check;
alter table public.entry_events add constraint entry_events_origin_check
  check (origin in ('stage', 'tag', 'contact_tag', 'call', 'import', 'signup', 'lifecycle'));

commit;

notify pgrst, 'reload schema';

-- READ-BACK (after applying):
--   select name from supabase_migrations.schema_migrations where name = 'hub_237_lifecycle_events';
--   select relrowsecurity from pg_class where oid = 'public.hub_lifecycle_events'::regclass;            -- true
--   select count(*) from pg_policies where tablename = 'hub_lifecycle_events';                          -- 0
--   select indexdef from pg_indexes where indexname = 'tasks_hub_followup_one_open';
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'entry_events_origin_check';    -- includes lifecycle
