// src/lib/marketing/checkout-link.ts
// Read-only: which paywall did this person most recently start checkout on.
//
// First choice: the University's 'checkout_opened' activity_events row (event_target = paywall slug), logged when the
// Stripe session is created. Fallback: the seat hold (seat_reservations: the profile and the cohort) and the paywall
// that owns that cohort. University tables are read here and never written. A person with neither is unresolved, and
// the caller skips the step rather than guess.
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseBookingUrl, pickCheckoutEvent, pickPaywall, type PaywallPick } from './links'

export async function resolveCheckoutPaywall(db: SupabaseClient, email: string | null | undefined, enrolledAt: string | null, now: Date): Promise<PaywallPick | { ok: false; reason: 'no_email' | 'no_profile' }> {
  const addr = (email ?? '').trim().toLowerCase()
  if (!addr) return { ok: false, reason: 'no_email' }
  const { data: profs, error: pErr } = await db.from('profiles').select('id').ilike('email', addr).limit(5)
  if (pErr) throw new Error(`checkout link profile read: ${pErr.code ?? 'unknown'}`)
  const ids = (profs ?? []).map((p: any) => p.id as string)
  if (!ids.length) return { ok: false, reason: 'no_profile' }
  const { data: events, error: eErr } = await db.from('activity_events').select('event_target, created_at')
    .in('user_id', ids).eq('event_type', 'checkout_opened').order('created_at', { ascending: false }).limit(5)
  if (eErr) throw new Error(`checkout link event read: ${eErr.code ?? 'unknown'}`)
  const named = Array.from(new Set((events ?? []).map((e: any) => e.event_target).filter((x: unknown): x is string => typeof x === 'string')))
  if (named.length) {
    const { data: act, error: aErr } = await db.from('paywalls').select('slug').in('slug', named).eq('is_active', true)
    if (aErr) throw new Error(`checkout link paywall read: ${aErr.code ?? 'unknown'}`)
    const slug = pickCheckoutEvent((events ?? []) as any, (act ?? []).map((p: any) => p.slug as string), enrolledAt, now)
    if (slug) return { ok: true, slug }
  }
  const { data: holds, error: hErr } = await db.from('seat_reservations').select('cohort_id, created_at')
    .in('user_id', ids).order('created_at', { ascending: false }).limit(5)
  if (hErr) throw new Error(`checkout link hold read: ${hErr.code ?? 'unknown'}`)
  const cohorts = Array.from(new Set((holds ?? []).map((h: any) => h.cohort_id).filter(Boolean)))
  let paywalls: any[] = []
  if (cohorts.length) {
    const { data, error } = await db.from('paywalls').select('slug, cohort_id, is_active').in('cohort_id', cohorts)
    if (error) throw new Error(`checkout link paywall read: ${error.code ?? 'unknown'}`)
    paywalls = data ?? []
  }
  return pickPaywall((holds ?? []) as any, paywalls, enrolledAt, now)
}

/** org_settings 'discovery_booking_url' = { url }. Unset or invalid is null; a read error throws so the step is retried. */
export async function discoveryBookingUrl(db: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await db.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', 'discovery_booking_url').maybeSingle()
  if (error) throw new Error(`booking url read: ${error.code ?? 'unknown'}`)
  return parseBookingUrl((data as any)?.setting_value)
}
