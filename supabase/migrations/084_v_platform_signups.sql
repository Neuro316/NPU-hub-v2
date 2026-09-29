-- 084_v_platform_signups.sql
-- APPLIED 2026-07-24 (via apply_migration; registered in schema_migrations).
--
-- Read-only signup population view. One row per participant profile. Feeds the Hub's platform
-- signup page: who signed up, when, and whether they are paid / free / signup-only.
--
-- WHY A VIEW AND NOT A MATERIALIZED VIEW
-- The population is ~17 rows. An MV would buy nothing but staleness on a query that runs in
-- single-digit milliseconds. Revisit only if this reaches five figures; the read path will not change.
--
-- WHY security_invoker = true
-- A view defaults to running as its OWNER, which would bypass the caller's RLS on profiles,
-- payments and enrollments — turning this into a privilege backdoor for anyone granted SELECT.
-- With security_invoker the caller's own RLS still applies. service_role has rolbypassrls and so
-- reads it regardless, which is how the Hub consumes it.
--
-- GRANTS: deliberately none. New objects are born locked (migration 030), so the absence of a
-- grant IS the lock. Do NOT add `grant select ... to authenticated` without deciding what a
-- participant-role user should be able to see here — this view exposes every signup's email.

create or replace view public.v_platform_signups
with (security_invoker = true) as
select
  p.id as profile_id, p.email, p.full_name, p.phone,
  p.status as profile_status, p.created_at as signed_up_at,
  -- profiles.organization_id is NULL when a signup never completed onboarding (handle_new_user
  -- creates the row; complete-signup sets the org), so fall back through the facts that DO carry an
  -- org, most authoritative first. Note the column-name split: programs uses org_id, while
  -- payments and profiles use organization_id (13 tables are on that exception list).
  coalesce(
    p.organization_id,
    (select pr.org_id from enrollments e join programs pr on pr.id = e.program_id
      where e.user_id = p.id order by e.enrolled_at desc nulls last limit 1),
    (select pay.organization_id from payments pay
      where pay.participant_id = p.id and pay.status = 'succeeded'
      order by pay.paid_at desc nulls last limit 1),
    (select c.org_id from contacts c
      where lower(c.email) = lower(p.email) and c.merged_into_id is null limit 1)
  ) as org_id,
  (select count(*) from enrollments e where e.user_id = p.id) as enrollment_count,
  (select coalesce(sum(e.total_paid), 0) from enrollments e where e.user_id = p.id) as total_paid,
  (select count(*) from payments pay
    where pay.participant_id = p.id and pay.status = 'succeeded') as paid_txn_count,
  (select count(*) from lesson_progress lp
    where lp.user_id = p.id and lp.completed_at is not null) as lessons_completed,
  -- Paid wins over free: someone who took a free course and then bought is 'paid'.
  case
    when exists(select 1 from payments pay
                 where pay.participant_id = p.id and pay.status = 'succeeded')
      or exists(select 1 from enrollments e
                 where e.user_id = p.id and coalesce(e.total_paid, 0) > 0) then 'paid'
    when exists(select 1 from enrollments e where e.user_id = p.id) then 'free'
    else 'signup_only'
  end as segment
from profiles p
where p.role::text = 'participant';
