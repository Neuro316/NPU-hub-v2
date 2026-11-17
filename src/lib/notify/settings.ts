// src/lib/notify/settings.ts
// Server only. The org's notification settings (org_settings 'hub_notifications'), with defaults filled in.
// Kept apart from brief.ts so the urgent path (and the lifecycle engine that calls it) does not load the metrics code.
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseSettings, type Settings } from './rules'

export const DEFAULT_OWNER = '22456608-5f7d-495e-af02-7037fea125cc' // Cameron's Hub profile (the alerts' default recipient)
export const HUB_URL = 'https://hub.neuroprogeny.com'

export async function loadSettings(db: SupabaseClient, orgId: string): Promise<Settings> {
  const { data, error } = await db.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', 'hub_notifications').maybeSingle()
  if (error) throw new Error(`org_settings read: ${error.code ?? 'unknown'}`)
  return parseSettings((data as any)?.setting_value, DEFAULT_OWNER)
}
