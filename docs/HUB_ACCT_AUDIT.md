# Accounting Audit History — Stage 1: Capture

**Written 2026-08-03 as output-only. APPLIED 2026-08-03** via the project-scoped
`supabase-write` connector, in five verified steps. Committed as
`supabase/migrations/205_acct_audit_log.sql` (`ef48aad`) — applied with `execute_sql`,
so there is deliberately **no `schema_migrations` ledger row**; that file is the record.
**Do not re-run the SQL below.**

Investigation connector verified read-only and project-scoped: `transaction_read_only = on`,
`current_user = supabase_read_only_user`, project `htfrfaxlcuyawtlztxxm`.

Addresses **Finding 12** directly rather than deferring it.

---

## Investigation

### (a) The three tables — full columns, from `pg_catalog`

| Table | Columns |
|---|---|
| `acct_payments` | `id, org_id, service_id, client_id, amount, payment_date, notes, split_snw, split_clinic, split_dr, clinic_id, payout_date, payout_period, is_paid_out, created_at` |
| `acct_services` | `id, org_id, client_id, service_type, amount, service_date, notes, created_at, updated_at` |
| `acct_clients` | `id, org_id, name, location_id, crm_contact_id, notes, created_at, updated_at, date_of_birth, phone, email, address_street, address_city, address_state, address_zip, enrolled_contact_id` |

All three carry `org_id NOT NULL` and a `uuid` primary key named `id`, so one generic
trigger function serves all three. Capturing `to_jsonb(OLD)` satisfies constraint 4 for
every column including the payment fields named in the brief.

### (b) Does `auth.uid()` resolve inside a trigger? **Yes — with one caveat that matters**

Read from the catalogue rather than assumed:

```sql
auth.uid()  = coalesce(nullif(current_setting('request.jwt.claim.sub',  true),''),
                       nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub')::uuid
auth.role() = ... same shape, 'role' claim
auth.jwt()  = current_setting('request.jwt.claims')::jsonb
```

These read **session GUCs**, set by PostgREST per request. A trigger executes in the
same session and the same transaction as the statement that fired it, so `auth.uid()`
resolves inside a trigger exactly as it does inside an RLS policy. `SECURITY DEFINER`
does not change this — it changes the effective *role*, not the session settings.

**Precedent:** of 33 trigger functions in `public`, exactly **one** already calls
`auth.uid()` — `set_cohort_session_org` (positive control: the scan sees all 33, so
"1" is a real count). So this is established practice here, if only barely.

**THE CAVEAT, stated plainly rather than discovered later.** `auth.uid()` is NULL
whenever there is no user JWT on the session:

| Caller | `actor_id` |
|---|---|
| Browser, anon key + signed-in user (**every Accounting write today**) | **populated** |
| API route using `createAdminSupabase()` (service role) | **NULL** — service-role JWTs carry no `sub` |
| Supabase SQL Editor / psql / a migration | **NULL** |

So the actor column is **legitimately nullable**, and a NULL is meaningful rather than
broken. To make a NULL *interpretable* the design also captures `actor_role`
(`auth.role()` → `authenticated` / `service_role` / null) and `actor_email` from the JWT.
A row with `actor_id` NULL and `actor_role = 'service_role'` says "a backend job did
this"; NULL/NULL says "this was done directly against the database".

**This is not a column that will always be null.** Every write the Accounting module
makes today comes from the browser under a user JWT.

> **CONFIRMED IN PRODUCTION, 2026-08-03.** A real service deletion performed from the
> Accounting screen produced an audit row with the actor fully populated:
>
> ```
> record_id   beb4f1c7-07a0-4495-abf6-278b22573c73
> action      DELETE
> actor_id    22456608-5f7d-495e-af02-7037fea125cc
> actor_email cameron@neuroprogeny.com
> actor_role  authenticated
> ```
>
> The GUC argument above holds: `auth.uid()`, `auth.role()` and the `email` claim all
> resolve inside a `SECURITY DEFINER` trigger, in the same session and transaction as the
> statement that fired it. This was observed on a **DELETE**, which is the stronger case —
> it is exactly the Finding 12 scenario, and the row it captured is the record that would
> otherwise not exist.

### (c) Is an existing audit table a model worth matching?

19 audit-style relations exist. Four are structurally relevant:

