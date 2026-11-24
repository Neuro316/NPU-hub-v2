// src/lib/contacts/same-person.ts
// THE duplicate rule: contacts sharing a normalised email (the email, or any custom_fields.alt_emails address) or the
// last 10 digits of a phone are one person, transitively (union-find). One definition, used by:
//   - the touchpoint monitor and the unanswered text alert (eligibleContacts in src/lib/touchpoints/run.ts: one card per
//     person, on the contact with the most recent activity)
//   - No reply needed (src/lib/resolve): a resolve covers every card of the person, the check asks the whole group, and a
//     reopen reopens the whole group
// Seen on production 2026-11-24: 'Unknown +18284215174' and 'David Rusch' are two cards for one number. The thread and
// the resolve sat on one, the monitor keyed on the other and posted the person again.
import type { SupabaseClient } from '@supabase/supabase-js'

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase()
export const last10 = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
export const altEmails = (cf: unknown) => {
  const v = cf && typeof cf === 'object' ? (cf as Record<string, unknown>).alt_emails : null
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(lower).filter((x) => x.includes('@')) : []
}

export interface PersonFields { id: string; email?: string | null; phone?: string | null; custom_fields?: unknown }

/** Pure: the keys that make two contacts one person ('e:<email>' for each address, 'p:<last 10 digits>'). */
export function personKeys(c: PersonFields): string[] {
  const mails = Array.from(new Set([lower(c.email), ...altEmails(c.custom_fields)].filter((e) => e.includes('@'))))
  const p = last10(c.phone)
  return [...mails.map((e) => `e:${e}`), ...(p ? [`p:${p}`] : [])]
}

/** Pure: the contacts grouped into people. Every contact is in exactly one group (a group of one when it has no duplicate). */
export function groupPeople<T extends PersonFields>(list: T[]): T[][] {
  const parent = new Map<string, string>(list.map((c) => [c.id, c.id]))
  const root = (x: string): string => { while (parent.get(x) !== x) x = parent.get(x)!; return x }
  const owner = new Map<string, string>()
  for (const c of list) {
    for (const k of personKeys(c)) {
      const o = owner.get(k)
      if (o) { const a = root(c.id), b = root(o); if (a !== b) parent.set(a, b) } else owner.set(k, c.id)
    }
  }
  const groups = new Map<string, T[]>()
  for (const c of list) groups.set(root(c.id), [...(groups.get(root(c.id)) ?? []), c])
  return Array.from(groups.values())
}

/** contact id -> every contact id of the same person (itself included). */
export type SamePerson = Map<string, string[]>

/** Pure: the lookup for a set of groups. */
export function samePersonMap(groups: PersonFields[][]): SamePerson {
  const out: SamePerson = new Map()
  for (const g of groups) { const ids = g.map((c) => c.id); for (const id of ids) out.set(id, ids) }
  return out
}

/** Pure: the cards of this contact's person (just itself when it has no duplicate, or is unknown to the map). */
export const cardsOf = (m: SamePerson, id: string): string[] => m.get(id) ?? [id]

/**
 * The people of these orgs, from every live contact (not merged, not archived), read a page at a time. The monitors
 * build theirs from the contacts they already read (groupPeople); resolve reads it here.
 */
export async function loadSamePerson(db: SupabaseClient, orgIds: string[]): Promise<SamePerson> {
  const groups: PersonFields[][] = []
  for (const orgId of Array.from(new Set(orgIds.filter(Boolean)))) {
    const list: PersonFields[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await (db.from('contacts').select('id, email, phone, custom_fields') as any)
        .eq('org_id', orgId).is('merged_into_id', null).is('archived_at', null).order('id').range(from, from + 999)
      if (error) throw new Error(`contacts read: ${error.code ?? 'unknown'}`)
      list.push(...((data ?? []) as PersonFields[]))
      if ((data ?? []).length < 1000) break
    }
    groups.push(...groupPeople(list))
  }
  return samePersonMap(groups)
}
