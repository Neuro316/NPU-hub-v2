-- hub_217_mail_triage.sql
--
-- STATUS: APPLIED 2026-11-02 to production (htfrfaxlcuyawtlztxxm) only, through the
-- Supabase connector as migration name hub_217_mail_triage (body without the
-- begin/commit wrapper). Ledger version: 20261102203515 (UTC).
-- Read back after apply: hub_mail_messages RLS on, 0 policies; anon/authenticated/PUBLIC
-- have no grants on hub_mail_messages or hub_mail_connections; service_role reads and
-- writes; hub_mail_connections has gmail_history_id and last_synced_at; 0 message rows.
-- Not applied to npu-platform-nonprod: the Hub has no nonprod.
--
-- Hub band (200+). Checked 2026-11-01: files and ledger stop at hub_216
-- (hub_215 is in the ledger only, see hub_216's header). This is 217.
--
-- PURPOSE: phase 2 of the inbox agent, sync and triage, read-only
-- (docs/plans/hub-mail-triage-rulings.md).
--
-- 1. hub_mail_connections gains the Gmail sync cursor:
--      gmail_history_id  the history id the next history.list starts from. NULL means
--                        "never synced": the first run stores the current id and
--                        imports nothing older.
--      last_synced_at    the last run that read history for this mailbox.
-- 2. hub_mail_messages: one row per new INBOX message, metadata and AI triage only.
--    NO message bodies are stored. A row is created as soon as history.list reports
--    the message (from/subject/received_at/category still NULL), then filled by the
--    triage step; triaged_at NULL means "waiting for triage". After 3 failed attempts
--    the row keeps whatever metadata was read and triage_error says why.
--
--   category          scheduling | lead | participant_support | partner_outreach |
--                     personal | legal_financial | clinical | vendor_billing |
--                     security_alert | newsletter | spam
--   priority          urgent | normal | low
--   summary           AI, max 300 chars
--   suggested_action  AI, max 300 chars
--   status            new | seen | done (set by the inbox view)
--
-- Deleting a connection deletes its messages (cascade). A revoked connection keeps
-- its rows; the inbox view applies the connection's visibility either way.
--
-- ACCESS: RLS on with no policies; anon and authenticated have no privileges.
-- service_role only, through /api/cron/mail-sync and /api/mail/messages, which
-- check CRON_SECRET or superadmin + mailbox visibility.
--
-- ROLLBACK:
--   begin;
--   drop table if exists public.hub_mail_messages;
--   alter table public.hub_mail_connections drop column if exists gmail_history_id,
--                                           drop column if exists last_synced_at;
--   delete from supabase_migrations.schema_migrations where name = 'hub_217_mail_triage';
--   commit;

begin;

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

commit;
