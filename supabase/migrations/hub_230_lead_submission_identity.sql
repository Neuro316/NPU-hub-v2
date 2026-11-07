-- hub_230_lead_submission_identity.sql
-- PROPOSED, NOT APPLIED. Production only (htfrfaxlcuyawtlztxxm), never npu-platform-nonprod. Touches no University table.
--
-- A lead device submission keeps the details the person typed: first name, last name, email and phone. Before this
-- they lived only on the contact, so a submission whose contact step failed (status contact_failed) lost them and
-- could not be retried, and a test submission could not show what was entered.
--
-- ACCESS: lead_device_submissions already has RLS on, no policies, and no privileges for anon or authenticated
-- (hub_228), so the new columns are service role only. The Hub reads them through a staff route; nothing logs them.
--
-- RETENTION: hub_purge_test_submission_identity() blanks the four fields on TEST submissions 30 days after they were
-- submitted and stamps identity_purged_at. A Hub cron runs it daily (/api/cron/lead-identity-purge). Real
-- submissions keep their details, like the contact they created.
--
-- WHAT IT DOES NOT DO: backfill. The one submission so far (a test) has no details to recover.
--
-- ROLLBACK:
--   begin;
--   drop function public.hub_purge_test_submission_identity(integer);
--   alter table public.lead_device_submissions drop column identity_purged_at, drop column phone, drop column email,
--     drop column last_name, drop column first_name;
--   delete from supabase_migrations.schema_migrations where name = 'hub_230_lead_submission_identity';
--   commit;

begin;

alter table public.lead_device_submissions
  add column first_name text check (first_name is null or length(first_name) <= 120),
  add column last_name text check (last_name is null or length(last_name) <= 120),
  add column email text check (email is null or length(email) <= 320),
  add column phone text check (phone is null or length(phone) <= 32),
  add column identity_purged_at timestamptz;

create function public.hub_purge_test_submission_identity(p_days integer default 30)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare n int;
begin
  if p_days is null or p_days < 30 then raise exception 'hub: test identity is kept at least 30 days'; end if;
  update public.lead_device_submissions s
     set first_name = null, last_name = null, email = null, phone = null, identity_purged_at = now()
   where s.is_test and s.identity_purged_at is null
     and coalesce(s.submitted_at, s.created_at) < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.hub_purge_test_submission_identity(integer) from public, anon, authenticated;
grant execute on function public.hub_purge_test_submission_identity(integer) to service_role;

commit;
