-- hub_242_mail_search_log.sql
--
-- STATUS: PROPOSED 2026-11-18, NOT APPLIED. Needs a go. Applied by the Hub chat: nonprod (cpasntagxhxitavivwlb)
-- first, then production (htfrfaxlcuyawtlztxxm), then NOTIFY pgrst and a read-back.
--
-- Hub band (200+). Production's ledger ends at hub_240_resource_links (checked 2026-11-18). hub_241 is reserved for
-- the support FAQ (docs/plans/support-drafts.md) and hub_234 for the open scheduling-agent branch (PR #46). This
-- is 242.
--
-- PURPOSE: Running List q26, the audit log for POST /api/agent/mail-search. One row per search, written BEFORE any
-- mailbox is read (no row, no search) and completed with counts afterwards. It is also what the per-caller rate
-- limit counts.
--
-- WHAT IS NEVER HERE: the search terms, any subject, address, snippet or body, or any mailbox address. Only the
-- caller's user id, how they authenticated, the mode, an HMAC-SHA256 of the terms keyed by MAIL_SEARCH_LOG_KEY
-- (repeats can be matched, the terms cannot be read back), the term count, the date range, the connection ids
-- searched and three counts.
--
-- ACCESS, matching hub_mail_messages and hub_resources: RLS on, no policies, no privileges for anon or
-- authenticated, so only the service role reaches it.
--
-- ROLLBACK:
--   begin;
--   drop table if exists public.hub_mail_search_log;
--   delete from supabase_migrations.schema_migrations where name = 'hub_242_mail_search_log';
--   commit;

begin;

create table public.hub_mail_search_log (
  id                  uuid primary key default gen_random_uuid(),
  caller_user_id      uuid not null,
  via                 text not null check (via in ('session', 'agent_key')),
  mode                text not null check (mode in ('search', 'thread')),
  terms_hash          text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  term_count          integer not null check (term_count between 0 and 10),
  date_from           date not null,
  date_to             date not null,
  mailbox_ids         uuid[] not null default '{}',
  not_searched_count  integer not null default 0 check (not_searched_count >= 0),
  message_count       integer not null default 0 check (message_count >= 0),
  status              text not null default 'started' check (status in ('started', 'done', 'failed')),
  searched_at         timestamptz not null default now(),
  constraint hub_mail_search_log_range check (date_from <= date_to)
);

create index hub_mail_search_log_caller on public.hub_mail_search_log (caller_user_id, searched_at desc);

alter table public.hub_mail_search_log enable row level security;
revoke all on public.hub_mail_search_log from public, anon, authenticated;
grant all on public.hub_mail_search_log to service_role;

commit;
