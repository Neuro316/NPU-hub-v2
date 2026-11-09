// src/lib/org-settings-client.ts
// Browser: read org_settings through GET /api/settings/read (ruled 2026-11-08). The browser never selects the table
// itself, because only org admins may (hub_232) and credential fields are never sent to it. Values come back with
// every credential field blank; `credentialsSet` says which are set ("set / not set").

export interface OrgSettingsRead {
  settings: Record<string, any>
  credentialsSet: Record<string, Record<string, boolean>>
}

export async function readOrgSettings(orgId: string, keys: string[]): Promise<OrgSettingsRead> {
  const empty: OrgSettingsRead = { settings: {}, credentialsSet: {} }
  if (!orgId || !keys.length) return empty
  try {
    const qs = new URLSearchParams({ org_id: orgId, keys: keys.join(',') })
    const r = await fetch(`/api/settings/read?${qs}`, { cache: 'no-store' })
    if (!r.ok) return empty
    const j = await r.json()
    const settings: Record<string, any> = {}
    for (const [k, v] of Object.entries(j.settings ?? {})) if (v != null) settings[k] = v
    return { settings, credentialsSet: j.credentials_set ?? {} }
  } catch {
    return empty
  }
}

/** One value, or null. */
export async function readOrgSettingValue<T = any>(orgId: string, key: string): Promise<T | null> {
  const { settings } = await readOrgSettings(orgId, [key])
  return (settings[key] ?? null) as T | null
}

/** Saves one credential field (write-only). Org admins only; returns false when refused or failed. */
export async function saveOrgCredential(orgId: string, key: string, field: string, value: string): Promise<boolean> {
  try {
    const r = await fetch('/api/settings/credential', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: orgId, setting_key: key, field, value }),
    })
    return r.ok
  } catch {
    return false
  }
}

/**
 * Saves an everyday, non-credential setting (pipelines board, column chooser, avatar colours, company overview,
 * meeting settings, enrollment config, cross-org sharing) through PUT /api/settings/team, which any active Hub user
 * of the org may call. Throws on failure so callers keep their existing error handling.
 */
export async function saveTeamSetting(orgId: string, key: string, value: unknown): Promise<void> {
  const r = await fetch('/api/settings/team', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ org_id: orgId, setting_key: key, setting_value: value }),
  })
  if (!r.ok) throw new Error(`setting ${key} not saved (${r.status})`)
}
