// src/lib/marketing/entry-events.ts
// Raising entry events from app code (calls, imports) and the capping rule shared by
// every source. Stage and tag events are raised by database triggers (hub_212); all of
// them land in entry_events and are processed by /api/cron/entry-events through the
// existing public.route_and_enroll. Nothing here sends a message or touches consent.
import type { SupabaseClient } from '@supabase/supabase-js'

/** At most this many queued events become enrollments per cron run (every five minutes). */
export const ENTRY_CAP_PER_RUN = 100
export const ENTRY_RUN_MINUTES = 5
/** One import-enroll request may queue at most this many contacts. */
export const IMPORT_ENROLL_MAX = 1000

export type EntryOrigin = 'stage' | 'tag' | 'contact_tag' | 'call' | 'import'

/** True when the event was queued; false when the engine is off, nothing listens, or it was already queued. */
export async function raiseEntryEvent(db: SupabaseClient, e: { orgId: string; contactId: string; sourceKey: string; eventId: string; origin: EntryOrigin }): Promise<boolean> {
  const { data, error } = await db.rpc('raise_entry_event', {
    p_org: e.orgId, p_contact: e.contactId, p_source_key: e.sourceKey, p_event_id: e.eventId, p_origin: e.origin,
  })
  if (error) { console.error(`[entry-events] raise ${e.origin} failed: ${error.code ?? 'unknown'}`); return false }
  return data === true
}

/** Pure: the message a person sees when more contacts move at once than one run takes in. */
export function entryCapNote(count: number): string | null {
  if (count <= ENTRY_CAP_PER_RUN) return null
  const runs = Math.ceil(count / ENTRY_CAP_PER_RUN)
  return `${count} contacts moved. Campaigns take in ${ENTRY_CAP_PER_RUN} people every ${ENTRY_RUN_MINUTES} minutes, so everyone this starts a campaign for is entered within about ${runs * ENTRY_RUN_MINUTES} minutes. Nothing is sent that the send checks would refuse.`
}

/**
 * Open a guard window: entry events raised for these contacts while it is open are
 * skipped, never enrolled. Used by contact merges and by imports that update existing
 * contacts, so neither can start a campaign. Service role only. Returns false on failure,
 * and callers that must not enroll then stop rather than carry on unguarded.
 */
export async function guardContacts(db: SupabaseClient, orgId: string, contactIds: string[], reason: 'contact_merge' | 'import_merge', minutes = 30): Promise<boolean> {
  if (!contactIds.length) return true
  const { error } = await db.rpc('guard_entry_events', { p_org: orgId, p_contacts: contactIds, p_reason: reason, p_minutes: minutes })
  if (error) { console.error(`[entry-events] guard ${reason} failed: ${error.code ?? 'unknown'}`); return false }
  return true
}

/** Close a guard window early, once the guarded writes are done. */
export async function releaseGuard(db: SupabaseClient, contactIds: string[], reason: 'contact_merge' | 'import_merge'): Promise<void> {
  if (!contactIds.length) return
  const { error } = await db.from('entry_event_guards').update({ ends_at: new Date().toISOString() })
    .in('contact_id', contactIds).eq('reason', reason).gt('ends_at', new Date().toISOString())
  if (error) console.error(`[entry-events] release ${reason} failed: ${error.code ?? 'unknown'}`)
}

/**
 * After a bulk stage move: one summary row in job_runs, and the cap note when more
 * campaign entries were queued than one run takes in. The count is the stage events
 * queued for this org since the move started, so a stage move by someone else in the
 * same second would be counted too; it is a summary, not a ledger.
 */
export async function summariseBulkStageMove(db: SupabaseClient, orgId: string, sinceIso: string, moved: number, actor: string): Promise<{ queued: number; note: string | null }> {
  const { withJobRun } = await import('./job-runs')
  try {
    const r = await withJobRun(db, 'bulk-stage-move', async () => {
      const { count, error } = await db.from('entry_events').select('id', { count: 'exact', head: true })
        .eq('org_id', orgId).eq('origin', 'stage').gte('created_at', sinceIso)
      if (error) throw new Error(`count failed: ${error.code ?? 'unknown'}`)
      const queued = count ?? 0
      return { rows: queued, detail: { summary: `bulk stage move by ${actor}: ${moved} contacts moved, ${queued} campaign entries queued (cap ${ENTRY_CAP_PER_RUN} per run)`, moved, queued } }
    })
    const queued = Number(r.detail?.queued ?? 0)
    return { queued, note: entryCapNote(queued) }
  } catch {
    return { queued: 0, note: null }
  }
}
