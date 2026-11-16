// src/lib/metrics/summary.ts
// Turns hub_metrics_daily rows into tile values for a range: the value, the previous
// period's value, breakdowns, a daily series, and the target status. Used by the dashboard
// API and the Monday scorecard, so both show the same numbers.
import type { SupabaseClient } from '@supabase/supabase-js'
import { METRICS, METRIC, type MetricDef } from './registry'
import { median } from './collect'
import { addDays, daysBetween, daysInMonth, monthStart } from './dates'
import { evaluate, type Target, type Status, type Direction } from './targets'

export { targetFor, targetPace, statusOf, type Target, type Status } from './targets'
export interface TileValue {
  value: number | null
  prev: number | null
  n?: number | null
  hidden?: boolean
  dims?: Record<string, { value: string; v: number }[]>
  target?: number
  pace?: number
  status?: Status
  direction?: Direction
  /** a forward metric's range end (the month's end when the range ends today) */
  through?: string
}
interface DbRow { date: string; metric_key: string; dimension_key: string; dimension_value: string; value: number }

export function previousRange(from: string, to: string): { from: string; to: string } {
  const len = daysBetween(from, to) + 1
  return { from: addDays(from, -len), to: addDays(from, -1) }
}

export async function loadRows(db: SupabaseClient, from: string, to: string): Promise<DbRow[]> {
  const out: DbRow[] = []
  for (let a = 0; ; a += 1000) {
    const { data, error } = await db.from('hub_metrics_daily').select('date, metric_key, dimension_key, dimension_value, value')
      .gte('date', from).lte('date', to).order('date').range(a, a + 999)
    if (error) throw new Error(`metrics read failed: ${error.code}`)
    out.push(...((data ?? []) as DbRow[]).map(r => ({ ...r, value: Number(r.value) })))
    if ((data ?? []).length < 1000) break
  }
  return out
}

/** A forward metric (dated by session day) read for a range ending today runs to the end of that month. */
export function forwardTo(to: string, today: string): string {
  return to === today ? addDays(monthStart(to), daysInMonth(to) - 1) : to
}

function valueOf(def: MetricDef, rows: DbRow[], from: string, to: string, cache: Map<string, number | null>): number | null {
  const key = `${def.key}|${from}|${to}`
  if (cache.has(key)) return cache.get(key)!
  const mine = rows.filter(r => r.metric_key === def.key && r.date >= from && r.date <= to)
  let v: number | null = null
  if (def.agg === 'sum') v = mine.filter(r => r.dimension_key === '').reduce((n, r) => n + r.value, 0)
  else if (def.agg === 'median') { const xs = mine.filter(r => r.dimension_key === 'item').map(r => r.value); v = xs.length ? median(xs) : null }
  else if (def.agg === 'last') { const t = mine.filter(r => r.dimension_key === ''); v = t.length ? t[t.length - 1].value : null }
  else if (def.agg === 'ratio' && def.num && def.den) {
    const num = valueOf(METRIC[def.num], rows, from, to, cache), den = valueOf(METRIC[def.den], rows, from, to, cache)
    v = num != null && den ? (num / den) * (def.scale ?? 1) : null
  }
  cache.set(key, v)
  return v
}

function dimsOf(def: MetricDef, rows: DbRow[], from: string, to: string) {
  if (!def.dim) return undefined
  if (def.agg === 'ratio' && def.num && def.den) {
    // per breakdown value (a cohort month): num ÷ den within that value, with n shown in the label's place
    const by = (k: string) => {
      const m = new Map<string, number>()
      for (const r of rows) if (r.metric_key === k && r.date >= from && r.date <= to && r.dimension_key === def.dim) m.set(r.dimension_value, (m.get(r.dimension_value) ?? 0) + r.value)
      return m
    }
    const num = by(def.num), den = by(def.den)
    return { [def.dim]: Array.from(den.entries()).filter(([, d]) => d > 0)
      .map(([value, d]) => ({ value: `${value} (n ${Math.round(d)})`, v: Math.round(((num.get(value) ?? 0) / d) * (def.scale ?? 1) * 100) / 100 }))
      .sort((a, b) => b.value.localeCompare(a.value)) }
  }
  const mine = rows.filter(r => r.metric_key === def.key && r.date >= from && r.date <= to && r.dimension_key === def.dim)
  let use = mine
  if (def.agg === 'last') { const last = mine.map(r => r.date).sort().pop(); use = mine.filter(r => r.date === last) }
  const sums = new Map<string, number>()
  for (const r of use) sums.set(r.dimension_value, (sums.get(r.dimension_value) ?? 0) + r.value)
  return { [def.dim]: Array.from(sums.entries()).map(([value, v]) => ({ value, v: Math.round(v * 100) / 100 })).sort((a, b) => b.v - a.v) }
}

