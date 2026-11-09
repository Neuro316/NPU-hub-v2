-- hub_232_org_settings_lockdown.sql
--
-- STATUS: PROPOSED 2026-11-09 (revised). NOT APPLIED. Needs a go. Production (htfrfaxlcuyawtlztxxm) only.
-- Apply after the Hub release that (a) stops writing team_profiles from the browser and (b) saves everyday settings
-- through /api/settings/team is live. hub_233 and the Vault copy and blank are already done (2026-11-09).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- org_settings: two policies let ANY org member read and write every row, including credentials.
-- team_profiles: three policies let any signed-in user write it:
--   "Users can insert their own team profile"   INSERT, public, check user_id = auth.uid()   (any org, any role)
--   "org_access"                                ALL, public, any org member, no WITH CHECK
--   "Users access own org team profiles"        ALL, authenticated, org_id in user_org_ids() (University 087)
-- So any participant could insert or update a row making themselves an active super_admin of an org. team_profiles
-- is what the Hub's access checks trust (withStaff, requireOrgMember, /api/settings, accounting-auth) and what the
-- University's is_org_team_member() (184/185: acct_clients, clinic fence) trusts.
--
-- ── AFTER ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- An org admin is decided WITHOUT team_profiles (hub_team_admin_strict): org_members.role owner or admin, or
-- profiles.role admin or superadmin together with an org_members row in that org.
--
-- team_profiles
--   select   your own row, or org staff (an ACTIVE team_profiles row as super_admin, admin, team_member or
--            facilitator in that org; safe to trust once nobody can write their own), or a strict org admin
--   insert / update / delete   strict org admin only (and service_role). The Hub writes through /api/team/members.
-- org_settings
--   select / insert / update / delete   strict org admin only (and service_role), and a write may never carry a
--            credential field. Hub staff and facilitators read through /api/settings/read and save everyday keys
--            through /api/settings/team (service role, their own checks).
-- anon: nothing on either table.
--
-- ── UNIVERSITY (npu-platform-v2, read 2026-11-09) ──────────────────────────────────────────────────────────────
-- No LIVE path writes team_profiles or reads org_settings as the signed-in user. Its user-client writers of
-- team_profiles (lib/workspace-context.tsx:79 insert, lib/hooks/use-team-data.ts:72/81/89 insert, update, delete)
-- and org_settings readers (lib/slack-notifications.ts, lib/hooks/use-team-data.ts) are not mounted anywhere.
-- Its live org_settings reads are service-role (api/support slack_config.webhook_url, progress-ai,
-- onboarding-pipeline, stripe/checkout-money-path) and are unaffected. is_org_team_member() keeps working; it now
-- trusts rows nobody can write for themselves.
--
-- hub_org_settings_carries_credential mirrors credentialFields() in src/lib/org-vault-fields.ts (Vault fields plus
-- slack_config.webhook_url); keep the two in step (scripts/org-settings/credentials-tamper.cjs checks it).
--
-- ── ROLLBACK (re-opens both tables; only with the Hub release reverted too) ─────────────────────────────────────
--   drop policy if exists org_settings_admin_select on public.org_settings;
--   drop policy if exists org_settings_admin_insert on public.org_settings;
--   drop policy if exists org_settings_admin_update on public.org_settings;
--   drop policy if exists org_settings_admin_delete on public.org_settings;
--   create policy "Users access own org settings" on public.org_settings for all to authenticated
--     using (org_id in (select user_org_ids())) with check (org_id in (select user_org_ids()));
--   create policy "org_access" on public.org_settings for all to public
--     using (org_id in (select org_members.organization_id from org_members where org_members.user_id = auth.uid()));
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
--   drop function if exists public.hub_org_settings_is_admin(uuid);
--   drop function if exists public.hub_org_settings_carries_credential(text, jsonb);
--   drop function if exists public.hub_team_is_staff(uuid);
--   drop function if exists public.hub_team_admin_strict(uuid);

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

-- ─── org_settings: the admin test is the strict one ──────────────────────────────────────────────────────────────
create function public.hub_org_settings_is_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select public.hub_team_admin_strict(p_org)
$function$;

create function public.hub_org_settings_carries_credential(p_key text, p_value jsonb)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select jsonb_typeof(p_value) = 'object' and exists (
    select 1
      from (values
        ('crm_twilio', 'auth_token'), ('crm_twilio', 'api_key'), ('crm_twilio', 'api_secret'),
        ('crm_ai', 'anthropic_key'), ('crm_ai', 'openai_key'), ('crm_ai', 'gemini_key'), ('crm_ai', 'api_key'),
        ('slack_config', 'bot_token'), ('slack_config', 'webhook_url'),
        ('slack_crm_due_dates', 'webhook_url'),
        ('google_drive', 'refresh_token'),
        ('neuroreport_api_key', 'key'), ('neuroreport_api_key', 'api_key'),
        ('stage_email_script', 'secret'), ('stage_email_script', 'url'),
        ('apps_script', 'url'),
        ('gmail', 'apps_script_url')
      ) as f(k, field)
     where f.k = p_key and coalesce(btrim(p_value ->> f.field), '') <> ''
  )
$function$;

revoke all on function public.hub_team_admin_strict(uuid) from public, anon;
revoke all on function public.hub_team_is_staff(uuid) from public, anon;
revoke all on function public.hub_org_settings_is_admin(uuid) from public, anon;
revoke all on function public.hub_org_settings_carries_credential(text, jsonb) from public, anon;
grant execute on function public.hub_team_admin_strict(uuid) to authenticated, service_role;
grant execute on function public.hub_team_is_staff(uuid) to authenticated, service_role;
grant execute on function public.hub_org_settings_is_admin(uuid) to authenticated, service_role;
grant execute on function public.hub_org_settings_carries_credential(text, jsonb) to authenticated, service_role;

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

-- ─── org_settings ────────────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists "Users access own org settings" on public.org_settings;
drop policy if exists "org_access" on public.org_settings;

revoke all on public.org_settings from anon;

create policy org_settings_admin_select on public.org_settings
  for select to authenticated
  using (public.hub_org_settings_is_admin(org_id));

create policy org_settings_admin_insert on public.org_settings
  for insert to authenticated
  with check (public.hub_org_settings_is_admin(org_id)
              and not public.hub_org_settings_carries_credential(setting_key, setting_value));

create policy org_settings_admin_update on public.org_settings
  for update to authenticated
  using (public.hub_org_settings_is_admin(org_id))
  with check (public.hub_org_settings_is_admin(org_id)
              and not public.hub_org_settings_carries_credential(setting_key, setting_value));

create policy org_settings_admin_delete on public.org_settings
  for delete to authenticated
  using (public.hub_org_settings_is_admin(org_id));
