// src/lib/touchpoints/rules.ts
// Touchpoint monitoring, Part 1 (Running List q35): the "waiting on us" situations, their thresholds, severity, the
// plain one-line "why", and the daily fix suggestion. Pure: no imports, so the harness
// (scripts/touchpoints/touchpoints-tamper.cjs) runs it directly. The thresholds live here and only here.

export const SITUATIONS = ['booking_link_not_booked', 'inbound_no_reply', 'text_no_reply', 'coursework_quiet', 'discovery_no_followup'] as const
export type SituationKind = (typeof SITUATIONS)[number]

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** How long someone waits before it is a situation. One place, no settings UI in Part 1. */
export const THRESHOLDS: Record<SituationKind, number> = {
  booking_link_not_booked: 48 * HOUR,
  inbound_no_reply: 24 * HOUR,
  text_no_reply: 24 * HOUR,
  coursework_quiet: 7 * DAY,
  discovery_no_followup: 48 * HOUR,
}
/** Triggering records older than this are not looked at (keeps the first run from raising a month of history). */
export const LOOKBACK_DAYS = 14
/** New cards per run, at most; the rest are raised on the next run. */
export const MAX_NEW_PER_RUN = 25

/** The situation in plain words, for the card title "<Name>: <this>". */
export const PLAIN: Record<SituationKind, string> = {
  booking_link_not_booked: 'booking link shared, no call booked',
  inbound_no_reply: 'emailed us, no reply yet',
  text_no_reply: 'texted us, no reply yet',
  coursework_quiet: 'coursework has gone quiet',
  discovery_no_followup: 'no follow-up after the discovery call',
}

export type Severity = 'low' | 'medium' | 'high'
/** How long they have waited against the threshold: past it low, twice it medium, four times it high. */
export function severity(kind: SituationKind, waitedMs: number): Severity {
  const x = waitedMs / THRESHOLDS[kind]
  return x >= 4 ? 'high' : x >= 2 ? 'medium' : 'low'
}

export function waited(ms: number): string {
  if (ms < 48 * HOUR) { const h = Math.max(1, Math.floor(ms / HOUR)); return `${h} hour${h === 1 ? '' : 's'}` }
  const d = Math.floor(ms / DAY)
  return `${d} days`
}

/**
 * The one-line why. `mailbox` is the mailbox address ONLY when the viewer may see it (mailView 'full'); the board
 * card is seen by everyone, so it is always written without one.
 */
export function whyLine(kind: SituationKind, waitedMs: number, mailbox: string | null = null): string {
  const w = waited(waitedMs)
  switch (kind) {
    case 'booking_link_not_booked': return `Booking link shared ${w} ago, no call booked`
    case 'inbound_no_reply': return `Emailed ${mailbox ?? 'one of our mailboxes'} ${w} ago, no reply`
    case 'text_no_reply': return `Texted us ${w} ago, no reply`
    case 'coursework_quiet': return `No lessons or practice for ${w}`
    case 'discovery_no_followup': return `Discovery call held ${w} ago, no follow-up since`
  }
}

/** The note added when a situation clears on its own. */
export const CLEARED: Record<SituationKind, string> = {
  booking_link_not_booked: 'they booked a call',
  inbound_no_reply: 'we replied',
  text_no_reply: 'we texted back',
  coursework_quiet: 'they came back to the coursework',
  discovery_no_followup: 'we followed up',
}
export const NO_LONGER = 'no longer waiting (record withdrawn, contact excluded, or outside the window)'

export const key = (contactId: string, kind: SituationKind, triggerId: string) => `${contactId}:${kind}:${triggerId}`.slice(0, 200)

/** Pure: which of the found situations to raise. Never one whose key was raised before, and one open per contact and kind. */
export function toRaise<T extends { contactId: string; kind: SituationKind; key: string }>(found: T[], knownKeys: Set<string>, openPairs: Set<string>, max = MAX_NEW_PER_RUN): T[] {
  const out: T[] = []
  const pairs = new Set(openPairs)
  for (const s of found) {
    if (knownKeys.has(s.key)) continue
    const pair = `${s.contactId}:${s.kind}`
    if (pairs.has(pair)) continue
    pairs.add(pair)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

// ── the daily fix suggestion ──────────────────────────────────────────────────────────────────────────────────
/** Automation first: one fixed suggestion per situation. No AI in Part 1. */
export const SUGGESTION: Record<SituationKind, string> = {
  booking_link_not_booked: 'turn on the Discovery booked reminder campaign, so a shared link gets a nudge at 48 hours',
  inbound_no_reply: 'route admin@ to a shared inbox with a 24 hour reply rule',
  text_no_reply: 'turn on a missed-text auto reply that says when we will answer, and add unanswered texts to the morning brief',
  coursework_quiet: 'turn on the coursework re-engagement campaign at 5 days quiet, before it reaches 7',
  discovery_no_followup: 'turn on the post-discovery follow-up campaign that sends the recap and booking link the same day',
}
export const DIGEST_MIN = 3
export const DIGEST_HOUR_ET = 8

/** The New York calendar day and hour of a time. */
export function nyDayHour(now: number): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
}

/** The digest is due on the first run at or after 8 AM ET on a day it has not been claimed. */
export function digestDue(now: number, claimedDays: string[]): string | null {
  const { day, hour } = nyDayHour(now)
  if (hour < DIGEST_HOUR_ET) return null
  return claimedDays.includes(day) ? null : day
}

/** The message, or null when no situation reached 3 in the last 7 days. */
export function digestText(counts: Partial<Record<SituationKind, number>>): string | null {
  const hot = SITUATIONS.filter((k) => (counts[k] ?? 0) >= DIGEST_MIN)
  if (!hot.length) return null
  const lines = hot.map((k) => `- ${PLAIN[k]}: ${counts[k]} in the last 7 days. Suggested fix: ${SUGGESTION[k]}.`)
  return ['Touchpoints: people left waiting on us this week', ...lines, 'The cards are in Follow-ups to review on the board.'].join('\n')
}
