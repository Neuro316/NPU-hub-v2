// src/lib/resolve/check.ts
// THE "No reply needed" check (src/lib/resolve/rules.ts writes the rows). Read by exactly one place in each monitor:
// the text alert (src/lib/touchpoints/text-alerts.ts), the touchpoint raise and digest (src/lib/touchpoints/run.ts) and
// speed to lead (resolvedLeads in src/lib/touch/first-touch.ts: the tiles, the brief and lead_no_touch_24h). Keyed on
// the contact, never the login. Its only monitor import (the board column helper, for a reopen) is read at call time.
import type { SupabaseClient } from '@supabase/supabase-js'
import { REVIEW_COLUMN, TABLE as SITUATIONS, columnId } from '@/lib/touchpoints/run'

export const RESOLUTIONS = 'hub_contact_resolutions'
export const SCOPES = ['text_waiting', 'touchpoint', 'speed_to_lead', 'all'] as const
export type Scope = (typeof SCOPES)[number]
export const REASONS = ['conversation_ended', 'not_a_lead', 'former_client', 'handled_elsewhere', 'spam'] as const
export type Reason = (typeof REASONS)[number]
/** The five reason chips, as shown on the button and in the timeline. */
export const REASON_TEXT: Record<Reason, string> = {
  conversation_ended: 'Conversation ended', not_a_lead: 'Not a lead', former_client: 'Former client', handled_elsewhere: 'Handled elsewhere', spam: 'Spam',
}
const iso = (t: number) => new Date(t).toISOString()

// ── what a resolve cleared, so a reopen can put it back (no schema change: it rides in cleared_reason) ────────────
export const RESOLVED_PREFIX = 'no reply needed:'
/** cleared_reason of a situation a resolve cleared: 'no reply needed:<resolution id>:<reason text>, by <name>'. */
export const resolvedClearReason = (resolutionId: string, reasonText: string, byName: string) => `${RESOLVED_PREFIX}${resolutionId}:${reasonText}, by ${byName}`.slice(0, 200)
export const isResolvedClear = (reason: unknown) => typeof reason === 'string' && reason.startsWith(RESOLVED_PREFIX)
/** The part a person reads ("Not a lead, by Cameron Allen"), without the id. */
export const resolvedClearText = (reason: string) => reason.slice(RESOLVED_PREFIX.length).replace(/^[0-9a-f-]{36}:/i, '')

/** Pure: whether a live row of `rowScope` keeps the contact quiet for a monitor asking about `scope`. */
export const covers = (rowScope: string, scope: Scope) => rowScope === 'all' || rowScope === scope

/** Something new from the contact since `since`: an inbound text, an inbound call, or an email from their address. */
async function inboundSince(db: SupabaseClient, contactId: string, since: string): Promise<boolean> {
  const { data: convs } = await db.from('conversations').select('id').eq('contact_id', contactId)
  const ids = ((convs ?? []) as any[]).map((c) => c.id)
  if (ids.length) {
    const { data: t } = await db.from('crm_messages').select('id').in('conversation_id', ids).eq('direction', 'inbound').gt('created_at', since).limit(1)
    if ((t ?? []).length) return true
  }
  const { data: k } = await db.from('call_logs').select('id').eq('contact_id', contactId).eq('direction', 'inbound').gt('created_at', since).limit(1)
  if ((k ?? []).length) return true
  const { data: c } = await db.from('contacts').select('email').eq('id', contactId).maybeSingle()
  const email = String((c as any)?.email ?? '').trim().toLowerCase()
  if (email.includes('@')) {
    const { data: m } = await db.from('hub_mail_messages').select('id').ilike('from_address', email.replace(/[\\%_]/g, (x) => '\\' + x)).gt('received_at', since).limit(1)
    if ((m ?? []).length) return true
  }
  return false
}

/**
 * THE check: of these contacts, the ones resolved for `scope` right now (a live row of that scope or 'all'). A row whose
 * contact has sent something new since resolved_at is reopened here ('new_inbound') and does not count. Before hub_250
 * nothing is resolved.
 */
