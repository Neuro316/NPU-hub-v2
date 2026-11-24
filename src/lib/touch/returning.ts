// src/lib/touch/returning.ts
// q44: a speed to lead alert, task or tile row for someone who has bought before or finished a program carries a
// 'returning' chip. Flagged, never hidden. Reads only.
//   bought     a 'purchase' event in the lifecycle ledger (hub_lifecycle_events, any mode: it records a real purchase)
//   finished   a pipeline position at a Completed, Graduated or Alumni stage
import type { SupabaseClient } from '@supabase/supabase-js'

export const RETURNING_CHIP = 'returning'
export const FINISHED_STAGE = /\b(complet\w*|graduat\w*|alumni)\b/i

/** Of these contacts, the ones with a past purchase or a finished program. Read errors leave a contact unflagged. */
export async function returningContacts(db: SupabaseClient, contactIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(contactIds.filter(Boolean)))
  const out = new Set<string>()
  if (!ids.length) return out
  const { data: buys } = await db.from('hub_lifecycle_events').select('contact_id').in('contact_id', ids).eq('event_type', 'purchase').limit(1000)
  for (const b of (buys ?? []) as any[]) if (b.contact_id) out.add(b.contact_id)
  const { data: pos } = await db.from('contact_pipeline_positions').select('contact_id, stage_id').in('contact_id', ids)
  const stageIds = Array.from(new Set(((pos ?? []) as any[]).map((p) => p.stage_id).filter(Boolean)))
  if (stageIds.length) {
    const { data: stages } = await db.from('pipeline_stages').select('id, name').in('id', stageIds)
    const finished = new Set(((stages ?? []) as any[]).filter((s) => FINISHED_STAGE.test(String(s.name ?? ''))).map((s) => s.id))
    for (const p of (pos ?? []) as any[]) if (finished.has(p.stage_id)) out.add(p.contact_id)
  }
  return out
}
