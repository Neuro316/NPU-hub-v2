// src/lib/metrics/targets.ts
// Target rules shared by the dashboard, the Monday text, the onboarding "stuck" check and the work-back helper.
//
// A target row is per metric and month; a month without its own row uses the latest earlier month's.
//   total  (sum metrics)  the target is a monthly total, prorated per day; the status compares the value with the
//                         pace so far (days up to today), or with the whole range for a forward metric
//   level  (ratio, median, last)  the target is a level, compared with the value directly
// direction:
//   higher  green at or above amber × target, amber at or above red × target, else red   (amber 0.90, red 0.75)
//   lower   green at or below amber × target, amber at or below red × target, else red   (amber 1.00, red 1.25;
//           coaching capacity: amber 0.90, red 1.01, so exactly 100% is amber and above it red)
import { METRIC, targetKind, defaultDirection } from './registry'
import { daysInMonth, eachDay, monthStart } from './dates'

export type Direction = 'higher' | 'lower'
export type Status = 'green' | 'amber' | 'red'
export interface Target {
  metric_key: string
  month: string
  target_value: number
  amber_threshold: number
  red_threshold: number
  /** absent until hub_235 is applied: falls back to the metric's own direction */
  direction?: Direction | null
}

export const DEFAULT_THRESHOLDS: Record<Direction, { amber: number; red: number }> = {
  higher: { amber: 0.9, red: 0.75 },
  lower: { amber: 1, red: 1.25 },
}

export function directionOf(t: Target | null, metric: string): Direction {
  if (t?.direction === 'higher' || t?.direction === 'lower') return t.direction
  const def = METRIC[metric]
  return def ? defaultDirection(def) : 'higher'
}

/** Thresholds a target may carry for its direction (ratios of the target). */
export function validThresholds(direction: Direction, amber: number, red: number): boolean {
  if (!Number.isFinite(amber) || !Number.isFinite(red)) return false
  return direction === 'higher'
    ? red > 0 && red <= amber && amber <= 1
    : amber > 0 && amber <= red && red <= 10
}

/** The target in force for a month: its own row, else the latest earlier month's. */
export function targetFor(targets: Target[], metric: string, day: string): Target | null {
  const m = monthStart(day)
  return targets.filter(t => t.metric_key === metric && t.month <= m).sort((a, b) => b.month.localeCompare(a.month))[0] ?? null
}

/** A total target over the range (prorated per day) and the pace (only days up to today, or all for `full`). */
export function targetPace(targets: Target[], metric: string, from: string, to: string, today: string, full = false) {
  let target = 0, pace = 0, t: Target | null = null
  for (const d of eachDay(from, to)) {
    const tt = targetFor(targets, metric, d)
    if (!tt) continue
    t = tt
    const perDay = Number(tt.target_value) / daysInMonth(d)
    target += perDay
    if (full || d <= today) pace += perDay
  }
  return t ? { target, pace, amber: Number(t.amber_threshold), red: Number(t.red_threshold), direction: directionOf(t, metric) } : null
}

/** Status of a value against a reference (the pace for totals, the target for levels). */
export function statusOf(value: number, ref: number, amber: number, red: number, direction: Direction = 'higher'): Status | undefined {
  if (!(ref > 0)) return undefined
  const r = value / ref
  if (direction === 'lower') return r <= amber ? 'green' : r <= red ? 'amber' : 'red'
  return r >= amber ? 'green' : r >= red ? 'amber' : 'red'
}

/** Target, reference and status of one metric's value over a range. */
export function evaluate(targets: Target[], metric: string, value: number | null, from: string, to: string, today: string) {
  const def = METRIC[metric]
  if (!def || value == null) return null
  if (targetKind(def) === 'total') {
    const tp = targetPace(targets, metric, from, to, today, !!def.forward)
    if (!tp) return null
    return { target: tp.target, pace: tp.pace, direction: tp.direction, status: statusOf(value, tp.pace, tp.amber, tp.red, tp.direction) }
  }
  const t = targetFor(targets, metric, to)
  if (!t) return null
  const direction = directionOf(t, metric)
  const target = Number(t.target_value)
  return { target, pace: target, direction, status: statusOf(value, target, Number(t.amber_threshold), Number(t.red_threshold), direction) }
}

// ─── work back from the goal ─────────────────────────────────────────────────
export interface WorkBack {
  /** live rates used, as fractions */
  rates: { close: number | null; show: number | null; booking: number | null }
  month: { leads: number; booked_calls: number; shows: number } | null
  week: { leads: number; booked_calls: number; shows: number } | null
  missing: string[]
}

/**
 * From the onboarded goal per month and the live rates: booked calls = goal ÷ close rate (sales per booked call),
 * shows = booked calls × show rate, leads = booked calls ÷ lead-to-booked rate. Weekly = monthly × 12 ÷ 52.
 * Rates are fractions (0.25, not 25). A missing or zero rate leaves the plan empty and names what is missing.
 */
export function workBack(onboardedGoal: number | null, close: number | null, show: number | null, booking: number | null): WorkBack {
  const rates = { close, show, booking }
  const missing: string[] = []
  if (!(onboardedGoal && onboardedGoal > 0)) missing.push('an Onboarded target')
  if (!(close && close > 0)) missing.push('a close rate')
  if (!(show && show > 0)) missing.push('a show rate')
  if (!(booking && booking > 0)) missing.push('a lead to booked rate')
  if (missing.length) return { rates, month: null, week: null, missing }
  const booked = onboardedGoal! / close!
  const month = { leads: Math.ceil(booked / booking!), booked_calls: Math.ceil(booked), shows: Math.ceil(booked * show!) }
  const wk = (n: number) => Math.ceil((n * 12) / 52)
  return { rates, month, week: { leads: wk(booked / booking!), booked_calls: wk(booked), shows: wk(booked * show!) }, missing }
}
