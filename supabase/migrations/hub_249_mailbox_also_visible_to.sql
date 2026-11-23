-- hub_249_mailbox_also_visible_to.sql
--
-- STATUS: PROPOSED 2026-11-23. NOT APPLIED. Needs a go. Applied by the Hub chat: nonprod (cpasntagxhxitavivwlb)
-- first, then production (htfrfaxlcuyawtlztxxm), then NOTIFY pgrst and a read-back.
-- Hub band. hub_248 (text_waiting_1h kind) is the last; this is 249.
--
-- PURPOSE: decision by Cameron, 2026-11-23. A per-mailbox list of users who see that mailbox exactly as its owner does,
--   private mailboxes included. It is NOT the 'shared' visibility: nobody who is not listed gains anything, and a private
--   mailbox stays owner-only for every other superadmin. The Hub decides with one rule, ownerEquivalent
--   (src/lib/mail/access.ts). Only the owner may change the list (Settings, Mailboxes; PATCH /api/mail/connections),
--   and each change is logged in job_runs (job 'mailbox-also-visible-to').
--   Schema only: no data here. Listing Shane on Cameron's mailboxes is a separate data proposal.
--
-- READ-BACK:
--   select column_name, data_type, is_nullable, column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'hub_mail_connections' and column_name = 'also_visible_to';
--     -- ARRAY, NO, '{}'::uuid[]
--   select indexname from pg_indexes where tablename = 'hub_mail_connections' and indexname = 'hub_mail_connections_also_visible_to';
--   select count(*) from public.hub_mail_connections where cardinality(also_visible_to) > 0;   -- 0
--
-- ROLLBACK:
--   begin;
--   drop index if exists public.hub_mail_connections_also_visible_to;
--   alter table public.hub_mail_connections drop column if exists also_visible_to;
--   delete from supabase_migrations.schema_migrations where name = 'hub_249_mailbox_also_visible_to';
--   commit;
--   (The code reads the column only when it exists, so after a rollback everyone keeps the owner and shared rule.)

begin;

alter table public.hub_mail_connections
  add column also_visible_to uuid[] not null default '{}';

create index hub_mail_connections_also_visible_to on public.hub_mail_connections using gin (also_visible_to);

comment on column public.hub_mail_connections.also_visible_to is
  'Users (profiles ids) who see this mailbox exactly as its owner does, private mail included. Not the shared visibility: nobody else gains access. Only the owner changes it (Settings, Mailboxes); changes are logged in job_runs.';

commit;
