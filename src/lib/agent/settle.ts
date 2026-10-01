// src/lib/agent/settle.ts
// Settling a reservation after a model call (rulings 8 and 21). A failed settle leaves the
// worst-case reservation counted against the monthly limit, which fails closed (the limit is
// reached early, never overspent), so it is logged rather than retried or thrown.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface SettleArgs { p_org: string; p_month: string; p_mode: 'builder' | 'guide'; p_reserved: number; p_actual: number }

export async function settle(db: SupabaseClient, args: SettleArgs): Promise<void> {
  const { error } = await db.rpc('agent_settle', args)
  if (error) console.error(`[agent] settle failed org=${args.p_org} mode=${args.p_mode} month=${args.p_month}: ${error.code ?? 'unknown'}; the reservation stays counted`)
}