export async function liveResolutions(db: SupabaseClient, contactIds: string[], scope: Scope, now = Date.now()): Promise<Set<string>> {
  const ids = Array.from(new Set(contactIds.filter((id) => typeof id === 'string' && id)))
  const out = new Set<string>()
  if (!ids.length) return out
  const { data, error } = await db.from(RESOLUTIONS).select('id, org_id, contact_id, scope, resolved_at').in('contact_id', ids).is('reopened_at', null)
  if (error) return out
  for (const r of ((data ?? []) as any[]).filter((x) => covers(x.scope, scope))) {
    if (await inboundSince(db, r.contact_id, r.resolved_at)) {
      await reopenRow(db, r, 'new_inbound', { id: null, name: 'A new message from the contact' }, now)
      continue
    }
    out.add(r.contact_id)
  }
  return out
}


/**
 * Reopens one live resolution, by hand ('manual') or on a new inbound ('new_inbound'), and undoes what its resolve
 * cleared: every situation row whose cleared_reason carries this resolution's id (the touchpoint cards and the
 * text_waiting_1h row alike) is open again, and its board card moves from Done back to Follow-ups to review. One
 * contact_reopened timeline entry says who, when and why. Speed to lead has nothing to put back: lead_no_touch_24h
 * opens again only when the lifecycle scan raises it. False when the row was not live.
 */
export async function reopenRow(db: SupabaseClient, row: { id: string; org_id: string; contact_id: string; scope: string }, why: 'manual' | 'new_inbound',
  by: { id: string | null; name: string }, now = Date.now()): Promise<boolean> {
  const { data: flipped } = await db.from(RESOLUTIONS).update({ reopened_at: iso(now), reopened_reason: why }).eq('id', row.id).is('reopened_at', null).select('id')
  if (!(flipped ?? []).length) return false
  const restored = await restoreCleared(db, row, now)
  const { error } = await db.from('contact_timeline').insert({
    org_id: row.org_id, contact_id: row.contact_id, event_type: 'contact_reopened', title: 'Waiting on us again',
    description: why === 'manual' ? `${by.name} reopened No reply needed.` : 'The contact sent something new, so No reply needed was lifted.',
    metadata: { resolution_id: row.id, scope: row.scope, reason: why, by: by.id, by_name: by.name, restored },
    source_table: RESOLUTIONS, source_id: row.id, actor_type: by.id ? 'user' : 'system', actor_id: by.id, occurred_at: iso(now),
  })
  if (error) console.error(`[resolve] reopen timeline failed: ${error.code ?? 'unknown'}`)
  return true
}

/** The situations this resolution cleared, opened again; their cards back in Follow-ups to review. Returns how many. */
async function restoreCleared(db: SupabaseClient, row: { id: string; org_id: string; contact_id: string }, now: number): Promise<number> {
  const { data } = await db.from(SITUATIONS).select('id, task_id, cleared_reason').eq('org_id', row.org_id).eq('contact_id', row.contact_id).not('cleared_at', 'is', null)
  const mine = ((data ?? []) as any[]).filter((s) => isResolvedClear(s.cleared_reason) && String(s.cleared_reason).startsWith(`${RESOLVED_PREFIX}${row.id}:`))
  if (!mine.length) return 0
  const review = await columnId(db, row.org_id, REVIEW_COLUMN)
  let n = 0
  for (const s of mine) {
    const { error } = await db.from(SITUATIONS).update({ cleared_at: null, cleared_reason: null, updated_at: iso(now) }).eq('id', s.id)
    // one open per contact and kind: a newer open row of the same kind keeps its place, this one stays cleared
    if (error) { console.error(`[resolve] restore skipped: ${error.code ?? 'unknown'}`); continue }
    n++
    if (!s.task_id) continue
    const { data: card } = await db.from('kanban_tasks').select('id, description').eq('id', s.task_id).maybeSingle()
    if (!card) continue
    const patch: Record<string, unknown> = { completed_at: null, updated_at: iso(now), description: `${(card as any).description ?? ''}\n\nReopened: waiting on us again.`.trim() }
    if (review) patch.column_id = review
    await db.from('kanban_tasks').update(patch).eq('id', s.task_id)
  }
  return n
}