export async function summarize(db: SupabaseClient, from: string, to: string, today: string, opts: { series?: boolean } = {}) {
  const prev = previousRange(from, to)
  const fwdTo = forwardTo(to, today)
  const [rows, targetsRes, stamp] = await Promise.all([
    loadRows(db, prev.from, fwdTo),
    // '*' so the page keeps working before hub_235 adds `direction` (the metric's own direction is the fallback)
    db.from('hub_metric_targets').select('*'),
    db.from('hub_metrics_daily').select('computed_at').order('computed_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (targetsRes.error) throw new Error(`targets read failed: ${targetsRes.error.code}`)
  const targets = (targetsRes.data ?? []) as Target[]
  const cache = new Map<string, number | null>()
  const out: Record<string, TileValue> = {}
  for (const def of METRICS) {
    if (def.agg === 'gap') { out[def.key] = { value: null, prev: null }; continue }
    const end = def.forward ? fwdTo : to
    const value = valueOf(def, rows, from, end, cache)
    const tile: TileValue = { value, prev: valueOf(def, rows, prev.from, prev.to, cache), dims: dimsOf(def, rows, from, end) }
    if (end !== to) tile.through = end
    if (def.agg === 'ratio' && def.minN && def.den) {
      const n = valueOf(METRIC[def.den], rows, from, end, cache)
      tile.n = n
      if ((n ?? 0) < def.minN) { tile.hidden = true; tile.value = null; tile.prev = null }
    }
    const ev = evaluate(targets, def.key, value, from, end, today)
    if (ev) {
      tile.target = Math.round(ev.target * 100) / 100
      tile.pace = Math.round(ev.pace * 100) / 100
      tile.status = ev.status
      tile.direction = ev.direction
    }
    out[def.key] = tile
  }
  let series: Record<string, { day: string; v: number }[]> | undefined
  if (opts.series) {
    series = {}
    for (const r of rows) {
      if (r.dimension_key !== '' || r.date < from || r.date > to) continue
      ;(series[r.metric_key] ??= []).push({ day: r.date, v: r.value })
    }
  }
  return { from, to, prev, metrics: out, series, targets, computed_at: stamp.data?.computed_at ?? null }
}

// ─── funnel (Scorecard strip and the Monday text) ───────────────────────────
export const FUNNEL: [string, string][] = [['leads', 'Leads'], ['booked_calls', 'Booked calls'], ['phase1_sales', 'Phase 1 sales'], ['onboarded', 'Onboarded']]

/** The step with the lowest conversion (shows are skipped: never recorded yet, gap G2). */
export function biggestDropOff(values: Record<string, number | null>): string | null {
  let worst: { text: string; rate: number } | null = null
  for (let i = 0; i < FUNNEL.length - 1; i++) {
    const [a, la] = FUNNEL[i], [b, lb] = FUNNEL[i + 1]
    const va = values[a] ?? 0, vb = values[b] ?? 0
    if (va <= 0) continue
    const rate = vb / va
    if (!worst || rate < worst.rate) worst = { text: `${la} → ${lb}: ${Math.round(vb)} of ${Math.round(va)} (${Math.round(rate * 100)}%)`, rate }
  }
  return worst?.text ?? null
}
