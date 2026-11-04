// src/lib/scheduling/rules.ts
// Scheduling Rules (docs/plans/hub-scheduling-rules-rulings.md): the per-user source of
// truth for availability, shared with the platform booking links through one database
// function, public.hub_sched_check. This file holds the vocabulary and the validators
// for the owner-scoped API (/api/scheduling/*). The owner is ALWAYS the signed-in user;
// no route reads an owner from the request, so nobody (superadmins included) can edit
// another user's rules.
import type { SupabaseClient } from '@supabase/supabase-js'
import { toE164 } from '@/lib/phone'
import {
  REPEATS, WEEKDAY_LONG, intervalFor, isoWeekday, isRegularSpanStart, spanDays, weekdaysInSpan,
} from '@/lib/scheduling/spans'

export const SCHED_CATEGORIES = ['one_on_one', 'podcast', 'in_person', 'group_coaching', 'team_familiar'] as const
export const DAY_KINDS = ['school', 'kids_home', 'weekend', 'summer'] as const
export const MAIL_CATEGORIES = [
  'scheduling', 'lead', 'participant_support', 'partner_outreach', 'personal', 'legal_financial',
  'clinical', 'vendor_billing', 'security_alert', 'newsletter', 'spam',
] as const

/** Every reason code hub_sched_check can return, with the wording the page shows. */
export const CHECK_REASONS: Record<string, string> = {
  ok: 'Allowed.',
  invalid_request: 'The request is incomplete or the category is unknown.',
  no_rules_set: 'No rules set yet: add at least one category window.',
  spans_days: 'Starts and ends on different days.',
  before_earliest_start: 'Starts before the earliest start time.',
  summer_rules_undefined: 'After the school year ends, and no summer windows are set.',
  one_off_block: 'Overlaps a one-off block.',
  recurring_block: 'Overlaps a recurring block.',
  blocked_window: 'Overlaps a daily blocked window.',
  kids_home: 'Kids are home, and this category is not allowed then.',
  weekend: 'Weekend, and this category has no weekend windows.',
  outside_window: 'Not inside an allowed window for this category on this kind of day.',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

export class Invalid extends Error {}
type Row = Record<string, unknown>

function oneOf<T extends readonly string[]>(v: unknown, list: T, field: string): T[number] {
  if (typeof v !== 'string' || !list.includes(v)) throw new Invalid(`${field} must be one of: ${list.join(', ')}.`)
  return v as T[number]
}
function time(v: unknown, field: string): string {
  if (typeof v !== 'string' || !TIME.test(v)) throw new Invalid(`${field} must be a time like 08:00.`)
  return v
}
function timeOrNull(v: unknown, field: string): string | null {
  return v === null || v === '' || v === undefined ? null : time(v, field)
}
function date(v: unknown, field: string): string {
  if (typeof v !== 'string' || !DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new Invalid(`${field} must be a date like 2026-11-11.`)
  return v
}
function dateOrNull(v: unknown, field: string): string | null {
  return v === null || v === '' || v === undefined ? null : date(v, field)
}
function text(v: unknown, field: string, max: number, required = false): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (required && !s) throw new Invalid(`${field} is required.`)
  if (s.length > max) throw new Invalid(`${field} must be at most ${max} characters.`)
  return s
}
function isoDay(v: unknown, field: string): number {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1 || n > 7) throw new Invalid(`${field} must be a weekday, 1 (Monday) to 7 (Sunday).`)
  return n
}
function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw new Invalid(`${field} must be true or false.`)
  return v
}
/** null = every category; otherwise a non-empty list of known categories. */
function categoriesOrAll(v: unknown): string[] | null {
  if (v === null || v === undefined) return null
  if (!Array.isArray(v) || !v.length) throw new Invalid('Choose at least one category, or all.')
  return Array.from(new Set(v.map(c => oneOf(c, SCHED_CATEGORIES, 'category'))))
}
function ordered(start: string | null, end: string | null) {
  if (start && end && end <= start) throw new Invalid('The end time must be after the start time.')
}
function validTimezone(v: unknown): string {
  if (typeof v !== 'string' || !v || v.length > 64) throw new Invalid('Choose a time zone.')
  try { new Intl.DateTimeFormat('en-US', { timeZone: v }) } catch { throw new Invalid('Unknown time zone.') }
  return v
}

