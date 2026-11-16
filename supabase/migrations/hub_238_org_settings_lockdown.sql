-- hub_238_org_settings_lockdown.sql
--
-- STATUS: PROPOSED 2026-11-09 (as part of hub_232), split 2026-11-16 (Hub chat review). NOT APPLIED. Needs a go.
--
-- APPLY ONLY AFTER EVERY BROWSER org_settings WRITE IS GONE: the PR #44 release (all saves through /api/settings,
-- /api/settings/team and the other server routes) must be live in production, and scripts/settings/browser-writes-tamper.cjs
-- must pass on the deployed SHA. Then nonprod (cpasntagxhxitavivwlb) first, then production (htfrfaxlcuyawtlztxxm),
-- applied by the Hub chat, each followed by NOTIFY pgrst, 'reload schema' and the read-back below.
-- REQUIRES hub_232_team_profiles_lockdown (public.hub_team_admin_strict).
--
-- CONTEXT (Hub chat, 16 Nov): pf_304 already revoked INSERT, UPDATE and DELETE on org_settings from authenticated
-- (production, 2026-11-10), which is why browser saves failed silently. This file replaces the two open policies so
-- that what remains (SELECT, and any write a later grant re-opens) is limited to strict org admins and can never
-- carry a credential field.
--
-- AFTER
--   org_settings select / insert / update / delete   strict org admin only (and service_role), and a write may
--   never carry a credential field. Hub staff and facilitators read through /api/settings/read and save everyday
--   keys through /api/settings/team (service role, their own checks).
--   anon: nothing.
--
-- hub_org_settings_carries_credential mirrors credentialFields() in src/lib/org-vault-fields.ts (Vault fields plus
-- slack_config.webhook_url); keep the two in step (scripts/org-settings/credentials-tamper.cjs checks it).
--
-- ROLLBACK (re-opens org_settings; only with the Hub release reverted too):
--   drop policy if exists org_settings_admin_select on public.org_settings;
--   drop policy if exists org_settings_admin_insert on public.org_settings;
--   drop policy if exists org_settings_admin_update on public.org_settings;
--   drop policy if exists org_settings_admin_delete on public.org_settings;
--   create policy "Users access own org settings" on public.org_settings for all to authenticated
--     using (org_id in (select user_org_ids())) with check (org_id in (select user_org_ids()));
--   create policy "org_access" on public.org_settings for all to public
--     using (org_id in (select org_members.organization_id from org_members where org_members.user_id = auth.uid()));
--   drop function if exists public.hub_org_settings_is_admin(uuid);
--   drop function if exists public.hub_org_settings_carries_credential(text, jsonb);
--   notify pgrst, 'reload schema';

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

revoke all on function public.hub_org_settings_is_admin(uuid) from public, anon;
revoke all on function public.hub_org_settings_carries_credential(text, jsonb) from public, anon;
grant execute on function public.hub_org_settings_is_admin(uuid) to authenticated, service_role;
grant execute on function public.hub_org_settings_carries_credential(text, jsonb) to authenticated, service_role;

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

-- READ-BACK:
--   select policyname, cmd from pg_policies where tablename = 'org_settings' order by 1;
--     -- exactly org_settings_admin_delete, org_settings_admin_insert, org_settings_admin_select, org_settings_admin_update
--   select proname from pg_proc where proname in ('hub_org_settings_is_admin', 'hub_org_settings_carries_credential');
