// src/lib/org-vault.ts
// Server only: org credentials from Supabase Vault (hub_233), read and written with the service role.
//
// Vault is reached through hub_org_vault_get / hub_org_vault_put (SECURITY INVOKER, executable by service_role
// only, the hub_216 pattern). A Vault entry is named org_cred:<org id>:<key>.<field>.
//
// readOrgSetting overlays the Vault fields on the org_settings row. Until hub_233 is applied, or for a field not yet
// copied to Vault, the org_settings value is used as it is, so deploying this before the copy and the blanking breaks
// nothing; once a field is blanked, Vault is its only source. Never log a value: ids and codes only.
// Import only from server code (API routes, cron, server libs). It needs the service-role client.
import type { SupabaseClient } from '@supabase/supabase-js'
import { KEPT_FIELDS, VAULT_FIELDS, isVaultField } from './org-vault-fields'

const MISSING_FN = new Set(['PGRST202', '42883'])
let vaultMissingLogged = false

/** The Vault fields stored for one org and key: { field: value }. Empty when none, or before hub_233. */
export async function vaultFields(db: SupabaseClient, orgId: string, key: string): Promise<Record<string, string>> {
  if (!VAULT_FIELDS[key]) return {}
  const { data, error } = await db.rpc('hub_org_vault_get', { p_org: orgId, p_key: key })
  if (error) {
    if (MISSING_FN.has(String(error.code))) {
      if (!vaultMissingLogged) { vaultMissingLogged = true; console.warn('[org-vault] hub_org_vault_get missing; using org_settings') }
      return {}
    }
    console.error(`[org-vault] read org=${orgId} key=${key} failed: ${error.code ?? 'unknown'}`)
    return {}
  }
  const out: Record<string, string> = {}
  if (data && typeof data === 'object') {
    for (const [f, v] of Object.entries(data as Record<string, unknown>)) {
      if (isVaultField(key, f) && typeof v === 'string' && v !== '') out[f] = v
    }
  }
  return out
}

/** One setting with its Vault credentials in place. null when the org has no such row and nothing in Vault. */
export async function readOrgSetting<T = any>(db: SupabaseClient, orgId: string, key: string): Promise<T | null> {
  const [{ data, error }, creds] = await Promise.all([
    db.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', key).maybeSingle(),
    vaultFields(db, orgId, key),
  ])
  if (error) throw new Error(`org setting ${key}: ${error.code ?? 'unknown'}`)
  const base = (data as any)?.setting_value
  if (base == null && !Object.keys(creds).length) return null
  const value: Record<string, unknown> = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {}
  for (const [f, v] of Object.entries(creds)) value[f] = v
  return value as T
}

/** Overlays Vault credentials on rows already read (for readers that scan several orgs). */
export async function withVault<T extends { org_id: string; setting_value: any }>(db: SupabaseClient, key: string, rows: T[]): Promise<T[]> {
  return Promise.all(rows.map(async (r) => {
    const creds = await vaultFields(db, r.org_id, key)
    if (!Object.keys(creds).length) return r
    return { ...r, setting_value: { ...(r.setting_value ?? {}), ...creds } }
  }))
}

/**
 * Writes one credential field. A Vault field goes to Vault and is blanked in org_settings; a kept field
 * (slack_config.webhook_url) is written in org_settings with the service role. An empty value clears it.
 */
export async function writeOrgCredential(db: SupabaseClient, orgId: string, key: string, field: string, value: string): Promise<void> {
  const v = value.trim()
  if (isVaultField(key, field)) {
    const { error } = await db.rpc('hub_org_vault_put', { p_org: orgId, p_key: key, p_field: field, p_value: v || null })
    if (error) throw new Error(`vault write ${key}.${field}: ${error.code ?? 'unknown'}`)
    await patchSetting(db, orgId, key, { [field]: '' })
    return
  }
  if ((KEPT_FIELDS[key] ?? []).includes(field)) {
    await patchSetting(db, orgId, key, { [field]: v })
    return
  }
  throw new Error(`not a credential field: ${key}.${field}`)
}

/** Merges fields into an org_settings row (creating it), keeping the rest of the value. */
export async function patchSetting(db: SupabaseClient, orgId: string, key: string, patch: Record<string, unknown>) {
  const { data, error } = await db.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', key).maybeSingle()
  if (error) throw new Error(`org setting ${key}: ${error.code ?? 'unknown'}`)
  const cur = (data as any)?.setting_value
  const value = { ...(cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {}), ...patch }
  const { error: wErr } = await db.from('org_settings').upsert(
    { org_id: orgId, setting_key: key, setting_value: value, updated_at: new Date().toISOString() }, { onConflict: 'org_id,setting_key' })
  if (wErr) throw new Error(`org setting write ${key}: ${wErr.code ?? 'unknown'}`)
}
