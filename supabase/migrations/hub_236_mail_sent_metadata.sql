-- hub_236_mail_sent_metadata.sql
--
-- STATUS: PROPOSED 2026-11-10. NOT APPLIED. Needs a go. Production (htfrfaxlcuyawtlztxxm) only.
-- (hub_232/hub_234/hub_235 are proposed or applied on other branches; this takes the next number.)
--
-- PURPOSE: speed to lead counts a Gmail reply as a touch (closes metrics gap G6, docs/metrics/definitions.md).
--   1. public.hub_mail_sent: one row per recipient of a message added to a connected mailbox's SENT label.
--      METADATA ONLY: connection, Gmail message and thread id, the recipient's address (lower case) and the sent
--      time. No subject, no body, no sender name, no cc/bcc distinction. Written by /api/cron/mail-sync.
--   2. hub_mail_connections.gmail_sent_history_id: a separate cursor for the SENT label, so the existing INBOX
--      cursor and its behaviour are untouched. NULL = first run: store the current history id, import nothing
--      (never back-fill, the same rule as the inbox).
--
-- PRIVACY (the mail rule of 2026-11-09 is unchanged): rows are stored for every active mailbox, but metrics read
-- only rows whose connection is visibility = 'shared'; a private mailbox never appears in any metric. Deleting a
-- connection deletes its rows (on delete cascade).
--
-- ACCESS: RLS on with NO policies, and no grants to anon or authenticated. Service role only.
--
-- ROLLBACK:
--   begin;
--   drop table if exists public.hub_mail_sent;
--   alter table public.hub_mail_connections drop column if exists gmail_sent_history_id;
--   commit;

begin;

alter table public.hub_mail_connections add column gmail_sent_history_id text;

create table public.hub_mail_sent (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.hub_mail_connections(id) on delete cascade,
  gmail_message_id text not null,
  gmail_thread_id text not null,
  to_address text not null check (to_address = lower(to_address) and position('@' in to_address) > 1),
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (connection_id, gmail_message_id, to_address)
);
create index hub_mail_sent_to_address_idx on public.hub_mail_sent (to_address, sent_at);

alter table public.hub_mail_sent enable row level security;
revoke all on public.hub_mail_sent from anon, authenticated;

commit;
