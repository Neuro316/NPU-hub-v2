-- ═════════════════════════════════════════════════════════════════════════════
-- 205_acct_audit_log.sql   STAGE 1: CAPTURE
-- Append-only audit history for the accounting module. Finding 12.
--
-- APPLIED 2026-08-03 via the project-scoped supabase-write connector, in five
-- discrete statements (table -> function -> grants -> RLS -> triggers), each
-- verified before the next. Applied with execute_sql rather than apply_migration,
-- so there is deliberately NO supabase_migrations.schema_migrations row for this
-- migration -- this file is the record. See CLAUDE.md "Migration Numbering":
-- the ledger keys on a timestamp version, not the filename prefix.
--
-- 203 is Finding 8b's, still unapplied. 204 was the archived_at migration,
-- cancelled (see 6398208). 205 avoids reusing a cancelled number.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 0. PRE-CHECK — run first and read the output ─────────────────────────────
select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname='acct_audit_log') as table_exists_already,
       (select count(*) from public.acct_payments) as payments_now,
       (select count(*) from public.acct_services) as services_now,
       (select count(*) from public.acct_clients)  as clients_now,
       current_user as creating_role;
-- Expect table_exists_already = 0.
-- NOTE creating_role: it determines which pg_default_acl entry applies. Step 3
-- revokes explicitly so the outcome is the same either way.
-- 2026-08-03 actual: 0 / 77 / 59 / 41 / postgres.

-- ── 1. TABLE ─────────────────────────────────────────────────────────────────
create table public.acct_audit_log (
  id          uuid        primary key default gen_random_uuid(),
  org_id      uuid        not null,
  table_name  text        not null check (table_name in ('acct_payments','acct_services','acct_clients')),
  record_id   uuid        not null,
  action      text        not null check (action in ('UPDATE','DELETE')),
  old_data    jsonb       not null,
  new_data    jsonb,
  actor_id    uuid,
  actor_email text,
  actor_role  text,
  changed_at  timestamptz not null default now()
);

-- Deliberately NO foreign keys.
--   actor_id -> auth.users would force ON DELETE SET NULL (erasing the actor when an
--     employee account is removed) or block user deletion entirely. actor_email is
--     stored as TEXT alongside so provenance survives either way. This is the lesson
--     from Finding 8b, where an actor column FK'd to the wrong table could record
--     nobody.
--   record_id -> the source tables would be violated the instant a row is deleted,
--     which is the single most important thing this table must capture.

create index idx_acct_audit_org_time  on public.acct_audit_log (org_id, changed_at desc);
create index idx_acct_audit_table     on public.acct_audit_log (table_name, changed_at desc);
create index idx_acct_audit_record    on public.acct_audit_log (record_id);

comment on table public.acct_audit_log is
  'Append-only history of UPDATE and DELETE on acct_payments, acct_services and '
  'acct_clients. Written ONLY by trigger fn_acct_audit (SECURITY DEFINER). No role '
  'holds INSERT, UPDATE or DELETE, so rows can be neither forged nor altered nor '
  'removed through the API. Finding 12: acct_payments previously had no audit trail '
  'and no DELETE trigger, so a deleted payment left no record it existed.';

comment on column public.acct_audit_log.old_data is
  'Full prior row as jsonb. Sufficient to reconstruct and re-enter a deleted record.';
comment on column public.acct_audit_log.new_data is
  'Full new row on UPDATE; NULL on DELETE.';
comment on column public.acct_audit_log.actor_id is
  'auth.uid() at the time of the change. NULL is legitimate and interpretable: a '
  'service-role API route or direct SQL carries no user JWT. Read with actor_role.';

-- ── 2. TRIGGER FUNCTION ──────────────────────────────────────────────────────
-- SECURITY DEFINER so the insert cannot be refused by the caller's grants or RLS,
-- and so NO role needs an INSERT grant — which is what makes forging a row
-- impossible. search_path is pinned, per migration 032's convention for every
-- SECURITY DEFINER function in this database.
create or replace function public.fn_acct_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claims jsonb;
begin
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;

  insert into public.acct_audit_log
    (org_id, table_name, record_id, action, old_data, new_data,
     actor_id, actor_email, actor_role)
  values
    (OLD.org_id,
     TG_TABLE_NAME,
     OLD.id,
     TG_OP,
     to_jsonb(OLD),
     case when TG_OP = 'UPDATE' then to_jsonb(NEW) else null end,
     auth.uid(),
     v_claims ->> 'email',
     auth.role());

  return null;   -- AFTER trigger; return value is ignored
end;
$$;

comment on function public.fn_acct_audit() is
  'Writes one acct_audit_log row per UPDATE/DELETE on an acct_* table. Generic across '
  'the three tables: each has org_id NOT NULL and a uuid id. SECURITY DEFINER so the '
  'write cannot be blocked or bypassed by the caller.';

-- ── 3. GRANTS — append-only, and unforgeable ─────────────────────────────────
-- Explicit revoke first: pg_default_acl carries a supabase_admin entry that would
-- grant anon AND authenticated full arwdDxtm on a new public table. Do not trust
-- which default applied — revoke, then grant exactly what is wanted.
revoke all on public.acct_audit_log from public;
revoke all on public.acct_audit_log from anon;
revoke all on public.acct_audit_log from authenticated;

grant select on public.acct_audit_log to authenticated;
-- No INSERT: the SECURITY DEFINER trigger inserts as owner.
-- No UPDATE, no DELETE, ever.
-- anon gets nothing at all.
-- service_role retains its default access for backups and future API routes.

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
alter table public.acct_audit_log enable row level security;

create policy acct_audit_log_read_org
  on public.acct_audit_log
  for select
  to authenticated
  using (
    org_id in (
      select tp.org_id from public.team_profiles tp
      where tp.user_id = auth.uid() and tp.status = 'active'
    )
  );
-- There is deliberately NO insert, update or delete policy. Even if a grant were
-- added later by mistake, RLS would still refuse the write. Two independent locks.

-- ── 5. TRIGGERS ──────────────────────────────────────────────────────────────
create trigger trg_acct_payments_audit
  after update or delete on public.acct_payments
  for each row execute function public.fn_acct_audit();

create trigger trg_acct_services_audit
  after update or delete on public.acct_services
  for each row execute function public.fn_acct_audit();

create trigger trg_acct_clients_audit
  after update or delete on public.acct_clients
  for each row execute function public.fn_acct_audit();

-- NOT on INSERT, per constraint 3: a created row is already its own record.
-- NOTE: acct_payments.service_id and acct_clients cascades mean a cascaded DELETE
-- also fires these triggers, so cascade-destroyed rows ARE captured.
