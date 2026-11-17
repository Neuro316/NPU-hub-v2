// src/lib/contacts/search.ts
// The Contacts list search (Running List q30). Pure, no imports, so the harness (scripts/crm/contact-fixes-tamper.cjs)
// runs it directly.
//
// Two bugs made the search stop filtering after the first name:
//   1. Every keystroke started a request and every response was applied, in the order they ARRIVED. A slower,
//      older request (the first name, or a shorter prefix) could land after the newest one and overwrite it.
//      latestOnly() numbers each request; only the newest one's result is ever applied.
//   2. The typed text went into a PostgREST or() filter unescaped, so a comma, a parenthesis or a full name with a
//      space made the request fail or match nothing, and the list silently kept the previous results.
//      contactSearchFilter() strips the characters PostgREST treats as syntax and matches "first last" typed together.

/** Request sequencing: begin() for each request, isLatest(n) before applying its result. */
export function latestOnly(): { begin: () => number; isLatest: (n: number) => boolean } {
  let seq = 0
  return {
    begin: () => ++seq,
    isLatest: (n: number) => n === seq,
  }
}

const FIELDS = ['first_name', 'last_name', 'email', 'phone'] as const

/** The search text made safe for a PostgREST or() filter: no , ( ) * % \ or quotes, spaces collapsed, at most 80 chars. */
export function cleanSearch(q: unknown): string {
  return String(q ?? '').replace(/[,()*%\\"'`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/**
 * The or() filter for a search, or null for an empty search. One word matches any field; two or more words also
 * match first name and last name together ("Erika Smith"); "Last, First" with a comma also matches last name and
 * first name together ("Bauer, Heather"). The whole cleaned text still matches an email or a phone. The comma itself
 * never reaches the filter: each side is cleaned on its own.
 */
export function contactSearchFilter(q: unknown): string | null {
  const text = cleanSearch(q)
  if (!text) return null
  const parts = FIELDS.map((f) => `${f}.ilike.*${text}*`)
  const raw = String(q ?? '')
  const comma = raw.indexOf(',')
  if (comma > 0) {
    const last = cleanSearch(raw.slice(0, comma)), first = cleanSearch(raw.slice(comma + 1))
    if (last && first) parts.push(`and(last_name.ilike.*${last}*,first_name.ilike.*${first}*)`)
  }
  const words = text.split(' ')
  if (words.length >= 2) {
    const first = words[0], rest = words.slice(1).join(' ')
    parts.push(`and(first_name.ilike.*${first}*,last_name.ilike.*${rest}*)`)
  }
  return parts.join(',')
}
