// src/lib/org-vault-fields.ts
// Pure: which org_settings fields are credentials (ruled 2026-11-08). No I/O, safe to import in the browser.
//
//   VAULT_FIELDS   live only in Supabase Vault (hub_233), read only by service-role server code
//                  (src/lib/org-vault.ts). In org_settings they are blank.
//   KEPT_FIELDS    stay in org_settings because the University reads them there with its service role
//                  (ruling 1: slack_config.webhook_url, api/support/route.ts in npu-platform-v2). Still a credential:
//                  never returned to a browser, never written by one.
//
// Every credential field, either kind, is never sent to a browser (redactCredentials) and is written only through
// the staff-admin route PUT /api/settings/credential. hub_232's write policy refuses a browser row carrying one.

export const VAULT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  crm_twilio: ['auth_token', 'api_key', 'api_secret'],
  crm_ai: ['anthropic_key', 'openai_key', 'gemini_key', 'api_key'],
  slack_config: ['bot_token'],
  slack_crm_due_dates: ['webhook_url'],
  google_drive: ['refresh_token'],
  neuroreport_api_key: ['key', 'api_key'],
  stage_email_script: ['secret', 'url'],
  apps_script: ['url'],
  gmail: ['apps_script_url'],
}

export const KEPT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  slack_config: ['webhook_url'],
}

/** Every credential field of a key, Vault or kept. */
export function credentialFields(key: string): string[] {
  return [...(VAULT_FIELDS[key] ?? []), ...(KEPT_FIELDS[key] ?? [])]
}

export function isCredentialField(key: string, field: string): boolean {
  return credentialFields(key).includes(field)
}

export function isVaultField(key: string, field: string): boolean {
  return (VAULT_FIELDS[key] ?? []).includes(field)
}

const filled = (v: unknown) => v != null && String(v).trim() !== ''

/**
 * A setting value with every credential field blanked, plus which were set. `set` reflects the value given, so a
 * server caller passes the Vault-overlaid value (readOrgSetting) to report "set / not set" truthfully.
 */
export function redactCredentials(key: string, value: unknown): { value: unknown; set: Record<string, boolean> } {
  const fields = credentialFields(key)
  if (!fields.length || !value || typeof value !== 'object' || Array.isArray(value)) return { value, set: {} }
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  const set: Record<string, boolean> = {}
  for (const f of fields) {
    set[f] = filled(out[f])
    if (f in out) out[f] = ''
  }
  return { value: out, set }
}

/** True when a value carries a non-blank credential field (what a browser write must never do). */
export function carriesCredential(key: string, value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return credentialFields(key).some((f) => filled((value as Record<string, unknown>)[f]))
}

/** A copy of a value with its credential fields removed outright (for upserts from the settings screens). */
export function withoutCredentials<T extends Record<string, unknown>>(key: string, value: T): T {
  const out: Record<string, unknown> = { ...value }
  for (const f of credentialFields(key)) delete out[f]
  return out as T
}
