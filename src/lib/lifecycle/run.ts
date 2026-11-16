// src/lib/lifecycle/run.ts
// One lifecycle run: for every org whose org_settings 'hub_lifecycle' is dry_run or live, scan for events, record
// them, and (live only) apply them. An org with no row, or mode off, is not touched.
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseConfig, parseTypeRoutes } from './rules'
import { applyPending } from './ledger'
import {
  closeTouchedTasks, scanCoachingBookings, scanDiscoveryBookings, scanEnrolled, scanFunnel, scanLeads, scanTimedFollowUps, type ScanCtx,
} from './scan'

export async function loadLifecycle(db: SupabaseClient, orgId: string) {
  const { data, error } = await db.from('org_settings').select('setting_key, setting_value').eq('org_id', orgId)
    .in('setting_key', ['hub_lifecycle', 'hub_booking_type_routes'])
  if (error) throw new Error(`lifecycle settings read: ${error.code ?? 'unknown'}`)
  const get = (k: string) => (data ?? []).find((r: any) => r.setting_key === k)?.setting_value
  return { cfg: parseConfig(orgId, get('hub_lifecycle')), routes: parseTypeRoutes(get('hub_booking_type_routes')) }
}

export async function runLifecycle(db: SupabaseClient, deadline: number): Promise<Record<string, unknown>> {
  const { data: orgs, error } = await db.from('org_settings').select('org_id').eq('setting_key', 'hub_lifecycle')
  if (error) throw new Error(`lifecycle orgs read: ${error.code ?? 'unknown'}`)
  const out: Record<string, unknown> = {}
  for (const { org_id: orgId } of (orgs ?? []) as any[]) {
    const { cfg, routes } = await loadLifecycle(db, orgId)
    if (cfg.mode === 'off') { out[orgId] = { mode: 'off' }; continue }
    const ctx: ScanCtx = { db, orgId, cfg, routes, now: Date.now(), deadline, counts: {} }
    const errors: string[] = []
    for (const [name, scan] of [
      ['bookings', scanDiscoveryBookings], ['coaching', scanCoachingBookings], ['funnel', scanFunnel], ['enrolled', scanEnrolled],
      ['timed', scanTimedFollowUps], ['leads', scanLeads], ['touch', closeTouchedTasks],
    ] as const) {
      if (Date.now() > deadline) break
      try { await scan(ctx) } catch (e: any) { errors.push(`${name}: ${String(e?.message ?? 'error').slice(0, 80)}`) }
    }
    const applied = await applyPending(db, cfg, orgId, deadline)
    out[orgId] = { mode: cfg.mode, recorded: ctx.counts, ...applied, errors }
  }
  return out
}
