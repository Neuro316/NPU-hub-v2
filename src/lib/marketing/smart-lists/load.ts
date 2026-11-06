// src/lib/marketing/smart-lists/load.ts
// Reads every live contact's facts for an org. Paged, because the API caps a response and a
// silently short read would make a list look smaller than it is. A failed read throws: callers
// answer with an error rather than an empty list.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContactFacts } from './match'

const PAGE = 1000

export async function loadFacts(db: SupabaseClient, orgId: string): Promise<ContactFacts[]> {
  const all: ContactFacts[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.rpc('hub_contact_facts', { p_org: orgId }).order('contact_id').range(from, from + PAGE - 1)
    if (error) throw new Error(`hub_contact_facts failed: ${error.code ?? 'unknown'}`)
    const rows = (data ?? []) as ContactFacts[]
    all.push(...rows)
    if (rows.length < PAGE) return all
  }
}
