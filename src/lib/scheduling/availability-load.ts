// src/lib/scheduling/availability-load.ts
// The I/O half of availability.ts: reads the rows the slot generator needs and asks hub_sched_check about each
// candidate. EVERY nr_* read here is a SELECT: this file never writes to a University table, and never reads
// nr_calendar_tokens or any credential. The University busy cache is read for one connection only, and only its
// window bounds and the bare busy intervals.
// Errors carry short codes only. hub_234 not applied (hub_calendar_* missing) means "no Hub busy events".
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingTable } from '@/lib/calendar/scopes'
import {
  businessDays, candidateSlots, pickSpread, zonedMs, addDays,
  type AvailabilityInput, type SchedCategory, type Slot,
} from './availability'

export const SCHED_OWNER = '22456608-5f7d-495e-af02-7037fea125cc'
export const SCHED_ORG = '00000000-0000-0000-0000-000000000001'
export const SCHED_TZ = 'America/New_York'
/** The University appointment type whose windows also count for one_on_one. */
export const DISCOVERY_TYPE_ID = 'e93799e2-4340-494c-881a-94b8792d0ee5'
/** The University calendar connection whose busy cache is read (read only). */
export const BUSY_CONNECTION_ID = '9121aa3c-7da0-41d1-81aa-f253d92d9031'
const SNAPSHOT_MAX_AGE_MS = 24 * 3600_000
const MAX_RULE_CHECKS = 240
const RULE_CONCURRENCY = 10

export class AvailabilityError extends Error { constructor(readonly code: string) { super(code) } }

export interface AvailabilityResult {
  slots: Slot[]
  /** the first rule-valid candidate ignoring busy, for an exception request; null when there is none */
  firstRuleValid: Slot | null
  checked: number
}

async function ruleAllowed(db: SupabaseClient, owner: string, category: SchedCategory, s: Slot): Promise<boolean> {
  const { data, error } = await db.rpc('hub_sched_check', { p_owner: owner, p_category: category, p_starts_at: s.start, p_ends_at: s.end })
  if (error) throw new AvailabilityError(`rule_check_${error.code ?? 'unknown'}`)
  const row = Array.isArray(data) ? data[0] : data
  return row?.allowed === true
}

export async function loadAvailabilityInput(
  db: SupabaseClient, category: SchedCategory, now: string, owner = SCHED_OWNER,
): Promise<AvailabilityInput> {
  const dates = businessDays(now, SCHED_TZ)
  const from = new Date(zonedMs(addDays(dates[0], -1), 0, 0, SCHED_TZ) ?? Date.parse(now)).toISOString()
  const to = new Date(zonedMs(addDays(dates[dates.length - 1], 2), 0, 0, SCHED_TZ) ?? Date.parse(now) + 20 * 86_400_000).toISOString()

  const [winRes, ovRes, snapRes] = await Promise.all([
    db.from('nr_availability_windows').select('weekdays, start_time, end_time, timezone, appointment_type_id').eq('user_id', owner),
    db.from('nr_availability_overrides').select('kind, starts_at, ends_at')
      .or(`user_id.eq.${owner},and(user_id.is.null,org_id.eq.${SCHED_ORG})`)
      .lt('starts_at', to).gt('ends_at', from),
    db.from('nr_calendar_busy_cache').select('window_from, window_to, busy')
      .eq('connection_id', BUSY_CONNECTION_ID)
      .gte('fetched_at', new Date(Date.parse(now) - SNAPSHOT_MAX_AGE_MS).toISOString())
      .lte('window_from', to).gte('window_to', from)
      .order('fetched_at', { ascending: false }).limit(200),
  ])
  if (winRes.error) throw new AvailabilityError(`windows_${winRes.error.code ?? 'unknown'}`)
  if (ovRes.error) throw new AvailabilityError(`overrides_${ovRes.error.code ?? 'unknown'}`)
  if (snapRes.error) throw new AvailabilityError(`busy_cache_${snapRes.error.code ?? 'unknown'}`)

  const windows = ((winRes.data ?? []) as any[]).filter((w) =>
    w.appointment_type_id == null || (category === 'one_on_one' && w.appointment_type_id === DISCOVERY_TYPE_ID))

  // The Hub's own busy events from included calendars of the owner's mailboxes. Missing tables: none.
  let hubBusy: { start: string; end: string }[] = []
  const { data: conns, error: cErr } = await db.from('hub_mail_connections').select('id').eq('owner_user_id', owner)
  if (cErr) throw new AvailabilityError(`connections_${cErr.code ?? 'unknown'}`)
  const connIds = ((conns ?? []) as { id: string }[]).map((c) => c.id)
  if (connIds.length) {
    const { data: cals, error: calErr } = await db.from('hub_calendar_calendars').select('id')
      .in('connection_id', connIds).eq('excluded', false)
    if (calErr && !isMissingTable(calErr)) throw new AvailabilityError(`hub_calendars_${calErr.code ?? 'unknown'}`)
    const calIds = ((cals ?? []) as { id: string }[]).map((c) => c.id)
    if (!calErr && calIds.length) {
      const { data: evs, error: evErr } = await db.from('hub_calendar_events').select('starts_at, ends_at')
        .in('calendar_id', calIds).eq('busy', true).lt('starts_at', to).gt('ends_at', from).limit(2000)
      if (evErr && !isMissingTable(evErr)) throw new AvailabilityError(`hub_events_${evErr.code ?? 'unknown'}`)
      hubBusy = ((evs ?? []) as any[]).map((e) => ({ start: e.starts_at, end: e.ends_at }))
    }
  }

  return {
    now, tz: SCHED_TZ, category,
    windows: windows.map((w) => ({ weekdays: w.weekdays ?? [], start_time: w.start_time, end_time: w.end_time, timezone: w.timezone })),
    overrides: ((ovRes.data ?? []) as any[]).map((o) => ({ kind: o.kind, starts_at: o.starts_at, ends_at: o.ends_at })),
    snapshots: ((snapRes.data ?? []) as any[]).map((s) => ({ window_from: s.window_from, window_to: s.window_to, busy: Array.isArray(s.busy) ? s.busy : [] })),
    hubBusy,
  }
}

/** Up to 3 bookable slots, and the first rule-valid time ignoring busy. Throws AvailabilityError on a read error. */
export async function findAvailability(
  db: SupabaseClient, category: SchedCategory, now = new Date().toISOString(), owner = SCHED_OWNER,
): Promise<AvailabilityResult> {
  const input = await loadAvailabilityInput(db, category, now, owner)
  const { free, ignoringBusy } = candidateSlots(input)
  const verdict = new Map<string, boolean>()
  const todo = ignoringBusy.slice(0, MAX_RULE_CHECKS)
  for (let i = 0; i < todo.length; i += RULE_CONCURRENCY) {
    const batch = todo.slice(i, i + RULE_CONCURRENCY)
    const res = await Promise.all(batch.map((s) => ruleAllowed(db, owner, category, s)))
    batch.forEach((s, j) => verdict.set(s.start, res[j]))
  }
  const allowed = (s: Slot) => verdict.get(s.start) === true
  return {
    slots: pickSpread(free.filter(allowed)),
    firstRuleValid: ignoringBusy.find(allowed) ?? null,
    checked: verdict.size,
  }
}
