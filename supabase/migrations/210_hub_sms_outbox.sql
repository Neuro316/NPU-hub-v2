-- 210_hub_sms_outbox.sql
--
-- STATUS: APPLIED 2026-09-30 by hand through the Supabase connector as migration name 210_hub_sms_outbox.
-- When applied, read supabase_migrations.schema_migrations back and record the
-- real ledger version here.
--
-- Hub band (200+). Checked 2026-09-30: files stop at 209, and the ledger has no
-- 210 row and no public.hub_sms_outbox.
--
-- PURPOSE: an outbox for texts the Hub sends to the owner of a user_id outside a
-- live conversation. Scheduled tasks INSERT a row; /api/cron/sms-outbox claims it
-- and sends through src/lib/notify-sms.ts (consent gate, Primary line, split into
-- parts of at most 1500 characters, each part logged to Conversations).
--
-- ACCESS: RLS on with NO policies, and no grants to anon or authenticated. Only
-- service_role (rolbypassrls) and postgres can read or write it.
--
-- ROLLBACK:
--   begin;
--   drop table if exists public.hub_sms_outbox;
--   commit;

begin;

create table public.hub_sms_outbox (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  user_id     uuid not null,
  body        text not null check (length(body) between 1 and 18500),
  source      text,
  status      text not null default 'pending'
              check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts    int not null default 0,
  sent_parts  int not null default 0,
  total_parts int,
  last_error  text,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  sent_at     timestamptz
);

create index hub_sms_outbox_pending_idx
  on public.hub_sms_outbox (status, created_at)
  where status = 'pending';

alter table public.hub_sms_outbox enable row level security;
revoke all on public.hub_sms_outbox from anon, authenticated;

comment on table public.hub_sms_outbox is
  'Outbox for texts the Hub sends to the owner of user_id outside a live conversation. '
  'Scheduled tasks insert rows; /api/cron/sms-outbox claims one at a time (pending to sending) '
  'and sends through the same path as POST /api/notify/sms: consent gate, Primary line, '
  'parts of at most 1500 characters. A row that fails after any part went out, or is stuck '
  'in sending, is failed and never resent. Service role only: RLS on, no policies.';

commit;