/** Picks only the fields present in `body` (for PATCH) or all of them (for POST). */
function pick(body: Row, partial: boolean, fields: Record<string, (v: unknown) => unknown>): Row {
  const out: Row = {}
  for (const [k, fn] of Object.entries(fields)) {
    if (partial && !(k in body)) continue
    out[k] = fn(body[k])
  }
  if (partial && !Object.keys(out).length) throw new Invalid('Nothing to change.')
  return out
}

export interface ResourceSpec {
  table: string
  /** methods allowed on /api/scheduling/<resource> */
  methods: ('POST' | 'PATCH' | 'DELETE')[]
  /** body → columns to write (owner_user_id is added by the route). `tz` is the owner's
   *  time zone, for fields entered as local wall-clock times. */
  validate(body: Row, partial: boolean, tz: string): Row
}

const LOCAL_DT = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)$/

/** "2026-11-05 15:00" in the owner's zone → a timestamptz literal Postgres resolves
 *  itself ("2026-11-05 15:00 America/New_York"), DST included. */
export function localTimestamp(v: unknown, field: string, tz: string): string {
  const m = typeof v === 'string' ? v.match(LOCAL_DT) : null
  if (!m) throw new Invalid(`${field} must be a date and time like 2026-11-05 15:00.`)
  date(m[1], field)
  return `${m[1]} ${m[2]}:${m[3]} ${tz}`
}

