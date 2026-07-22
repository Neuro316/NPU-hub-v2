-- 074_contact_dedupe_dismissals.sql
-- "These are different people — never flag again."
--
-- Ships WITH detection, not after: without it every re-scan resurfaces the same
-- distinct-but-similar pairs (24 name-only groups / 52 contacts on NP today),
-- and the queue trains you to ignore it.
--
-- PAIR ORDERING: a dismissal is symmetric — dismissing (A,B) must also suppress
-- (B,A). Rather than store both rows or check both directions on read, the pair
-- is normalised at write time so contact_a < contact_b always, enforced by a
-- CHECK. The unique index then makes a dismissal idempotent.

create table if not exists contact_dedupe_dismissals (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  contact_a    uuid not null references contacts(id) on delete cascade,
  contact_b    uuid not null references contacts(id) on delete cascade,
  -- Which signal was dismissed ('email' | 'phone' | 'identity' | 'name'), kept
  -- for auditing why a pair was judged distinct. Dismissal suppresses the pair
  -- regardless of which signal later re-surfaces it — a human said "different
  -- people", and that verdict outranks any signal.
  signal       text,
  reason       text,
  dismissed_by uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint contact_dedupe_dismissals_ordered check (contact_a < contact_b)
);

create unique index if not exists uq_contact_dedupe_dismissals_pair
  on contact_dedupe_dismissals (org_id, contact_a, contact_b);

create index if not exists idx_contact_dedupe_dismissals_org
  on contact_dedupe_dismissals (org_id);

alter table contact_dedupe_dismissals enable row level security;

-- 067 policy shape: superadmin branch, then admin/facilitator staff gate scoped
-- to the caller's orgs, with an explicit WITH CHECK on writes.
drop policy if exists contact_dedupe_dismissals_select on contact_dedupe_dismissals;
create policy contact_dedupe_dismissals_select on contact_dedupe_dismissals
  for select to authenticated
  using (
    get_my_role() = 'superadmin'
    or (get_my_role() = any (array['admin','facilitator'])
        and org_id in (select user_org_ids()))
  );

drop policy if exists contact_dedupe_dismissals_insert on contact_dedupe_dismissals;
create policy contact_dedupe_dismissals_insert on contact_dedupe_dismissals
  for insert to authenticated
  with check (
    get_my_role() = 'superadmin'
    or (get_my_role() = any (array['admin','facilitator'])
        and org_id in (select user_org_ids()))
  );

drop policy if exists contact_dedupe_dismissals_delete on contact_dedupe_dismissals;
create policy contact_dedupe_dismissals_delete on contact_dedupe_dismissals
  for delete to authenticated
  using (
    get_my_role() = 'superadmin'
    or (get_my_role() = any (array['admin','facilitator'])
        and org_id in (select user_org_ids()))
  );

-- Verification:
--   select policyname, cmd from pg_policies where tablename='contact_dedupe_dismissals';
--   -- a dismissal must be rejected if written unordered:
--   -- insert ... (contact_a > contact_b) -> violates contact_dedupe_dismissals_ordered
