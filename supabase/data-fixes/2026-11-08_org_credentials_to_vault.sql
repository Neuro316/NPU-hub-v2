-- 2026-11-08_org_credentials_to_vault.sql
--
-- STATUS: PART 1 APPLIED 2026-11-09 (production): read-back 14 rows, all match = true.
-- PART 2 APPLIED 2026-11-09 after the release (3570c06) was live and its readers passed (lead-alert test, one SMS,
-- Slack bot test; hub_org_vault_get called through the API): read-back 0 rows. The same three tests passed again
-- with Vault as the only source.
-- Two parts, each its own go. Production (htfrfaxlcuyawtlztxxm) only.
-- Values are moved inside the database; no statement here returns or logs a credential (read-backs return counts
-- and booleans only). No rotation (ruled 2026-11-08): the current values move as they are.
--
-- ORDER
--   1. hub_233_org_vault applied (the Vault functions)
--   2. PART 1 below: copy every credential into Vault           (safe any time: org_settings is not changed)
--   3. the Hub release reading credentials through Vault is live (PR fix/org-settings-secrets)
--   4. PART 2 below: blank each copied field in org_settings     (aborts unless Vault holds the identical value)
--   5. hub_232_org_settings_lockdown applied
-- slack_config.webhook_url is NOT moved or blanked: the University's support route reads it there (ruling 1).
--
-- ROLLBACK of PART 2 (puts the values back from Vault):
--   update public.org_settings s set setting_value = s.setting_value || jsonb_build_object(f.field, v.decrypted_secret)
--     from (select name, decrypted_secret from vault.decrypted_secrets where name like 'org_cred:%') v,
--          lateral (select split_part(v.name, ':', 2)::uuid as org_id,
--                          split_part(split_part(v.name, ':', 3), '.', 1) as key,
--                          split_part(split_part(v.name, ':', 3), '.', 2) as field) f
--    where s.org_id = f.org_id and s.setting_key = f.key;

-- ═══ PART 1: copy into Vault ═══════════════════════════════════════════════════════════════════════════════════
begin;
do $$
declare r record; n int := 0;
begin
  for r in
    select s.org_id, s.setting_key, f.field, s.setting_value ->> f.field as v
      from public.org_settings s
      join (values
        ('crm_twilio', 'auth_token'), ('crm_twilio', 'api_key'), ('crm_twilio', 'api_secret'),
        ('crm_ai', 'anthropic_key'), ('crm_ai', 'openai_key'), ('crm_ai', 'gemini_key'), ('crm_ai', 'api_key'),
        ('slack_config', 'bot_token'),
        ('slack_crm_due_dates', 'webhook_url'),
        ('google_drive', 'refresh_token'),
        ('neuroreport_api_key', 'key'), ('neuroreport_api_key', 'api_key'),
        ('stage_email_script', 'secret'), ('stage_email_script', 'url'),
        ('apps_script', 'url'),
        ('gmail', 'apps_script_url')
      ) as f(k, field) on f.k = s.setting_key
     where jsonb_typeof(s.setting_value) = 'object' and coalesce(btrim(s.setting_value ->> f.field), '') <> ''
  loop
    perform public.hub_org_vault_put(r.org_id, r.setting_key, r.field, r.v);
    n := n + 1;
  end loop;
  raise notice 'copied % credential fields to Vault', n;
end $$;
commit;

-- read-back: every non-blank field has an identical Vault copy (expect 14 rows on 2026-11-08, all match = true)
select s.org_id, s.setting_key, f.field, (v.decrypted_secret = s.setting_value ->> f.field) as match
  from public.org_settings s
  join (values
    ('crm_twilio', 'auth_token'), ('crm_twilio', 'api_key'), ('crm_twilio', 'api_secret'),
    ('crm_ai', 'anthropic_key'), ('crm_ai', 'openai_key'), ('crm_ai', 'gemini_key'), ('crm_ai', 'api_key'),
    ('slack_config', 'bot_token'), ('slack_crm_due_dates', 'webhook_url'), ('google_drive', 'refresh_token'),
    ('neuroreport_api_key', 'key'), ('neuroreport_api_key', 'api_key'),
    ('stage_email_script', 'secret'), ('stage_email_script', 'url'), ('apps_script', 'url'), ('gmail', 'apps_script_url')
  ) as f(k, field) on f.k = s.setting_key
  left join vault.decrypted_secrets v on v.name = 'org_cred:' || s.org_id || ':' || s.setting_key || '.' || f.field
 where jsonb_typeof(s.setting_value) = 'object' and coalesce(btrim(s.setting_value ->> f.field), '') <> ''
 order by 2, 1, 3;

-- ═══ PART 2: blank in org_settings (only after the release is live and Part 1 read back all true) ═══════════════
begin;
do $$
declare r record; n int := 0;
begin
  for r in
    select s.org_id, s.setting_key, f.field, s.setting_value ->> f.field as v, d.decrypted_secret as vault_v
      from public.org_settings s
      join (values
        ('crm_twilio', 'auth_token'), ('crm_twilio', 'api_key'), ('crm_twilio', 'api_secret'),
        ('crm_ai', 'anthropic_key'), ('crm_ai', 'openai_key'), ('crm_ai', 'gemini_key'), ('crm_ai', 'api_key'),
        ('slack_config', 'bot_token'), ('slack_crm_due_dates', 'webhook_url'), ('google_drive', 'refresh_token'),
        ('neuroreport_api_key', 'key'), ('neuroreport_api_key', 'api_key'),
        ('stage_email_script', 'secret'), ('stage_email_script', 'url'), ('apps_script', 'url'), ('gmail', 'apps_script_url')
      ) as f(k, field) on f.k = s.setting_key
      left join vault.decrypted_secrets d on d.name = 'org_cred:' || s.org_id || ':' || s.setting_key || '.' || f.field
     where jsonb_typeof(s.setting_value) = 'object' and coalesce(btrim(s.setting_value ->> f.field), '') <> ''
     for update of s
  loop
    if r.vault_v is distinct from r.v then
      raise exception 'vault copy missing or different for org % %.%: run PART 1 again', r.org_id, r.setting_key, r.field;
    end if;
    update public.org_settings set setting_value = setting_value || jsonb_build_object(r.field, ''), updated_at = now()
     where org_id = r.org_id and setting_key = r.setting_key;
    n := n + 1;
  end loop;
  raise notice 'blanked % credential fields', n;
end $$;
commit;

-- read-back: no credential left in org_settings except slack_config.webhook_url (expect 0 rows)
select s.org_id, s.setting_key
  from public.org_settings s
 where exists (
   select 1 from (values
     ('crm_twilio', 'auth_token'), ('crm_twilio', 'api_key'), ('crm_twilio', 'api_secret'),
     ('crm_ai', 'anthropic_key'), ('crm_ai', 'openai_key'), ('crm_ai', 'gemini_key'), ('crm_ai', 'api_key'),
     ('slack_config', 'bot_token'), ('slack_crm_due_dates', 'webhook_url'), ('google_drive', 'refresh_token'),
     ('neuroreport_api_key', 'key'), ('neuroreport_api_key', 'api_key'),
     ('stage_email_script', 'secret'), ('stage_email_script', 'url'), ('apps_script', 'url'), ('gmail', 'apps_script_url')
   ) as f(k, field)
   where f.k = s.setting_key and coalesce(btrim(s.setting_value ->> f.field), '') <> '');
