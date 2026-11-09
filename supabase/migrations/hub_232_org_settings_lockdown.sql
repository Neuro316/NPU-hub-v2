-- hub_232_org_settings_lockdown.sql
--
-- STATUS: PROPOSED 2026-11-08. NOT APPLIED. Needs a go. Apply LAST: after hub_233 is applied, the credentials are
-- copied to Vault and blanked (supabase/data-fixes/2026-11-08_org_credentials_to_vault.sql), and the Hub release
-- that reads them from Vault is live. Production (htfrfaxlcuyawtlztxxm) only.
--
-- WHY: org_settings (shared with the University) had two policies letting ANY org member read and write every row:
--   "Users access own org settings"  ALL, authenticated, org_id in user_org_ids()
--   "org_access"                     ALL, public,        org_id in (org_members of auth.uid())
-- Org 0001 has 37 non-staff members (28 member, 9 participant); the rows held Slack, Twilio, AI, Google and other
-- credentials in plain text.
--
-- AFTER (ruled 2026-11-08):
--   service_role   unchanged (bypasses RLS): every Hub API route, cron, and the University's server routes
--   authenticated  only an ORG ADMIN of that org may select / insert / update / delete, and a write may never carry
--                  a credential field (credentials are written by the service role only, through Vault)
--   anon           nothing
-- Members, facilitators and participants have NO RLS access. Hub users who are not org admins read the
-- non-credential keys only through GET /api/settings/read (service role, its own Hub-access check). No member-level
-- read policy exists, because participants share the member role.
--
-- "Org admin" = signed in, and in that org one of:
--   org_members.role owner or admin
--   an ACTIVE team_profiles row with role admin or super_admin
--   profiles.role admin or superadmin AND an org_members or active team_profiles row in that org
-- (2 superadmins and 1 profile admin in org 0001 hold org_members.role 'member', so the org role alone is not enough.)
--
-- University: not changed. Its live org_settings reads are service-role (api/support slack_config.webhook_url,
-- progress-ai, onboarding-pipeline, stripe/checkout-money-path) and keep working. Its browser readers
-- (lib/slack-notifications.ts, lib/hooks/use-team-data.ts) are not mounted anywhere (read 2026-11-08).
--
-- hub_org_settings_carries_credential mirrors credentialFields() in src/lib/org-vault-fields.ts (Vault fields plus
-- slack_config.webhook_url). Keep the two in step.
--
-- ROLLBACK (restores the old, open policies; do not run unless the Hub release is reverted too):
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

-- SECURITY DEFINER so the policy can read org_members / team_profiles / profiles whatever their own RLS says.
-- It reads only the caller's own rows (auth.uid()) and returns a boolean.
create function public.hub_org_settings_is_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select auth.uid() is not null and (
    exists (select 1 from public.org_members m
             where m.user_id = auth.uid() and m.organization_id = p_org and m.role in ('owner', 'admin'))
    or exists (select 1 from public.team_profiles t
                where t.user_id = auth.uid() and t.org_id = p_org and t.status = 'active' and t.role in ('admin', 'super_admin'))
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('admin', 'superadmin'))
      and (
        exists (select 1 from public.org_members m where m.user_id = auth.uid() and m.organization_id = p_org)
        or exists (select 1 from public.team_profiles t where t.user_id = auth.uid() and t.org_id = p_org and t.status = 'active')
      )
    )
  )
$function$;

revoke all on function public.hub_org_settings_is_admin(uuid) from public, anon;
grant execute on function public.hub_org_settings_is_admin(uuid) to authenticated, service_role;
revoke all on function public.hub_org_settings_carries_credential(text, jsonb) from public, anon;
grant execute on function public.hub_org_settings_carries_credential(text, jsonb) to authenticated, service_role;

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
