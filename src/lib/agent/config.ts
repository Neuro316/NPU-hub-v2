// src/lib/agent/config.ts
// Settings for the Campaign Builder (builder mode) and the Hub Guide (guide mode). Model ids
// come from the environment, never from logic (rulings 11, 21). Caps and who may use the
// Guide come from org_settings key hub_agent_policy (AG8, AG22); a missing or unreadable
// row means the defaults below, all of which are the conservative choice.
import type { SupabaseClient } from '@supabase/supabase-js'

export type AgentMode = 'builder' | 'guide'

export const DEFAULT_AGENT_MODEL = 'claude-sonnet-5-5'
export const DEFAULT_HELP_MODEL = 'claude-haiku-4-5-20251001'

export function modelFor(mode: AgentMode): string {
  const raw = mode === 'builder' ? process.env.AGENT_MODEL : process.env.AGENT_HELP_MODEL
  return (raw || '').trim() || (mode === 'builder' ? DEFAULT_AGENT_MODEL : DEFAULT_HELP_MODEL)
}

/** Output tokens per model call. Guide answers are short by ruling 21. */
export const MAX_OUTPUT_TOKENS: Record<AgentMode, number> = { builder: 8000, guide: 600 }
/** Seconds before a model call is abandoned; the run then ends with nothing built (ruling 11). */
export const MODEL_TIMEOUT_MS = 60_000
/** Per user, per mode: at most this many runs in the window (AG9). */
export const RATE_LIMIT = { runs: 10, minutes: 10 }
/** The longest prompt or pasted text accepted, in characters. */
export const MAX_PROMPT_CHARS = 4000
export const MAX_PASTED_CHARS = 6000

export const POLICY_KEY = 'hub_agent_policy'
export const HELP_ROLE_CHOICES = ['superadmin', 'admin', 'team_member'] as const
export type HelpRole = (typeof HELP_ROLE_CHOICES)[number]

export interface AgentPolicy {
  monthly_cap_usd: number
  help_monthly_cap_usd: number
  session_messages: number
  run_tool_calls: number
  help_roles: HelpRole[]
}

export const DEFAULT_POLICY: AgentPolicy = {
  monthly_cap_usd: 25, help_monthly_cap_usd: 10, session_messages: 40, run_tool_calls: 12, help_roles: ['superadmin'],
}

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt
}

/** Pure: interpret the stored setting. Anything out of range falls back to the default. */
export function parsePolicy(raw: unknown): AgentPolicy {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const roles = Array.isArray(r.help_roles) ? (r.help_roles.filter((x) => (HELP_ROLE_CHOICES as readonly string[]).includes(String(x))) as HelpRole[]) : []
  return {
    monthly_cap_usd: num(r.monthly_cap_usd, 0, 1000, DEFAULT_POLICY.monthly_cap_usd),
    help_monthly_cap_usd: num(r.help_monthly_cap_usd, 0, 1000, DEFAULT_POLICY.help_monthly_cap_usd),
    session_messages: Math.round(num(r.session_messages, 1, 200, DEFAULT_POLICY.session_messages)),
    run_tool_calls: Math.round(num(r.run_tool_calls, 1, 30, DEFAULT_POLICY.run_tool_calls)),
    help_roles: roles.length ? roles : DEFAULT_POLICY.help_roles,
  }
}

export async function getPolicy(db: SupabaseClient, org: string): Promise<AgentPolicy> {
  const { data, error } = await db.from('org_settings').select('setting_value').eq('org_id', org).eq('setting_key', POLICY_KEY).maybeSingle()
  if (error) {
    console.error(`[agent/config] policy read failed for org=${org}: ${error.code ?? 'unknown'}; using defaults`)
    return { ...DEFAULT_POLICY }
  }
  return parsePolicy((data as any)?.setting_value)
}

/** Which Hub role a staff member has, for the Guide's role setting. */
export function helpRoleOf(isSuperadmin: boolean, teamRole: string | undefined): HelpRole | null {
  if (isSuperadmin) return 'superadmin'
  if (teamRole === 'admin' || teamRole === 'super_admin') return 'admin'
  if (teamRole === 'team_member') return 'team_member'
  return null
}

/** Pure: may this person use the Guide? A superadmin always may; otherwise the setting decides. */
export function mayUseGuide(policy: AgentPolicy, role: HelpRole | null): boolean {
  if (role === 'superadmin') return true
  return !!role && policy.help_roles.includes(role)
}
