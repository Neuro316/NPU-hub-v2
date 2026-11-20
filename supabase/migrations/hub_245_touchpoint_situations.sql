-- hub_245_touchpoint_situations.sql
--
-- STATUS: PROPOSED 2026-11-20. NOT APPLIED. Needs a go. Applied by the Hub chat: nonprod (cpasntagxhxitavivwlb)
-- first, then production (htfrfaxlcuyawtlztxxm), then NOTIFY pgrst and a read-back.
-- Hub band. hub_244 (the Hub Health ledger reader, PR #70) is proposed; hub_241 is reserved for the support FAQ and
-- hub_234 is held by PR #46. This is 245.
--
-- PURPOSE: Running List q35, touchpoint monitoring Part 1. One row per "waiting on us" situation the detector
--   (src/lib/touchpoints/detect.ts, /api/cron/touchpoints every 30 minutes) finds:
--     situation_key  contact id + situation + the triggering record id. UNIQUE per org, so a situation is raised
--                    at most once, however often it is seen.
--     one open row per contact and kind (partial unique index), so one open board card per contact per situation.
--     cleared_at / cleared_reason  set when it clears on its own (they booked, we replied, they came back).
--     task_id        the board card (kanban_tasks) in "Follow-ups to review". The column is made by code, not here.
--   detail holds ids and times only (link, message, mailbox, thread, booking ids; received, shared, held times):
--   never a subject, a body, a message text, a name or an address.
--
-- ACCESS: RLS on. Staff of the row's org (team_profiles active, role super_admin, admin or team_member) may SELECT.
--   No insert, update or delete policy: only the service role (the cron) writes. Nothing is ever deleted by code.
--
-- READ-BACK:
--   select count(*) from public.hub_touchpoint_situations;                                    -- 0
--   select relrowsecurity from pg_class where oid = 'public.hub_touchpoint_situations'::regclass;   -- true
--   select policyname, cmd from pg_policies where tablename = 'hub_touchpoint_situations';    -- one SELECT policy
--   select indexname from pg_indexes where tablename = 'hub_touchpoint_situations';            -- pkey, key, one_open, contact
--
-- ROLLBACK:
--   begin;
--   drop table if exists public.hub_touchpoint_situations;
--   delete from supabase_migrations.schema_migrations where name = 'hub_245_touchpoint_situations';
--   commit;
--   (Cards already made stay on the board; the column "Follow-ups to review" is left in place.)

begin;

create table public.hub_touchpoint_situations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  contact_id      uuid not null references public.contacts(id) on delete cascade,
  kind            text not null check (kind in ('booking_link_not_booked', 'inbound_no_reply', 'text_no_reply', 'coursework_quiet', 'discovery_no_followup')),
  situation_key   text not null check (length(situation_key) between 1 and 200),
  waiting_since   timestamptz not null,
  opened_at       timestamptz not null default now(),
  cleared_at      timestamptz,
  cleared_reason  text check (cleared_reason is null or length(cleared_reason) <= 200),
  severity        text not null default 'low' check (severity in ('low', 'medium', 'high')),
  detail          jsonb not null default '{}'::jsonb,
  task_id         uuid references public.kanban_tasks(id) on delete set null,
  updated_at      timestamptz not null default now(),
  constraint hub_touchpoint_situations_key unique (org_id, situation_key),
  constraint hub_touchpoint_situations_cleared check ((cleared_at is null) = (cleared_reason is null))
);

create unique index hub_touchpoint_situations_one_open on public.hub_touchpoint_situations (org_id, contact_id, kind) where cleared_at is null;
create index hub_touchpoint_situations_contact on public.hub_touchpoint_situations (contact_id, opened_at desc);

alter table public.hub_touchpoint_situations enable row level security;
revoke all on public.hub_touchpoint_situations from public, anon, authenticated;
grant select on public.hub_touchpoint_situations to authenticated;
grant all on public.hub_touchpoint_situations to service_role;

create policy hub_touchpoint_situations_staff_select on public.hub_touchpoint_situations
  for select to authenticated
  using (exists (
    select 1 from public.team_profiles tp
     where tp.org_id = hub_touchpoint_situations.org_id
       and tp.user_id = auth.uid()
       and tp.status = 'active'
       and tp.role in ('super_admin', 'admin', 'team_member')
  ));

comment on table public.hub_touchpoint_situations is
  'q35 touchpoint monitor: one row per waiting-on-us situation. Ids and times only. Staff of the org read; service role writes.';

commit;
