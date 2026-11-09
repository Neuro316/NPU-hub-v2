// src/lib/briefs/match.ts
// Pure: which meeting attendees count, and whether a meeting title names a contact. No I/O, no imports.

/** Calendar resources (rooms, equipment) and group calendars are never people. */
export function isResourceAddress(email: string): boolean {
  const e = email.trim().toLowerCase()
  return e.endsWith('resource.calendar.google.com') || e.endsWith('@group.calendar.google.com')
}

/** The attendees worth looking up: lowercased, deduped, not the recipient's own addresses, not resources. */
export function externalAttendees(emails: string[], own: string[]): string[] {
  const mine = own.map((e) => e.trim().toLowerCase())
  const out: string[] = []
  for (const raw of emails) {
    const e = String(raw ?? '').trim().toLowerCase()
    if (!e || !e.includes('@') || mine.includes(e) || isResourceAddress(e) || out.includes(e)) continue
    out.push(e)
  }
  return out
}

const LETTER = 'A-Za-zÀ-ɏ'
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Collapse spacing and case for comparison. */
export function normName(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * True when the title contains the full name on word boundaries ("Call with Jane Doe" names "Jane Doe";
 * "Janet Doerr" does not). A name needs two parts of at least two letters each, so "Al" alone never matches.
 */
export function titleMentionsName(title: string | null | undefined, fullName: string | null | undefined): boolean {
  if (!title || !fullName) return false
  const name = normName(fullName)
  const parts = name.split(' ')
  if (parts.length < 2 || parts.some((p) => p.length < 2)) return false
  const re = new RegExp(`(^|[^${LETTER}0-9])${parts.map(escapeRe).join('\\s+')}($|[^${LETTER}0-9])`, 'i')
  return re.test(title)
}

const STOP = new Set([
  'and', 'the', 'for', 'with', 'call', 'meeting', 'meet', 'intro', 'introduction', 'discovery', 'session', 'sync', 'chat',
  'zoom', 'google', 'via', 'and', 'call', 'follow', 'up', 'followup', 'consult', 'consultation', 'review', 'check', 'in',
  'appointment', 'demo', 'onboarding', 'kickoff', 'catch', 'weekly', 'daily', 'monthly', 'team', 'neuro', 'progeny', 'npu',
  'program', 'mastermind', 'coaching', 'qa', 'q', 'a', 'of', 'to', 'on', 'at', 're', 'fw', 'fwd', 'call:', 'x',
])

/** Adjacent word pairs from a title that could be "First Last" (at most `max`). */
export function nameCandidates(title: string | null | undefined, max = 6): Array<[string, string]> {
  if (!title) return []
  const words = title.match(new RegExp(`[${LETTER}][${LETTER}'-]*`, 'g')) ?? []
  const out: Array<[string, string]> = []
  for (let i = 0; i + 1 < words.length && out.length < max; i++) {
    const a = words[i], b = words[i + 1]
    if (a.length < 2 || b.length < 2 || STOP.has(a.toLowerCase()) || STOP.has(b.toLowerCase())) continue
    out.push([a, b])
  }
  return out
}