export const RESOURCES: Record<string, ResourceSpec> = {
  'category-windows': {
    table: 'hub_sched_category_windows',
    methods: ['POST', 'DELETE'],
    validate(b, partial) {
      const r = pick(b, partial, {
        category: v => oneOf(v, SCHED_CATEGORIES, 'category'),
        day_kind: v => oneOf(v, DAY_KINDS, 'day kind'),
        start_time: v => time(v, 'start'),
        end_time: v => time(v, 'end'),
      })
      ordered(r.start_time as string, r.end_time as string)
      return r
    },
  },
  'blocked-windows': {
    table: 'hub_sched_blocked_windows',
    methods: ['POST', 'PATCH', 'DELETE'],
    validate(b, partial) {
      const r = pick(b, partial, {
        day_kind: v => oneOf(v, DAY_KINDS, 'day kind'),
        start_time: v => time(v, 'start'),
        end_time: v => time(v, 'end'),
        label: v => text(v, 'label', 120, true),
        categories: categoriesOrAll,
      })
      ordered(r.start_time as string, r.end_time as string)
      return r
    },
  },
  'kids-home-dates': {
    table: 'hub_sched_kids_home_dates',
    methods: ['POST', 'DELETE'],
    validate(b, partial) {
      return pick(b, partial, {
        date: v => date(v, 'date'),
        from_time: v => timeOrNull(v, 'from time'),
        label: v => text(v, 'label', 120),
        source: v => {
          const s = text(v, 'source', 40) || 'manual'
          if (!/^[a-z0-9_]{1,40}$/.test(s)) throw new Invalid('Source may use only a-z, 0-9 and _.')
          return s
        },
      })
    },
  },
  'recurring-blocks': {
    table: 'hub_sched_recurring_blocks',
    methods: ['POST', 'PATCH', 'DELETE'],
    // Always validated whole (the page sends the full block), because the span rules
    // relate the fields to each other. Per-day times travel separately as day_times.
    validate(b) {
      const repeat = oneOf(b.repeat, REPEATS, 'repeat')
      const n = Number(b.interval_weeks)
      if (repeat === 'custom' && (!Number.isInteger(n) || n < 1 || n > 52)) throw new Invalid('Repeat every 1 to 52 weeks.')
      const from = isoDay(b.from_weekday, 'From'), to = isoDay(b.to_weekday, 'To')
      const anchor = dateOrNull(b.anchor_date, 'starting date')
      if (anchor && isoWeekday(anchor) !== from) throw new Invalid(`The starting date must be a ${WEEKDAY_LONG[from]}.`)
      if (!Array.isArray(b.days) || !b.days.length) throw new Invalid('Choose at least one day.')
      const inSpan = weekdaysInSpan(from, to)
      const days = Array.from(new Set<number>(b.days.map((d: unknown) => isoDay(d, 'Day')))).sort((x, y) => x - y)
      if (days.some(d => !inSpan.includes(d))) throw new Invalid('Choose only days inside the span.')
      const all_day = b.all_day === true, per_day_times = b.per_day_times === true
      const start_time = all_day ? null : timeOrNull(b.start_time, 'start')
      const end_time = all_day ? null : timeOrNull(b.end_time, 'end')
      ordered(start_time, end_time)
      if (!!start_time !== !!end_time) throw new Invalid('Give both a start and an end time, or neither.')
      const active = bool(b.active, 'active')
      if (active && !anchor) throw new Invalid('An active block needs a starting date.')
      if (active && !all_day && !per_day_times && !start_time) throw new Invalid('An active block needs times, all day, or different times per day.')
      return {
        name: text(b.name, 'name', 120, true), active, repeat, interval_weeks: intervalFor(repeat, n),
        from_weekday: from, to_weekday: to, anchor_date: anchor, days, all_day, start_time, end_time,
        per_day_times, categories: categoriesOrAll(b.categories),
      }
    },
  },
  'recurring-overrides': {
    table: 'hub_sched_recurring_overrides',
    methods: ['POST', 'DELETE'],
    validate(b, partial) {
      const r = pick(b, partial, {
        block_id: v => { if (!isUuid(v)) throw new Invalid('Unknown block.'); return v },
        date: v => date(v, 'date'),
        kind: v => oneOf(v, ['skip', 'add', 'change', 'skip_span', 'add_span'] as const, 'kind'),
        start_time: v => timeOrNull(v, 'start'),
        end_time: v => timeOrNull(v, 'end'),
      })
      ordered(r.start_time as string | null, r.end_time as string | null)
      if (r.kind === 'change' && (!r.start_time || !r.end_time)) throw new Invalid('A changed date needs a start and an end time.')
      if (r.kind === 'skip' || r.kind === 'skip_span' || r.kind === 'add_span') { r.start_time = null; r.end_time = null }
      return r
    },
  },
  'one-off-blocks': {
    table: 'hub_sched_one_off_blocks',
    methods: ['POST', 'PATCH', 'DELETE'],
    validate(b, partial, tz) {
      const r = pick(b, partial, {
        starts_at: v => localTimestamp(v, 'Start', tz),
        ends_at: v => localTimestamp(v, 'End', tz),
        label: v => text(v, 'label', 200),
        categories: categoriesOrAll,
      })
      // same zone on both sides, so the wall-clock strings compare in order
      if (r.starts_at && r.ends_at && (r.ends_at as string) <= (r.starts_at as string)) throw new Invalid('The end must be after the start.')
      return r
    },
  },
  'trusted-senders': {
    table: 'hub_sched_trusted_senders',
    methods: ['POST', 'PATCH', 'DELETE'],
    validate(b, partial) {
      const r = pick(b, partial, {
        display_name: v => text(v, 'name', 120, true),
        channel: v => oneOf(v, ['sms', 'slack'] as const, 'channel'),
        sender_address: v => text(v, 'address', 40, true),
        permission: v => oneOf(v, ['block_only', 'block_and_reschedule'] as const, 'permission'),
        active: v => bool(v, 'active'),
      })
      if ('sender_address' in r || 'channel' in r) {
        if (!('sender_address' in r && 'channel' in r)) throw new Invalid('Change the channel and the address together.')
        if (r.channel === 'sms') {
          const e164 = toE164(String(r.sender_address))
          if (!/^\+[1-9]\d{6,14}$/.test(e164)) throw new Invalid('Enter a phone number like +1 828 555 0100.')
          r.sender_address = e164
        } else if (!/^[UW][A-Z0-9]{6,20}$/.test(String(r.sender_address))) {
          throw new Invalid('Enter a Slack member ID like U012AB3CD.')
        }
      }
      return r
    },
  },
  'reply-rules': {
    table: 'hub_sched_reply_rules',
    methods: ['POST', 'PATCH'],
    validate(b, partial) {
      const r = pick(b, partial, {
        ...(partial ? {} : { connection_id: (v: unknown) => { if (!isUuid(v)) throw new Invalid('Unknown mailbox.'); return v } }),
        reply_from: v => {
          const s = text(v, 'reply-from address', 320, true).toLowerCase()
          if (!s.endsWith('@neuroprogeny.com')) throw new Invalid('Reply from an @neuroprogeny.com address.')
          return s
        },
        // Sending is not built; draft_only is the only mode accepted for now.
        mode: v => oneOf(v, ['draft_only'] as const, 'mode'),
        always_draft_categories: v => {
          if (!Array.isArray(v)) throw new Invalid('Always-draft categories must be a list.')
          return Array.from(new Set(v.map(c => oneOf(c, MAIL_CATEGORIES, 'category'))))
        },
        voice_note: v => text(v, 'voice note', 2000),
      })
      return r
    },
  },
  'exception-requests': {
    table: 'hub_sched_exception_requests',
    methods: ['PATCH'],
    validate(b) {
      const status = oneOf(b.status, ['approved', 'declined', 'cancelled'] as const, 'status')
      return { status, decided_at: new Date().toISOString() }
    },
  },
}

