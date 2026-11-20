-- hub_246_drafts.sql
--
-- STATUS: PROPOSED 2026-11-20. NOT APPLIED. Needs a go. Applied by the Hub chat: nonprod (cpasntagxhxitavivwlb)
-- first, then production (htfrfaxlcuyawtlztxxm), then NOTIFY pgrst and a read-back.
-- Hub band. hub_244 (#70) and hub_245 (#71) are proposed; hub_241 is reserved for the support FAQ and hub_234 is held
-- by PR #46. This is 246.
--
-- PURPOSE: drafts and review, PR 1 (Running List q10 support drafts; q35 Part 2 follow-ups will use kind 'followup').
--   hub_drafts: one row per message the drafter handled. It is a POINTER to a Gmail draft and nothing more:
--     connection_id, gmail_thread_id, gmail_draft_id and gmail_draft_message_id (to open it in Gmail)
--     source_table / source_id (the hub_mail_messages row), contact_id, status and its review and send times
--     reason        a short code: the hard-stop class for needs_person (clinical, legal, financial, crisis) or the
--                   skip code (thanks_only, invalid)
--     draft_shape   counts only (words, paragraphs, questions, links, greeting style, sign-off): what the learning
--                   loop compares with once Gmail has removed the sent draft
--     lesson        ONE sentence, at most 200 characters, about wording or structure, written after the draft was sent
--   THERE IS NO SUBJECT, BODY OR DRAFT TEXT COLUMN, and none may be added: Cameron's rule of 2026-11-18.
--   'skipped' records a message that was read and found not to need a draft (a thank-you), so it is never read again.
--
-- ACCESS: RLS on. Staff of the row's org (team_profiles active, role super_admin, admin or team_member) may SELECT.
--   The mailbox privacy rule (a private mailbox's drafts to its owner only) is enforced in the Hub's routes with
--   mailView, as the Communications section does; the browser never reads this table directly. No insert, update or
--   delete policy: only the service role writes.
--
-- DRAFTING STAYS OFF until org_settings 'hub_drafts_mode' is set to 'on' for an org (a separate go, no SQL here).
--
-- READ-BACK:
--   select count(*) from public.hub_drafts;                                                  -- 0
--   select relrowsecurity from pg_class where oid = 'public.hub_drafts'::regclass;           -- true
--   select policyname, cmd from pg_policies where tablename = 'hub_drafts';                  -- one SELECT policy
--   select column_name from information_schema.columns where table_name = 'hub_drafts'
--    and column_name ~ '(subject|body|text|content)';                                        -- no rows
--
-- ROLLBACK:
--   begin;
--   drop table if exists public.hub_drafts;
--   delete from supabase_migrations.schema_migrations where name = 'hub_246_drafts';
--   commit;
--   (Drafts already saved in Gmail stay in Gmail; nothing in Gmail is touched by the rollback.)

begin;

create table public.hub_drafts (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  connection_id           uuid not null references public.hub_mail_connections(id) on delete cascade,
  gmail_thread_id         text not null check (gmail_thread_id ~ '^[0-9a-f]{1,32}$'),
  gmail_draft_id          text check (gmail_draft_id is null or gmail_draft_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  gmail_draft_message_id  text check (gmail_draft_message_id is null or gmail_draft_message_id ~ '^[0-9a-f]{1,32}$'),
  kind                    text not null check (kind in ('support', 'followup')),
  source_table            text not null check (source_table in ('hub_mail_messages', 'hub_touchpoint_situations')),
  source_id               uuid not null,
  contact_id              uuid references public.contacts(id) on delete set null,
  status                  text not null check (status in ('drafted', 'approved', 'edited', 'rejected', 'sent', 'needs_person', 'skipped')),
  reason                  text check (reason is null or reason in ('clinical', 'legal', 'financial', 'crisis', 'thanks_only', 'invalid')),
  draft_shape             jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  reviewed_at             timestamptz,
  reviewed_by             uuid references public.profiles(id) on delete set null,
  sent_at                 timestamptz,
  lesson                  text check (lesson is null or (length(lesson) between 1 and 200 and lesson !~ '[@\n]')),
  constraint hub_drafts_once unique (source_table, source_id, kind),
  constraint hub_drafts_pointer check ((status in ('drafted', 'approved', 'edited', 'sent')) = (gmail_draft_id is not null) or status = 'rejected'),
  constraint hub_drafts_reviewed check ((reviewed_by is null) or (reviewed_at is not null))
);

create index hub_drafts_connection on public.hub_drafts (connection_id, created_at desc);
create index hub_drafts_learning on public.hub_drafts (status) where status in ('approved', 'edited');
create index hub_drafts_lessons on public.hub_drafts (org_id, sent_at desc) where lesson is not null;

alter table public.hub_drafts enable row level security;
revoke all on public.hub_drafts from public, anon, authenticated;
grant select on public.hub_drafts to authenticated;
grant all on public.hub_drafts to service_role;

create policy hub_drafts_staff_select on public.hub_drafts
  for select to authenticated
  using (exists (
    select 1 from public.team_profiles tp
     where tp.org_id = hub_drafts.org_id
       and tp.user_id = auth.uid()
       and tp.status = 'active'
       and tp.role in ('super_admin', 'admin', 'team_member')
  ));

comment on table public.hub_drafts is
  'q10 drafts: a pointer to a Gmail draft (never its text), its review status and one lesson sentence. Staff of the org read; service role writes.';

commit;
