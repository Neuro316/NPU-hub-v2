// src/lib/metrics/rollup.ts
// Items → hub_metrics_daily rows, and the replace that makes a recompute idempotent:
// the range's rows for the computed metrics are deleted, then the new rows are inserted.
// Level metrics (agg 'last': a count as of now) exist only for the day they were taken,
// so a recompute of past days never deletes them.
import type { SupabaseClient } from '@supabase/supabase-js'
import { METRICS, METRIC } from './registry'
import { collect, median, type Item } from './collect'
import { loadTestFilter } from './test-filter'
import { nyDay } from './dates'

export interface Row { date: string; metric_key: string; dimension_key: string; dimension_value: string; value: number }

const STORED = METRICS.filter(m => m.agg !== 'ratio' && m.agg !== 'gap')
const LEVEL_KEYS = STORED.filter(m => m.agg === 'last').map(m => m.key)
const DAILY_KEYS = STORED.filter(m => m.agg !== 'last').map(m => m.key)

export function toRows(items: Item[]): Row[] {
  const rows = new Map<string, Row>()
  const add = (date: string, metric: string, dk: string, dv: string, v: number) => {
    const k = `${date}|${metric}|${dk}|${dv}`
    const r = rows.get(k)
    if (r) r.value += v
    else rows.set(k, { date, metric_key: metric, dimension_key: dk.slice(0, 64), dimension_value: dv.slice(0, 200), value: v })
  }
  const byMetricDay = new Map<string, Item[]>()
  for (const it of items) {
    const k = `${it.metric}|${it.day}`
    byMetricDay.set(k, [...(byMetricDay.get(k) ?? []), it])
  }
  for (const [k, list] of Array.from(byMetricDay.entries())) {
    const [metric, day] = k.split('|')
    const def = METRIC[metric]
    if (!def) continue
    if (def.agg === 'median') {
      add(day, metric, '', '', median(list.map(i => i.value)))
      const seen = new Map<string, number>()
      list.forEach((i, n) => {
        const base = i.rec?.id ?? `n${n}`
        const c = (seen.get(base) ?? 0) + 1
        seen.set(base, c)
        add(day, metric, 'item', c > 1 ? `${base}#${c}` : base, i.value)
      })
      continue
    }
    for (const i of list) {
      add(day, metric, '', '', i.value)
      for (const [dk, dv] of Object.entries(i.dims ?? {})) add(day, metric, dk, dv, i.value)
    }
  }
  return Array.from(rows.values()).map(r => ({ ...r, value: Math.round(r.value * 100) / 100 }))
}

export async function replaceRange(db: SupabaseClient, from: string, to: string, today: string, rows: Row[]): Promise<void> {
  const del1 = await db.from('hub_metrics_daily').delete().gte('date', from).lte('date', to).in('metric_key', DAILY_KEYS)
  if (del1.error) throw new Error(`metrics delete failed: ${del1.error.code}`)
  if (today >= from && today <= to) {
    const del2 = await db.from('hub_metrics_daily').delete().eq('date', today).in('metric_key', LEVEL_KEYS)
    if (del2.error) throw new Error(`metrics delete failed: ${del2.error.code}`)
  }
  const now = new Date().toISOString()
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('hub_metrics_daily').insert(rows.slice(i, i + 500).map(r => ({ ...r, computed_at: now })))
    if (error) throw new Error(`metrics insert failed: ${error.code}`)
  }
}

/** Recompute [from, to] (New York days) and replace those days' rows. */
export async function runRollup(db: SupabaseClient, from: string, to: string, now = new Date()) {
  const filter = await loadTestFilter(db)
  const today = nyDay(now)
  const items = await collect({ db, from, to, today, now, filter })
  const rows = toRows(items)
  await replaceRange(db, from, to, today, rows)
  return { from, to, items: items.length, rows: rows.length, test_filter: filter.stats }
}
