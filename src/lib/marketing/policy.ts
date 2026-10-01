// src/lib/marketing/policy.ts
// The org's send policy: sender, quiet hours, frequency cap. Defaults live in ONE
// place, public.hub_send_policy() in the database; this module only reads it, so
// the gate and the provider can never disagree about the sender.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface SendPolicy {
  quiet_start: string
  quiet_end: string
  default_timezone: string
  cap_count: number
  cap_days: number
  from_address: string
  from_domain: string
  reply_to?: string
}

/** The value hub_211 ships with. A live send is refused while this is the domain. */
export const PLACEHOLDER_SENDER_DOMAIN = 'sender-not-set.neuroprogeny.com'

/** Pure: a sender is usable only when it is set, is not the placeholder, and matches its domain. */
export function senderProblem(p: Pick<SendPolicy, 'from_address' | 'from_domain'>): string | null {
  const domain = (p.from_domain || '').trim().toLowerCase()
  if (!domain) return 'sender_domain_missing'
  if (domain === PLACEHOLDER_SENDER_DOMAIN) return 'sender_is_placeholder'
  const m = /<([^>]+)>\s*$/.exec(p.from_address || '') ?? [null, (p.from_address || '').trim()]
  const addr = String(m[1] || '').toLowerCase()
  if (!addr.includes('@')) return 'sender_address_invalid'
  if (addr.split('@')[1] !== domain) return 'sender_address_not_on_domain'
  return null
}

export async function getSendPolicy(db: SupabaseClient, orgId: string): Promise<SendPolicy | null> {
  const { data, error } = await db.rpc('hub_send_policy', { p_org: orgId })
  if (error || !data) {
    console.error(`[marketing/policy] read failed for org=${orgId}: ${error?.code ?? 'no data'}`)
    return null
  }
  return data as SendPolicy
}
