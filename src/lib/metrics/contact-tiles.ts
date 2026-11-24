// src/lib/metrics/contact-tiles.ts
// Contact count tiles on the CRM Dashboard and CRM Analytics.
//
// A count is a count query ({ count: 'exact', head: true }), never rows.length: PostgREST returns at most 1,000 rows
// per request, so a row fetch counted 1,000 once the org passed that (the 3,910-contact Sensorium import).
// Tiles that need each contact's fields (new this week, this month, stale, never contacted) read every page.
//
// Activity tiles: an imported contact (isImportedLead, the one rule) counts in Total Contacts, but is left out of
// New This Week, +this month and Stale / never contacted until its first touch (last_contacted_at, which every
// logged call, text and email sets).
import type { SupabaseClient } from '@supabase/supabase-js'
import { isImportedLead } from './imported'

const PAGE = 1000
const DAY = 86400000

/** Live contacts in the org matching an optional extra filter, counted by the database. */
export async function countContacts(db: SupabaseClient, orgId: string, where?: (q: any) => any): Promise<number> {
  let q: any = db.from('contacts').select('id', { count: 'exact', head: true })
    .eq('org_id', orgId).is('merged_into_id', null).is('archived_at', null)
  if (where) q = where(q)
  const { count, error } = await q
  if (error) throw new Error(`contacts count: ${error.code ?? 'unknown'}`)
  return count ?? 0
}

/** Every live contact in the org, the given columns only, read a page at a time (no 1,000-row cap). */
export async function loadContactRows<T = any>(db: SupabaseClient, orgId: string, columns: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (db.from('contacts').select(columns) as any)
      .eq('org_id', orgId).is('merged_into_id', null).is('archived_at', null)
      .order('id').range(from, from + PAGE - 1)
    if (error) throw new Error(`contacts read: ${error.code ?? 'unknown'}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

export interface TileContact {
  id: string
  created_at: string | null
  last_contacted_at?: string | null
  source?: string | null
  import_batch_id?: string | null
}

/** In the activity tiles: every contact except an imported one with no first touch yet. */
export const inActivityTiles = (c: TileContact): boolean => !isImportedLead(c) || !!c.last_contacted_at

export interface ActivityTiles { newThisWeek: number; thisMonth: number; lastMonth: number; stale14d: number; neverContacted: number }

/** New this week, this month, last month, stale 14 days and never contacted; isOpen says a contact has an open position. */
export function activityTiles(rows: TileContact[], now: number, isOpen: (c: TileContact) => boolean): ActivityTiles {
  const t = { newThisWeek: 0, thisMonth: 0, lastMonth: 0, stale14d: 0, neverContacted: 0 }
  for (const c of rows) {
    if (!inActivityTiles(c)) continue
    const age = c.created_at ? now - new Date(c.created_at).getTime() : Infinity
    if (age < 7 * DAY) t.newThisWeek++
    if (age < 30 * DAY) t.thisMonth++
    else if (age < 60 * DAY) t.lastMonth++
    if (!isOpen(c)) continue
    if (!c.last_contacted_at) t.neverContacted++
    else if (now - new Date(c.last_contacted_at).getTime() > 14 * DAY) t.stale14d++
  }
  return t
}