| Table | Shape | Rows | Verdict |
|---|---|---|---|
| `audit_log` | `org_id, user_id, user_name, user_email, action, resource_type, resource_id, resource_name, details, page_path, session_id, duration_ms` | 150 (150 non-null actor) | **Application-level.** `page_path`/`session_id`/`duration_ms` are browser context a trigger cannot see. Not a trigger model. |
| `nr_audit_log` | `org_id, user_id, action, table_name, record_id, new_data, ip_address, user_agent` | 0 | **Closest structural match** — and the shape this design follows. |
| `snw_audit_log` | `org_id, user_id, action, entity_type, entity_id, changes, ip_address` | 0 | Similar; `changes` is less explicit than `old_data`/`new_data`. |
| `change_history` | `org_id, user_id, resource_type, resource_id, field_name, old_value, new_value` | — | Per-field rows. Verbose for full-row capture, and cannot reconstruct a deleted row atomically. |

**Following `nr_audit_log`, with one necessary departure: it stores `new_data` only.**
Finding 12 exists because a *deleted* row leaves nothing behind, and reconstructing a
deletion requires the **prior** row. So this design stores `old_data` (always) and
`new_data` (on UPDATE only). None of the four existing tables would have solved
Finding 12.

**`audit_log`'s 150/150 non-null actors do not prove trigger-level capture** — that table
is written by application code passing `user.id` explicitly. The trigger argument rests
on the GUC semantics in (b), not on that number.

### (d) RLS, and what append-only actually requires here

**No existing audit table is append-only.** All three carry `authenticated=arwdxtm` —
which includes **UPDATE and DELETE**. `nr_audit_log` is a model for *shape* and
emphatically **not** for *protection*.

**Default privileges will not save us, and could betray us.** `pg_default_acl` holds two
competing entries for tables in `public`:

| Granting role | Default grants on a new table |
|---|---|
| `postgres` | `postgres`, `service_role` only |
| `supabase_admin` | `postgres`, `service_role`, **`anon`**, **`authenticated`** — all of `arwdDxtm` |

Which one applies depends on **who runs the DDL**. If the table is created under a role
whose defaults include `supabase_admin`'s entry, it silently arrives with full
`authenticated` write access. The SQL below therefore **revokes explicitly** rather than
trusting the default, and verifies with `aclexplode` afterwards.

**Org scoping — and how, given Phase 1 has not shipped.** Scoped on **`team_profiles`**:

```sql
org_id in (select tp.org_id from public.team_profiles tp
            where tp.user_id = auth.uid() and tp.status = 'active')
```

Justification:
- It is already the Hub's de facto authority substrate (~20 tables) and the middleware gate.
- **Phase 0 is complete** (`HUB_ROLE_DECOUPLING.md` §13): 12 rows, **0 unlinked**, every
  Hub operator holds a correct active row. That completion is precisely what makes
  `team_profiles` safe to key on *now*.
- It adds **no new `org_members` dependency**, which Phase 2 is removing.
- It is where Phase 1 is heading, so this policy will not need rewriting afterwards.

**This deliberately does not replicate Finding 11.** The new table is org-scoped from the
first line, unlike `acct_services`/`acct_payments`/`acct_clients`.

### One deliberate deviation from the brief

Constraint 2 says *"Grant INSERT only; no UPDATE and no DELETE."* This design grants
**SELECT only** to `authenticated`, and no INSERT — because the trigger function is
`SECURITY DEFINER` and inserts as its owner.

**That is strictly stronger.** With an INSERT grant, any authenticated user could forge an
audit row via direct PostgREST — writing a fabricated history is a different attack from
editing one, and an INSERT grant permits it. With SELECT-only + `SECURITY DEFINER`, the
**only** way a row enters the table is a real change to a real accounting row.

---

## STAGE 1 SQL — APPLIED 2026-08-03. DO NOT RE-RUN.

Migration `205`. Hub band per `CLAUDE.md` §13.1. (`203` is Finding 8b's, still unapplied;
`204` was the `archived_at` migration, **cancelled** — see `6398208`. `205` avoids reusing
a cancelled number.)

```sql
-- ═════════════════════════════════════════════════════════════════════════════
-- 205_acct_audit_log.sql   STAGE 1: CAPTURE
-- Append-only audit history for the accounting module. Finding 12.
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
```

### 6. VERIFY — run after, all four must hold

**All four passed 2026-08-03.** 6a, the decisive one: `authenticated -> SELECT` and nothing
else; `anon` absent entirely; `postgres` (owner) and `service_role` retain full access as
intended. `creating_role` resolved to `postgres`, so the narrower `pg_default_acl` entry
applied — the explicit revokes in step 3 made that irrelevant either way, which was the point.

