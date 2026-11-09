-- hub_233_org_vault.sql
--
-- STATUS: PROPOSED 2026-11-08. NOT APPLIED. Needs a go. Apply BEFORE hub_232 (the number is only a label; the
-- ledger keys on the apply timestamp). Production (htfrfaxlcuyawtlztxxm) only.
--
-- PURPOSE: org credentials in Supabase Vault, reachable only by the service role (the hub_216 pattern).
-- src/lib/org-vault.ts calls these two functions. Until this is applied the Hub reads the org_settings values as
-- they are (the functions are missing, so the helper falls back), so deploying the code first breaks nothing.
--
--   hub_org_vault_get(org, key)                returns { field: value } for that org and key
--   hub_org_vault_put(org, key, field, value)  creates, updates or (value null/empty) deletes one entry
--
-- A Vault entry is named org_cred:<org id>:<key>.<field>. Only the pairs in hub_org_vault_field_ok are accepted;
-- they mirror VAULT_FIELDS in src/lib/org-vault-fields.ts (keep the two in step). slack_config.webhook_url is NOT
-- here: it stays in org_settings for the University support route (ruling 1, 2026-11-08).
--
-- Both callable functions are SECURITY INVOKER: they work because the caller is service_role, which holds the vault
-- privileges (read 2026-11-01 for hub_216). EXECUTE is revoked from public, anon and authenticated.
--
-- ROLLBACK (deletes the Vault copies; run only after the org_settings values are restored):
--   delete from vault.secrets where name like 'org_cred:%';
--   drop function if exists public.hub_org_vault_put(uuid, text, text, text);
--   drop function if exists public.hub_org_vault_get(uuid, text);
--   drop function if exists public.hub_org_vault_field_ok(text, text);

create function public.hub_org_vault_field_ok(p_key text, p_field text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select (p_key, p_field) in (
    ('crm_twilio', 'auth_token'), ('crm_twilio', 'api_key'), ('crm_twilio', 'api_secret'),
    ('crm_ai', 'anthropic_key'), ('crm_ai', 'openai_key'), ('crm_ai', 'gemini_key'), ('crm_ai', 'api_key'),
    ('slack_config', 'bot_token'),
    ('slack_crm_due_dates', 'webhook_url'),
    ('google_drive', 'refresh_token'),
    ('neuroreport_api_key', 'key'), ('neuroreport_api_key', 'api_key'),
    ('stage_email_script', 'secret'), ('stage_email_script', 'url'),
    ('apps_script', 'url'),
    ('gmail', 'apps_script_url')
  )
$function$;

-- ─── get: every stored field for one org and key ─────────────────────────────
create function public.hub_org_vault_get(p_org uuid, p_key text)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select coalesce(jsonb_object_agg(substr(s.name, length('org_cred:' || p_org::text || ':' || p_key || '.') + 1), s.decrypted_secret), '{}'::jsonb)
    from vault.decrypted_secrets s
   where s.name like 'org_cred:' || p_org::text || ':' || replace(replace(p_key, '_', '\_'), '%', '\%') || '.%'
$function$;

-- ─── put: create, update, or delete one field ───────────────────────────────
create function public.hub_org_vault_put(p_org uuid, p_key text, p_field text, p_value text)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  v_name text := 'org_cred:' || p_org::text || ':' || p_key || '.' || p_field;
  v_id   uuid;
begin
  if not public.hub_org_vault_field_ok(p_key, p_field) then
    raise exception 'org_vault_field_not_allowed';
  end if;
  select s.id into v_id from vault.secrets s where s.name = v_name;
  if p_value is null or length(p_value) = 0 then
    if v_id is not null then delete from vault.secrets s where s.id = v_id; end if;
    return;
  end if;
  if v_id is null then
    perform vault.create_secret(p_value, v_name, 'org_settings ' || p_key || '.' || p_field || ' for org ' || p_org::text || ' (hub_233)');
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end
$function$;

revoke all on function public.hub_org_vault_field_ok(text, text) from public, anon, authenticated;
revoke all on function public.hub_org_vault_get(uuid, text) from public, anon, authenticated;
revoke all on function public.hub_org_vault_put(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.hub_org_vault_field_ok(text, text) to service_role;
grant execute on function public.hub_org_vault_get(uuid, text) to service_role;
grant execute on function public.hub_org_vault_put(uuid, text, text, text) to service_role;
