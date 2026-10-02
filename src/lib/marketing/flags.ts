// src/lib/marketing/flags.ts
// Per-org capability flags for the marketing engine, read server-side from
// org_settings key `hub_marketing_flags`. A missing row, a missing key or a read
// error all mean OFF: nothing in this module can fail open.
//
// The database functions read the same row through public.hub_flag(), so the two
// views of a flag can never disagree. This module exists for route code that has
// to decide before it reaches a database function (the intake endpoint, the
// provider, the deliver step).
import type { SupabaseClient } from '@supabase/supabase-js'

// agent_enabled, help_bot_enabled and pages: the Campaign Builder agent, the Hub Guide and
// public landing pages (docs/plans/hub-agent-build-rulings.md AG1, AG14, AG22).
export const FLAG_KEYS = ['engine', 'gate_live_sends', 'provider_email', 'provider_sms', 'intake', 'deliver_asset', 'mirror_legacy_stage',
  'agent_enabled', 'help_bot_enabled', 'pages'] as const
export type FlagKey = (typeof FLAG_KEYS)[number]
export type Flags = Record<FlagKey, boolean>

export const ALL_OFF: Flags = {
  engine: false, gate_live_sends: false, provider_email: false, provider_sms: false,
  intake: false, deliver_asset: false, mirror_legacy_stage: false,
  agent_enabled: false, help_bot_enabled: false, pages: false,
}

/** Pure: interpret a raw setting value. Only the exact string 'on' turns a flag on. */
export function parseFlags(raw: unknown): Flags {
  const out: Flags = { ...ALL_OFF }
  if (!raw || typeof raw !== 'object') return out
  for (const k of FLAG_KEYS) out[k] = (raw as Record<string, unknown>)[k] === 'on'
  return out
}

export async function getFlags(db: SupabaseClient, orgId: string): Promise<Flags> {
  const { data, error } = await db.from('org_settings').select('setting_value')
    .eq('org_id', orgId).eq('setting_key', 'hub_marketing_flags').maybeSingle()
  if (error) {
    console.error(`[marketing/flags] read failed for org=${orgId}: ${error.code ?? 'unknown'}; treating every flag as off`)
    return { ...ALL_OFF }
  }
  return parseFlags(data?.setting_value)
}
