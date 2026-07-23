-- 077_stage_email_send_guard.sql
-- Idempotency for stage emails: a contact must not receive the same stage email
-- twice because a card was dragged out of a stage and back in.
--
-- WHY A CLAIM, NOT A CHECK: the obvious shape is "SELECT, if none then send,
-- then INSERT". Two fast drags race that: both SELECT empty, both send. So the
-- route INSERTS FIRST (claiming the slot) and only sends if the insert won. The
-- unique index is the arbiter, and it is the DB that decides — not the client,
-- which can be raced, reloaded, or bypassed by calling the route directly.
--
-- WHY stage_id AND NOT stage NAME: fireStageEmails currently passes the stage
-- NAME. Keying the guard on a name means renaming a stage silently re-arms every
-- email on it for every contact that already received one. The pipeline JSON
-- already carries a stable per-stage `id` (and per-email `id`); those are the key.
--
-- WHY A PARTIAL INDEX: only 'sending' (in flight) and 'sent' (done) may block a
-- later attempt. A 'failed' row must NOT block, or one transient Apps Script
-- error would permanently bar that contact from ever receiving that email.

create table if not exists public.stage_email_sends (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  contact_id          uuid not null references public.contacts(id)      on delete cascade,

  -- Stable identifiers from org_settings.crm_pipelines — NOT display names.
  pipeline_id         text not null,
  stage_id            text not null,
  email_id            text not null,

  recipient           text not null check (recipient in ('client','internal')),
  to_email            text,

  status              text not null default 'sending'
                        check (status in ('sending','sent','failed')),
  external_message_id text,
  error_message       text,

  claimed_at          timestamptz not null default now(),
  sent_at             timestamptz
);

-- The guard. Only in-flight and successful sends occupy the slot.
create unique index if not exists stage_email_sends_once
  on public.stage_email_sends (contact_id, stage_id, email_id)
  where status in ('sending','sent');

-- Stale-claim reaping (see route step 0) scans by status + age.
create index if not exists stage_email_sends_stale
  on public.stage_email_sends (status, claimed_at)
  where status = 'sending';

-- Reporting / debugging: "what did this contact receive, when".
create index if not exists stage_email_sends_contact
  on public.stage_email_sends (contact_id, claimed_at desc);

-- ── Lockdown ───────────────────────────────────────────────────────────────
-- Written only by /api/crm/stage-emails via the service role. No browser path
-- writes here; a client that could INSERT could pre-claim a slot and suppress a
-- real send, or delete a claim and force a duplicate.
alter table public.stage_email_sends enable row level security;

revoke all on public.stage_email_sends from public;
revoke all on public.stage_email_sends from anon;
revoke all on public.stage_email_sends from authenticated;
grant select, insert, update on public.stage_email_sends to service_role;

comment on table public.stage_email_sends is
  'Idempotency ledger for pipeline stage emails. One row per (contact, stage, email) '
  'attempt; the partial unique index on status in (sending,sent) is what prevents a '
  'drag-out/drag-back from re-sending. Service role only.';

-- Verification:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.stage_email_sends'::regclass;
--   select indexname, indexdef from pg_indexes
--    where tablename = 'stage_email_sends';
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'stage_email_sends';   -- expect service_role only
--
-- Manual re-arm (if you ever need to deliberately re-send without force:true):
--   update public.stage_email_sends set status = 'failed'
--    where contact_id = '...' and stage_id = '...' and email_id = '...';