export const DEFAULT_TIMEZONE = 'America/New_York'

/** The owner's time zone from their settings row, or the default. */
export async function ownerTimezone(db: SupabaseClient, ownerId: string): Promise<string> {
  const { data } = await db.from('hub_sched_settings').select('timezone').eq('owner_user_id', ownerId).maybeSingle()
  return (data?.timezone as string | undefined) || DEFAULT_TIMEZONE
}

export const SETTINGS_FIELDS =(b: Row): Row => pick(b, false, {
  timezone: validTimezone,
  earliest_start: v => time(v, 'earliest start'),
  school_year_end: v => dateOrNull(v, 'school year end'),
})

/** Per-day times for a block with per_day_times: one row per chosen day of the span
 *  (by offset, so the two Wednesdays of a Wed..Wed span are separate). An active block
 *  must give every chosen day a row. */
export function validateDayTimes(raw: unknown, block: Row): Row[] {
  if (!block.per_day_times) return []
  if (!Array.isArray(raw)) throw new Invalid('Give times for each chosen day.')
  const chosen = spanDays(block.from_weekday as number, block.to_weekday as number)
    .filter(d => (block.days as number[]).includes(d.weekday)).map(d => d.offset)
  const rows = new Map<number, Row>()
  for (const item of raw as Row[]) {
    const off = Number(item?.span_offset)
    if (!chosen.includes(off)) throw new Invalid('Per-day times must be for days chosen in the span.')
    const all_day = item.all_day === true
    const start_time = all_day ? null : time(item.start_time, 'start')
    const end_time = all_day ? null : time(item.end_time, 'end')
    ordered(start_time, end_time)
    rows.set(off, { span_offset: off, all_day, start_time, end_time })
  }
  if (block.active && chosen.some(o => !rows.has(o))) throw new Invalid('Give a time window or all day for every chosen day.')
  return Array.from(rows.values())
}

/** skip_span must name the first day of a regular span; add_span must start on the
 *  block's From weekday. `block` is the owner's own row. */
export function checkSpanOverride(kind: unknown, date: unknown, block: Row | null) {
  if (kind !== 'skip_span' && kind !== 'add_span') return
  if (!block) throw new Invalid('Unknown block.')
  if (typeof date !== 'string') throw new Invalid('Choose a date.')
  if (isoWeekday(date) !== block.from_weekday) throw new Invalid(`A week starts on a ${WEEKDAY_LONG[block.from_weekday as number]}.`)
  if (kind === 'skip_span' && (!block.anchor_date || !isRegularSpanStart(block.anchor_date as string, block.interval_weeks as number, date))) {
    throw new Invalid('That date does not start one of this block\'s weeks.')
  }
}