```sql
-- 6a. GRANTS via aclexplode. EXPECT authenticated -> SELECT and nothing else;
--     anon absent entirely. If UPDATE or DELETE appears for authenticated, STOP.
select pg_get_userbyid(a.grantee) as grantee, a.privilege_type
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
cross join lateral aclexplode(c.relacl) a
where c.relname = 'acct_audit_log'
order by 1, 2;

-- 6b. RLS on, exactly one policy, SELECT only.
select c.relrowsecurity as rls_enabled, p.policyname, p.cmd, p.roles::text,
       p.qual::text as using_expr
from pg_class c
join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
left join pg_policies p on p.schemaname='public' and p.tablename=c.relname
where c.relname='acct_audit_log';

-- 6c. Three triggers, all AFTER UPDATE OR DELETE.
select c.relname as table_name, t.tgname, pg_get_triggerdef(t.oid) as def
from pg_trigger t
join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
where not t.tgisinternal and t.tgname like 'trg_acct_%_audit'
order by c.relname;

-- 6d. The function is SECURITY DEFINER with a pinned search_path.
select proname, prosecdef as security_definer, proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
where proname='fn_acct_audit';
-- EXPECT: security_definer = true, proconfig = {search_path=public\, pg_temp}
```

### 7. TEST — a safe round trip

**Read this first: running the test in the SQL Editor will show `actor_id` NULL and
`actor_role` NULL.** That is correct and expected — the SQL Editor has no user JWT, per
(b). It is not a failure of actor capture. **Actor capture must be confirmed through the
app**, which is the last step below.

**Steps i–iv were run 2026-08-03 and passed.** The connector showed `actor_*` NULL exactly
as predicted. Step iv correctly produced a *second* audit row rather than erasing the first:

```
audit_1  N/C Trade                ->  N/C Trade [audit test]   UPDATE  22:42:40.871758+00
audit_2  N/C Trade [audit test]   ->  N/C Trade                UPDATE  22:43:07.653439+00
live_row N/C Trade
```

**Step vi is CONFIRMED — see the production evidence in (b) above.** Actor capture is no
longer an open question.

```sql
-- i. Pick a service and note its current notes value.
select id, org_id, notes from public.acct_services order by created_at limit 1;

-- ii. Make a change (substitute the id from step i).
update public.acct_services
   set notes = coalesce(notes,'') || ' [audit test]'
 where id = '<PASTE_ID>';

-- iii. The audit row should exist. EXPECT action='UPDATE', old_notes without the
--      marker, new_notes with it, actor_* NULL (SQL Editor — see note above).
select table_name, record_id, action, changed_at,
       actor_id, actor_email, actor_role,
       old_data->>'notes' as old_notes,
       new_data->>'notes' as new_notes
from public.acct_audit_log
order by changed_at desc limit 1;

-- iv. Revert. This correctly produces a SECOND audit row — the revert is itself a
--     change, and an append-only log records it rather than erasing step ii.
update public.acct_services set notes = '<ORIGINAL_NOTES_FROM_STEP_i>'
 where id = '<PASTE_ID>';

-- v. Prove append-only. BOTH of these must FAIL.
delete from public.acct_audit_log;                        -- expect: permission denied
update public.acct_audit_log set actor_email = 'x';       -- expect: permission denied
-- As postgres in the SQL Editor these may SUCCEED, because postgres owns the table.
-- That is expected: the protection is against anon/authenticated via PostgREST, not
-- against the database owner. To test it properly, call the REST endpoint with the
-- anon key and a user JWT:
--   DELETE {SUPABASE_URL}/rest/v1/acct_audit_log?id=eq.<id>   -> expect 401/403
--   PATCH  {SUPABASE_URL}/rest/v1/acct_audit_log?id=eq.<id>   -> expect 401/403

-- vi. CONFIRM ACTOR CAPTURE THROUGH THE APP. In the Accounting screen, edit any
--     service's notes, then re-run the query in step iii. actor_id, actor_email and
--     actor_role='authenticated' must all be populated. THIS is the real test of (b).
--     >>> DONE 2026-08-03. CONFIRMED on a real DELETE from the Accounting screen:
--     >>> record_id beb4f1c7-07a0-4495-abf6-278b22573c73, actor_role 'authenticated',
--     >>> actor_email cameron@neuroprogeny.com. See (b). <<<
```

---

## Stage 2 — not started

**Both preconditions are now met** — the SQL is applied and step 6 verified — so Stage 2 is
unblocked, but deliberately not begun. Planned shape:
read-only, org-scoped, filterable by table and date, showing what changed, on which
record, prior values, actor and timestamp. **No write path of any kind.**
