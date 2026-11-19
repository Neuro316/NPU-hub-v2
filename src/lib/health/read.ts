// src/lib/health/read.ts
// Server only (service role behind withStaff). What the Hub Health page, the home card and the bell read.
//   tiles    the newest 'hub' snapshot of each tile, needs attention first. Superadmins only (the page is theirs).
//   alerts   unacknowledged platform_alerts of BOTH sources. Admins and superadmins (the RLS select rule of pf_313).
//   ack      writes acknowledged_at and acknowledged_by on one alert of either source, once.
import type { SupabaseClient } from '@supabase/supabase-js'
import { TILES, TILE_LABEL, attentionOrder, type TileKind } from './rules'

export const ALERT_ROLES = ['admin', 'superadmin']

export async function profileRole(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await db.from('profiles').select('role').eq('id', userId).maybeSingle()
  return (data as any)?.role ?? null
}

export interface TileView { kind: string; label: string; status: string; reason: string; captured_at: string }

export async function latestTiles(db: SupabaseClient): Promise<TileView[]> {
  const { data, error } = await db.from('platform_health_snapshots').select('kind, status, detail, captured_at')
    .eq('source', 'hub').in('kind', TILES.map((t) => t.kind)).order('captured_at', { ascending: false }).limit(TILES.length * 4)
  if (error) throw new Error(`snapshots read: ${error.code ?? 'unknown'}`)
  const seen = new Set<string>()
  const out: TileView[] = []
  for (const r of (data ?? []) as any[]) {
    if (seen.has(r.kind)) continue
    seen.add(r.kind)
    out.push({ kind: r.kind, label: TILE_LABEL[r.kind as TileKind] ?? r.kind, status: r.status, reason: String(r.detail?.reason ?? ''), captured_at: r.captured_at })
  }
  return attentionOrder(out)
}

export interface AlertView { id: string; source: string; kind: string; label: string; severity: string; message: string; opened_at: string; resolved_at: string | null }

export async function unacknowledgedAlerts(db: SupabaseClient): Promise<AlertView[]> {
  const { data, error } = await db.from('platform_alerts').select('id, source, kind, severity, message, opened_at, resolved_at')
    .is('acknowledged_at', null).order('opened_at', { ascending: false }).limit(25)
  if (error) throw new Error(`alerts read: ${error.code ?? 'unknown'}`)
  return ((data ?? []) as any[]).map((a) => ({ id: a.id, source: a.source, kind: a.kind, label: a.source === 'hub' ? TILE_LABEL[a.kind as TileKind] ?? a.kind : a.kind,
    severity: a.severity, message: String(a.message ?? '').slice(0, 200), opened_at: a.opened_at, resolved_at: a.resolved_at ?? null }))
}

/** true when this call acknowledged it; false when it was already acknowledged or does not exist. */
export async function acknowledge(db: SupabaseClient, id: string, userId: string, now: Date): Promise<boolean> {
  const { data, error } = await db.from('platform_alerts').update({ acknowledged_at: now.toISOString(), acknowledged_by: userId })
    .eq('id', id).is('acknowledged_at', null).select('id')
  if (error) throw new Error(`alert ack: ${error.code ?? 'unknown'}`)
  return (data ?? []).length === 1
}
