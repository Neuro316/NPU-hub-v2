// src/lib/marketing/links.ts
// Pure: the per-person and per-org links a campaign email can carry.
//
//   {{checkout_link}}          the University checkout page of the paywall this person most recently started checkout on
//   {{discovery_booking_url}}  org_settings 'discovery_booking_url' = { url }, so the booking link changes in one place
//
// Neither is ever guessed. A link that cannot be resolved means the step is skipped (logged), never sent with a
// fallback. No I/O here, so the harness and the tamper checks can pin every rule.

export const UNIVERSITY_ORIGIN = 'https://university.neuroprogeny.com'
export const CHECKOUT_TOKEN = '{{checkout_link}}'
export const BOOKING_TOKEN = '{{discovery_booking_url}}'
/** A seat hold counts as "this checkout" only when made at most this long before the person entered the campaign. */
export const HOLD_WINDOW_HOURS = 48

export interface EntryPaywalls { slugs: string[]; slugContains: string[] }

/** Pure: goal.entry_paywalls = { slugs: [...], slug_contains: [...] }. Missing or malformed means no limit. */
export function parseEntryPaywalls(goal: unknown): EntryPaywalls | null {
  const g = goal && typeof goal === 'object' ? (goal as Record<string, unknown>) : {}
  const e = g.entry_paywalls && typeof g.entry_paywalls === 'object' ? (g.entry_paywalls as Record<string, unknown>) : null
  if (!e) return null
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^[a-z0-9-]{1,80}$/.test(x)) : [])
  // a limit that is present but names nothing valid admits nobody: it never falls open
  return { slugs: list(e.slugs), slugContains: list(e.slug_contains) }
}

/** Pure: is this paywall one the campaign is for. With a limit present, an empty limit admits nothing. */
export function paywallEligible(slug: string, limit: EntryPaywalls | null): boolean {
  if (!limit) return true
  return limit.slugs.includes(slug) || limit.slugContains.some((part) => slug.includes(part))
}

/** Pure: the checkout page for a slug, or null for anything that is not a plain slug. */
export function checkoutUrl(slug: string | null | undefined): string | null {
  return typeof slug === 'string' && /^[a-z0-9-]{1,80}$/.test(slug) ? `${UNIVERSITY_ORIGIN}/checkout/${slug}` : null
}

/** Pure: org_settings 'discovery_booking_url' must be { url: 'https://...' }. Anything else is unset. */
export function parseBookingUrl(raw: unknown): string | null {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).url : null
  if (typeof v !== 'string' || v.length > 500) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && !/["'<>\s]/.test(v) ? v : null
  } catch { return null }
}

export interface Hold { cohort_id: string | null; created_at: string }
export interface PaywallRow { slug: string; cohort_id: string | null; is_active: boolean }

export type PaywallPick = { ok: true; slug: string } | { ok: false; reason: 'no_hold' | 'stale_hold' | 'ambiguous_paywall' | 'no_paywall' }

/**
 * Pure: the paywall of the person's most recent seat hold. The hold has to be made within HOLD_WINDOW_HOURS before
 * they entered the campaign (or after), and its cohort has to belong to exactly one active paywall. Two active
 * paywalls on one cohort cannot be told apart, so that is unresolved, never a pick.
 */
export function pickPaywall(holds: Hold[], paywalls: PaywallRow[], enrolledAt: string | null, now: Date): PaywallPick {
  const entry = enrolledAt ? Date.parse(enrolledAt) : NaN
  if (!holds.length) return { ok: false, reason: 'no_hold' }
  const latest = [...holds].filter((h) => !Number.isNaN(Date.parse(h.created_at)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]
  if (!latest) return { ok: false, reason: 'no_hold' }
  const at = Date.parse(latest.created_at)
  if (Number.isNaN(entry) || at < entry - HOLD_WINDOW_HOURS * 3600_000 || at > now.getTime()) return { ok: false, reason: 'stale_hold' }
  const matches = paywalls.filter((p) => p.is_active && !!latest.cohort_id && p.cohort_id === latest.cohort_id)
  if (matches.length > 1) return { ok: false, reason: 'ambiguous_paywall' }
  if (matches.length === 0 || !checkoutUrl(matches[0].slug)) return { ok: false, reason: 'no_paywall' }
  return { ok: true, slug: matches[0].slug }
}

export interface CheckoutEvent { event_target: string | null; created_at: string }

/**
 * Pure: the paywall named by the person's most recent University 'checkout_opened' event (activity_events, logged when
 * the Stripe session is created; event_target = paywall slug). Same window as a seat hold, and the slug has to be an
 * active paywall. null means "no usable event", and the caller falls back to the seat hold.
 */
export function pickCheckoutEvent(events: CheckoutEvent[], activeSlugs: string[], enrolledAt: string | null, now: Date): string | null {
  const entry = enrolledAt ? Date.parse(enrolledAt) : NaN
  const latest = events.filter((e) => !Number.isNaN(Date.parse(e.created_at)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]
  if (!latest || Number.isNaN(entry)) return null
  const at = Date.parse(latest.created_at)
  if (at < entry - HOLD_WINDOW_HOURS * 3600_000 || at > now.getTime()) return null
  const slug = latest.event_target
  return slug && checkoutUrl(slug) && activeSlugs.includes(slug) ? slug : null
}

/** Pure: does this subject or body use the token. */
export function usesToken(token: string, ...parts: Array<string | null | undefined>): boolean {
  return parts.some((p) => typeof p === 'string' && p.includes(token))
}

/** Pure: put resolved links in place. Values were validated above, and are HTML-escaped for an href. */
export function applyLinks(template: string, links: Partial<Record<string, string>>): string {
  let out = template
  for (const [token, url] of Object.entries(links)) {
    if (!url) continue
    out = out.split(token).join(url.replace(/&/g, '&amp;').replace(/"/g, '&quot;'))
  }
  return out
}
