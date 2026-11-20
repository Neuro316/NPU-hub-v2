-- hub_247_priority_feedback.sql
--
-- STATUS: PROPOSED 2026-11-20. NOT APPLIED. Needs a go. Applied by the Hub chat: nonprod (cpasntagxhxitavivwlb)
-- first, then production (htfrfaxlcuyawtlztxxm), then NOTIFY pgrst and a read-back.
-- Hub band. hub_244, hub_245 and hub_246 are applied; hub_241 is reserved for the support FAQ and hub_234 is held
-- by PR #46. This is 247.
--
-- PURPOSE: drafts reviewed in the Inbox (feat/drafts-inbox-review).
--   1. hub_priority_feedback: one row each time a person changes an email's priority with the Inbox priority pill.
--      Ids, the two priorities, a reason code, who and when. NO SUBJECT, SUMMARY, BODY OR ADDRESS COLUMN: the sender
--      address is read through message_id when triage looks up corrections for the same sender and category.
--   2. hub_drafts.is_pinned and hub_drafts.retired_at: the Learning tab's Pin and Retire. A pinned lesson always goes
--      to compose; a retired lesson never does.
--
-- ACCESS: RLS on. Staff of the row's org (team_profiles active, role super_admin, admin or team_member) may SELECT.
--   The mailbox privacy rule (a private mailbox's rows to its owner only) is enforced in the Hub's routes; the browser
--   never reads this table directly. No insert, update or delete policy: only the service role writes.
--
-- READ-BACK:
--   select count(*) from public.hub_priority_feedback;                                        -- 0
--   select relrowsecurity from pg_class where oid = 'public.hub_priority_feedback'::regclass; -- true
--   select policyname, cmd from pg_policies where tablename = 'hub_priority_feedback';        -- one SELECT policy
--   select column_name from information_schema.columns where table_name = 'hub_priority_feedback'
--    and column_name ~ '(subject|summary|body|text|content|address)';                         -- no rows
--   select column_name, data_type, column_default from information_schema.columns
--    where table_name = 'hub_drafts' and column_name in ('is_pinned', 'retired_at');           -- two rows
--
-- ROLLBACK:
--   begin;
--   drop table if exists public.hub_priority_feedback;
--   drop index if exists public.hub_drafts_lessons_live;
--   alter table public.hub_drafts drop column if exists is_pinned, drop column if exists retired_at;
--   delete from supabase_migrations.schema_migrations where name = 'hub_247_priority_feedback';
--   commit;
--   (Priorities already changed on hub_mail_messages stay as set; pins and retirements are lost.)

begin;

create table public.hub_priority_feedback (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  message_id     uuid not null references public.hub_mail_messages(id) on delete cascade,
  connection_id  uuid not null references public.hub_mail_connections(id) on delete cascade,
  from_priority  text check (from_priority is null or from_priority in ('urgent', 'normal', 'low')),
  to_priority    text not null check (to_priority in ('urgent', 'normal', 'low')),
  reason         text check (reason is null or reason in ('deadline', 'client', 'lead', 'partner', 'not_important')),
  set_by         uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index hub_priority_feedback_message on public.hub_priority_feedback (message_id, created_at desc);
create index hub_priority_feedback_org on public.hub_priority_feedback (org_id, created_at desc);

alter table public.hub_priority_feedback enable row level security;
revoke all on public.hub_priority_feedback from public, anon, authenticated;
grant select on public.hub_priority_feedback to authenticated;
grant all on public.hub_priority_feedback to service_role;

create policy hub_priority_feedback_staff_select on public.hub_priority_feedback
  for select to authenticated
  using (exists (
    select 1 from public.team_profiles tp
     where tp.org_id = hub_priority_feedback.org_id
       and tp.user_id = auth.uid()
       and tp.status = 'active'
       and tp.role in ('super_admin', 'admin', 'team_member')
  ));

comment on table public.hub_priority_feedback is
  'Inbox priority corrections: ids, from and to priority, a reason code, who and when. No email text. Staff of the org read; service role writes.';

alter table public.hub_drafts
  add column is_pinned  boolean not null default false,
  add column retired_at timestamptz;

create index hub_drafts_lessons_live on public.hub_drafts (org_id, is_pinned desc, reviewed_at desc)
  where lesson is not null and retired_at is null;

comment on column public.hub_drafts.is_pinned is 'Learning tab: a pinned lesson always goes to compose.';
comment on column public.hub_drafts.retired_at is 'Learning tab: a retired lesson never goes to compose.';

commit;
