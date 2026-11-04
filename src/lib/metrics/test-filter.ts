// src/lib/metrics/test-filter.ts
// THE shared test filter for the Growth Dashboard (docs/metrics/definitions.md §0). Every
// metric and every click-through list goes through it; nothing else decides what is test.
//
// A person is test when:
//   T1  email or phone (last 10 digits) is in campaign_test_contacts
//   T2  email is cameron.s.allen@gmail.com (always, even if the T3 row is removed)
//   T3  hub_metric_exclusions says 'exclude': by contact, profile, email or email pattern
//       (seeded: cameron.s.allen+%@gmail.com, cameron.s.allen@gmail.com, cameron@neuroprogeny.com)
//   T4  a contact tag matching "test"
// A test contact also makes the profile with the same email test, and the reverse.
// A purchase is test when the buyer is test (P1), it used promo CTEST or CTEST2 (P2), or
// its program is named "Test" (P3). Stripe test mode never reaches the tables (P4).
// 'keep' rows in hub_metric_exclusions only record a reviewed "not test" decision.
import type { SupabaseClient } from '@supabase/supabase-js'

export const ALWAYS_TEST_EMAILS = ['cameron.s.allen@gmail.com']
export const TEST_PROMO_CODES = ['CTEST', 'CTEST2']

const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '')
const digits10 = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '').slice(-10) : '')

/** A lower-case SQL LIKE pattern as a RegExp (% any run, _ one character). */
export function likeToRegExp(pattern: string): RegExp {
  const body = pattern.split('').map(c => (c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')
  return new RegExp(`^${body}$`)
}

export interface TestFilter {
  isTestEmail(email: unknown): boolean
  isTestContact(c: { id: string; email?: string | null; phone?: string | null; tags?: string[] | null }): boolean
  isTestProfile(id: string | null | undefined, email?: string | null): boolean
  isTestPromo(code: unknown): boolean
  isTestProgramName(name: unknown): boolean
  /** profile ids known to be test (for joins that only carry a profile id) */
  testProfileIds: Set<string>
  /** counts, for job_runs detail (no emails) */
  stats: { emails: number; patterns: number; contacts: number; profiles: number }
}

export async function loadTestFilter(db: SupabaseClient): Promise<TestFilter> {
  const [tc, ex] = await Promise.all([
    db.from('campaign_test_contacts').select('email, phone'),
    db.from('hub_metric_exclusions').select('kind, contact_id, profile_id, email, email_pattern').eq('decision', 'exclude'),
  ])
  if (tc.error || ex.error) throw new Error(`test filter read failed: ${tc.error?.code ?? ex.error?.code}`)

  const emails = new Set<string>(ALWAYS_TEST_EMAILS)
  const phones = new Set<string>()
  const patterns: RegExp[] = []
  const contactIds = new Set<string>()
  const profileIds = new Set<string>()
  for (const r of tc.data ?? []) {
    if (lower(r.email)) emails.add(lower(r.email))
    if (digits10(r.phone).length === 10) phones.add(digits10(r.phone))
  }
  for (const r of ex.data ?? []) {
    if (r.kind === 'email' && r.email) emails.add(lower(r.email))
    if (r.kind === 'email_pattern' && r.email_pattern) patterns.push(likeToRegExp(lower(r.email_pattern)))
    if (r.kind === 'contact' && r.contact_id) contactIds.add(r.contact_id)
    if (r.kind === 'profile' && r.profile_id) profileIds.add(r.profile_id)
  }

  // T4: contacts tagged test. Read page by page (tags is a text[]; the match is case-insensitive).
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('contacts').select('id, email, tags').not('tags', 'is', null).range(from, from + 999)
    if (error) throw new Error(`test filter tags read failed: ${error.code}`)
    for (const c of data ?? []) {
      if ((c.tags ?? []).some((t: string) => /\btest\b/i.test(String(t)))) {
        contactIds.add(c.id)
        if (lower(c.email)) emails.add(lower(c.email))
      }
    }
    if ((data ?? []).length < 1000) break
  }
  // excluded contacts carry their email over to profiles, and excluded profiles to contacts
  if (contactIds.size) {
    const { data } = await db.from('contacts').select('email').in('id', Array.from(contactIds))
    for (const c of data ?? []) if (lower(c.email)) emails.add(lower(c.email))
  }
  if (profileIds.size) {
    const { data } = await db.from('profiles').select('email').in('id', Array.from(profileIds))
    for (const p of data ?? []) if (lower(p.email)) emails.add(lower(p.email))
  }

  const isTestEmail = (email: unknown) => {
    const e = lower(email)
    return !!e && (emails.has(e) || patterns.some(p => p.test(e)))
  }

  // every profile whose email is test
  const testProfileIds = new Set<string>(profileIds)
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('profiles').select('id, email').range(from, from + 999)
    if (error) throw new Error(`test filter profiles read failed: ${error.code}`)
    for (const p of data ?? []) if (isTestEmail(p.email)) testProfileIds.add(p.id)
    if ((data ?? []).length < 1000) break
  }

  return {
    isTestEmail,
    isTestContact: c => contactIds.has(c.id) || isTestEmail(c.email) || (digits10(c.phone).length === 10 && phones.has(digits10(c.phone)))
      || (c.tags ?? []).some(t => /\btest\b/i.test(String(t))),
    isTestProfile: (id, email) => (!!id && testProfileIds.has(id)) || isTestEmail(email),
    isTestPromo: code => TEST_PROMO_CODES.includes(String(code ?? '').trim().toUpperCase()),
    isTestProgramName: name => /\btest\b/i.test(String(name ?? '')),
    testProfileIds,
    stats: { emails: emails.size, patterns: patterns.length, contacts: contactIds.size, profiles: testProfileIds.size },
  }
}
