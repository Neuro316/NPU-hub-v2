// src/lib/briefs/config.ts
// The scheduling agent's switch: org_settings 'hub_sched_agent' for the NPU org,
// value { enabled: 'on' | 'off', since: ISO, recipient_user_id }. It gates the morning brief.
// Missing, unreadable or anything but exactly 'on' means off.
import type { SupabaseClient } from '@supabase/supabase-js'

export const SCHED_AGENT_ORG = '00000000-0000-0000-0000-000000000001'
export const SCHED_AGENT_KEY = 'hub_sched_agent'

export interface SchedAgentConfig { enabled: boolean; since: string | null; recipientUserId: string | null }

/** Pure: only the exact string 'on' with a recipient turns it on. */
export function parseSchedAgentConfig(raw: unknown): SchedAgentConfig {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const rid = typeof v.recipient_user_id === 'string' && /^[0-9a-f-]{36}$/i.test(v.recipient_user_id) ? v.recipient_user_id : null
  const since = typeof v.since === 'string' && !Number.isNaN(Date.parse(v.since)) ? new Date(v.since).toISOString() : null
  return { enabled: v.enabled === 'on' && !!rid, since, recipientUserId: rid }
}

export async function readSchedAgentConfig(db: SupabaseClient): Promise<SchedAgentConfig> {
  const { data, error } = await db.from('org_settings').select('setting_value')
    .eq('org_id', SCHED_AGENT_ORG).eq('setting_key', SCHED_AGENT_KEY).maybeSingle()
  if (error) {
    console.error(`[sched-agent] config read failed: ${error.code ?? 'unknown'}; treated as off`)
    return parseSchedAgentConfig(null)
  }
  return parseSchedAgentConfig((data as any)?.setting_value)
}
