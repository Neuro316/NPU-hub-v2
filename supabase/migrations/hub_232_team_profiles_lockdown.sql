-- hub_232_team_profiles_lockdown.sql
--
-- STATUS: PROPOSED 2026-11-09, split 2026-11-16 (Hub chat review). NOT APPLIED. Needs a go.
-- Nonprod (cpasntagxhxitavivwlb) first, then production (htfrfaxlcuyawtlztxxm), applied by the Hub chat, each
-- followed by NOTIFY pgrst, 'reload schema' and the read-back below.
--
-- WHY NOW: team_profiles is still writable by any signed-in user. Three policies let anyone insert or update a row
-- making themselves an active super_admin of an org, and team_profiles is what the Hub's access checks
-- (withStaff, requireOrgMember, /api/settings, accounting-auth) and the University's is_org_team_member() trust.
--
-- SAFE BEFORE THE CODE CHANGES: strict org admins (org_members owner or admin, or profiles admin or superadmin with
-- an org_members row) keep write access, and every server route uses the service role. The only writers this
-- refuses are browser writes by non-admins, and the Hub no longer makes any (PR #44): team writes go through
-- /api/team/members, and the workspace auto-insert is gone.
--
-- The org_settings half of the old hub_232 is now hub_238_org_settings_lockdown.sql, applied separately and AFTER
-- this file (its admin test calls public.hub_team_admin_strict, created here).
--
-- AFTER
--   team_profiles select   your own row, or org staff (an ACTIVE row as super_admin, admin, team_member or
--                          facilitator in that org), or a strict org admin
--   team_profiles insert / update / delete   strict org admin only (and service_role)
--   anon: nothing.
--
-- ROLLBACK (re-opens team_profiles; drop hub_238 first if it is applied, since it uses hub_team_admin_strict):
--   drop policy if exists team_profiles_select on public.team_profiles;
--   drop policy if exists team_profiles_admin_insert on public.team_profiles;
--   drop policy if exists team_profiles_admin_update on public.team_profiles;
--   drop policy if exists team_profiles_admin_delete on public.team_profiles;
--   create policy "Users access own org team profiles" on public.team_profiles for all to authenticated
--     using (org_id in (select user_org_ids())) with check (org_id in (select user_org_ids()));
--   create policy "Users can insert their own team profile" on public.team_profiles for insert to public
--     with check (user_id = auth.uid());
--   create policy "org_access" on public.team_profiles for all to public
--     using (org_id in (select org_members.organization_id from org_members where org_members.user_id = auth.uid()));
--   drop function if exists public.hub_team_is_staff(uuid);
--   drop function if exists public.hub_team_admin_strict(uuid);
--   notify pgrst, 'reload schema';

-- ─── who is an org admin, decided without team_profiles ──────────────────────────────────────────────────────────
-- SECURITY DEFINER so policies can read org_members and profiles whatever their own RLS says. It reads only the
-- caller's own rows (auth.uid()) and returns a boolean.
create function public.hub_team_admin_strict(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select auth.uid() is not null and (
    exists (select 1 from public.org_members m
             where m.user_id = auth.uid() and m.organization_id = p_org and m.role in ('owner', 'admin'))
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('admin', 'superadmin'))
      and exists (select 1 from public.org_members m where m.user_id = auth.uid() and m.organization_id = p_org)
    )
  )
$function$;

-- ─── who may read the org's team list ────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER: it reads team_profiles itself, so a policy on team_profiles must not re-enter RLS.
create function public.hub_team_is_staff(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select auth.uid() is not null and (
    exists (select 1 from public.team_profiles t
             where t.user_id = auth.uid() and t.org_id = p_org and t.status = 'active'
               and t.role in ('super_admin', 'admin', 'team_member', 'facilitator'))
    or public.hub_team_admin_strict(p_org)
  )
$function$;

revoke all on function public.hub_team_admin_strict(uuid) from public, anon;
revoke all on function public.hub_team_is_staff(uuid) from public, anon;
grant execute on function public.hub_team_admin_strict(uuid) to authenticated, service_role;
grant execute on function public.hub_team_is_staff(uuid) to authenticated, service_role;

-- ─── team_profiles ───────────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists "Users can insert their own team profile" on public.team_profiles;
drop policy if exists "org_access" on public.team_profiles;
drop policy if exists "Users access own org team profiles" on public.team_profiles;

revoke all on public.team_profiles from anon;

create policy team_profiles_select on public.team_profiles
  for select to authenticated
  using (user_id = auth.uid() or public.hub_team_is_staff(org_id));

create policy team_profiles_admin_insert on public.team_profiles
  for insert to authenticated
  with check (public.hub_team_admin_strict(org_id));

create policy team_profiles_admin_update on public.team_profiles
  for update to authenticated
  using (public.hub_team_admin_strict(org_id))
  with check (public.hub_team_admin_strict(org_id));

create policy team_profiles_admin_delete on public.team_profiles
  for delete to authenticated
  using (public.hub_team_admin_strict(org_id));

-- READ-BACK:
--   select policyname, cmd from pg_policies where tablename = 'team_profiles' order by 1;
--     -- exactly team_profiles_admin_delete, team_profiles_admin_insert, team_profiles_admin_update, team_profiles_select
--   select proname from pg_proc where proname in ('hub_team_admin_strict', 'hub_team_is_staff');
