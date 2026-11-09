// src/lib/apps-script-url.ts
// Server only: the org's Google Apps Script URL. apps_script.url first, then gmail.apps_script_url, then the
// APPS_SCRIPT_URL env. Both URLs are credentials kept in Vault (src/lib/org-vault.ts), read with the service role and
// never returned to a browser.
import type { SupabaseClient } from '@supabase/supabase-js'
import { readOrgSetting } from './org-vault'

const on = (v: unknown) => v === true || v === 'true'

export async function appsScriptUrl(db: SupabaseClient, orgId: string): Promise<string | null> {
  const as = await readOrgSetting<any>(db, orgId, 'apps_script').catch(() => null)
  if (as?.url && on(as.enabled)) return String(as.url)
  const gm = await readOrgSetting<any>(db, orgId, 'gmail').catch(() => null)
  if (gm?.apps_script_url && on(gm.enabled)) return String(gm.apps_script_url)
  return process.env.APPS_SCRIPT_URL || null
}
