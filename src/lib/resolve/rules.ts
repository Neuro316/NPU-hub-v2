// src/lib/resolve/rules.ts
// "No reply needed" (Resolve): ONE action shared by every place the Hub says a person is waiting on us. Server only
// (service role). Keyed on the CONTACT, never on the login: Cameron and Shane work the same contacts, so a resolve by
// either is a resolve for both (hub_contact_resolutions, hub_250).
//
//   scope          what the resolve clears and keeps quiet
//     text_waiting   the open text_waiting_1h situation (the #np-follow-ups text alert)
//     touchpoint     every open q35 touchpoint situation, its board card moved to Done with the reason
//     speed_to_lead  the lead needs no reply: dropped from the speed to lead tiles, the brief's new leads line and the
//                    lead_no_touch_24h event, and its open lead_no_touch_24h task closed
//     all            all three
//   resolveContact writes the row, clears for its scope in the same call, and writes ONE contact_timeline entry
//   (event_type contact_resolved: who, scope, the reason chip text, the note), which is how both accounts see it.
//   liveResolutions is the ONE check the monitors call (text-alerts.ts, touchpoints/run.ts, src/lib/touch): a resolve
//   holds until the contact sends something new (a text, a call or an email after resolved_at); that new inbound sets
//   reopened_at with reopened_reason 'new_inbound', and the monitors raise again as normal. Reopen (manual) does the same
//   with 'manual'. Nothing is deleted or archived, and nothing on the contact changes.
// Until hub_250 is applied the table is missing: nothing is resolved and resolveContact answers 503.
import type { SupabaseClient } from '@supabase/supabase-js'
import { closeTasks } from '@/lib/lifecycle/ledger'
import { SITUATIONS } from '@/lib/touchpoints/rules'
import { clearSituation, columnId, TABLE as SITUATIONS_TABLE } from '@/lib/touchpoints/run'
import { TEXT_WAIT_KIND } from '@/lib/touchpoints/text-alerts'

import { REASONS, REASON_TEXT, RESOLUTIONS, SCOPES, covers, liveResolutions, reopenRow, resolvedClearReason, type Reason, type Scope } from './check'
import { viewOf, type LiveResolution } from './view'
export { REASONS, REASON_TEXT, RESOLUTIONS, SCOPES, covers, liveResolutions, type Reason, type Scope }
export const SCOPE_TEXT: Record<Scope, string> = {
  text_waiting: 'the unanswered text alert', touchpoint: 'the follow-up cards', speed_to_lead: 'speed to lead', all: 'everything that says they are waiting',
}
export const NOTE_MAX = 200
const MISSING = ['42P01', 'PGRST205']
const iso = (t: number) => new Date(t).toISOString()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Pure: the note, one line, at most NOTE_MAX characters; null when empty; undefined when it is not acceptable. */
export function cleanNote(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw !== 'string' || /[\r\n]/.test(raw)) return undefined
  const t = raw.trim()
  if (t.length > NOTE_MAX) return undefined
  return t || null
}

export interface ResolveInput { orgId: string; contactId: string; scope: Scope; reason: Reason; note: string | null; byUserId: string; now?: number }
export interface Result { status: number; body: Record<string, unknown> }

async function staffName(db: SupabaseClient, orgId: string, userId: string): Promise<string> {
  const { data } = await db.from('team_profiles').select('display_name').eq('org_id', orgId).eq('user_id', userId).maybeSingle()
  const n = String((data as any)?.display_name ?? '').trim()
  if (n) return n
  const { data: p } = await db.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  return String((p as any)?.full_name ?? '').trim() || 'A teammate'
}

/** text_waiting: the open text_waiting_1h situation is cleared (the next alert run lists nothing for them). */
async function clearText(db: SupabaseClient, orgId: string, contactId: string, why: string, now: number): Promise<number> {
  const { data, error } = await db.from(SITUATIONS_TABLE).update({ cleared_at: iso(now), cleared_reason: why.slice(0, 200), updated_at: iso(now) })
    .eq('org_id', orgId).eq('contact_id', contactId).eq('kind', TEXT_WAIT_KIND).is('cleared_at', null).select('id')
  if (error) throw new Error(`text situation clear: ${error.code ?? 'unknown'}`)
  return (data ?? []).length
}

/** touchpoint: every open q35 situation is cleared and its board card moved to Done with the reason. */
async function clearTouchpoints(db: SupabaseClient, orgId: string, contactId: string, why: string, now: number): Promise<number> {
  const { data, error } = await db.from(SITUATIONS_TABLE).select('id, task_id').eq('org_id', orgId).eq('contact_id', contactId)
    .in('kind', SITUATIONS as unknown as string[]).is('cleared_at', null)
  if (error) throw new Error(`situations read: ${error.code ?? 'unknown'}`)
  const rows = (data ?? []) as any[]
  if (!rows.length) return 0
  const [doneCol, trashCol] = await Promise.all([columnId(db, orgId, 'Done'), columnId(db, orgId, 'Trash')])
  for (const r of rows) await clearSituation(db, now, r, why, doneCol, trashCol)
  return rows.length
}

/** speed_to_lead: the open lead_no_touch_24h task (and its board card) is closed; the readers skip the lead from now on. */
async function clearSpeedToLead(db: SupabaseClient, orgId: string, contactId: string): Promise<number> {
  return closeTasks(db, orgId, contactId, ['lead_no_touch_24h'])
}

/** Resolve: the row, the clears for its scope, and one timeline entry, in one call. */
export async function resolveContact(db: SupabaseClient, input: ResolveInput): Promise<Result> {
  const now = input.now ?? Date.now()
  const { orgId, contactId, scope, reason, byUserId } = input
  if (!UUID.test(contactId) || !SCOPES.includes(scope) || !REASONS.includes(reason)) return { status: 400, body: { error: 'Choose a reason.' } }
  const note = cleanNote(input.note)
  if (note === undefined) return { status: 400, body: { error: `The note must be one line, under ${NOTE_MAX + 1} characters.` } }
  const { data: c } = await db.from('contacts').select('id, org_id').eq('id', contactId).maybeSingle()
  if (!c || (c as any).org_id !== orgId) return { status: 404, body: { error: 'Contact not found.' } }

  const { data: row, error } = await db.from(RESOLUTIONS).insert({ org_id: orgId, contact_id: contactId, scope, reason, note, resolved_by: byUserId, resolved_at: iso(now) })
    .select('id, scope, reason, note, resolved_by, resolved_at').single()
  if (error && MISSING.includes(error.code ?? '')) return { status: 503, body: { error: 'No reply needed switches on once the hub_250 migration is applied.' } }
  if (error?.code === '23505') return { status: 409, body: { error: 'This is already marked No reply needed.' } }
  if (error || !row) throw new Error(`resolution write: ${error?.code ?? 'unknown'}`)

  const name = await staffName(db, orgId, byUserId)
  // what it clears is marked with this resolution's id, so Reopen can put it back
  const why = resolvedClearReason((row as any).id, REASON_TEXT[reason], name)
  const cleared: Record<string, number> = {}
  if (scope === 'text_waiting' || scope === 'all') cleared.text_waiting = await clearText(db, orgId, contactId, why, now)
  if (scope === 'touchpoint' || scope === 'all') cleared.touchpoint = await clearTouchpoints(db, orgId, contactId, why, now)
  if (scope === 'speed_to_lead' || scope === 'all') cleared.speed_to_lead = await clearSpeedToLead(db, orgId, contactId)

  const { error: tErr } = await db.from('contact_timeline').insert({
    org_id: orgId, contact_id: contactId, event_type: 'contact_resolved', title: `No reply needed: ${REASON_TEXT[reason]}`,
    description: `${name} marked this contact No reply needed for ${SCOPE_TEXT[scope]}.${note ? ` Note: ${note}` : ''}`,
    metadata: { resolution_id: (row as any).id, scope, reason, reason_text: REASON_TEXT[reason], note, by: byUserId, by_name: name },
    source_table: RESOLUTIONS, source_id: (row as any).id, actor_type: 'user', actor_id: byUserId, occurred_at: iso(now),
  })
  if (tErr) console.error(`[resolve] timeline failed: ${tErr.code ?? 'unknown'}`)
  // the new row in the same shape GET returns, so the button shows it at once without reading again
  return { status: 200, body: { resolution: viewOf(row as any, name), cleared } }
}

/** Reopen by hand: the live row gets reopened_at and reopened_reason 'manual'; the monitors raise again as normal. */
export async function reopenResolution(db: SupabaseClient, orgId: string, id: string, byUserId: string, now = Date.now()): Promise<Result> {
  if (!UUID.test(id)) return { status: 404, body: { error: 'Not found.' } }
  const { data, error } = await db.from(RESOLUTIONS).select('id, org_id, contact_id, scope').eq('id', id).eq('org_id', orgId).is('reopened_at', null).maybeSingle()
  if (error && MISSING.includes(error.code ?? '')) return { status: 503, body: { error: 'This switches on once the hub_250 migration is applied.' } }
  if (error || !data) return { status: 404, body: { error: 'Nothing to reopen.' } }
  // the shared reopen: flips the row, puts back what the resolve cleared, and writes contact_reopened
  const done = await reopenRow(db, data as any, 'manual', { id: byUserId, name: await staffName(db, orgId, byUserId) }, now)
  if (!done) return { status: 404, body: { error: 'Nothing to reopen.' } }
  return { status: 200, body: { id, reopened: true } }
}

/** The contact's live resolutions, for the button and the Waiting on us line: who, the reason, when (both accounts alike). */
export async function resolutionsFor(db: SupabaseClient, orgId: string, contactId: string, now = Date.now(), scope: Scope | null = null): Promise<LiveResolution[]> {
  if (!UUID.test(contactId)) return []
  // the reopen-on-inbound check first, through the one check, for every scope
  for (const s of SCOPES) await liveResolutions(db, [contactId], s, now)
  const { data, error } = await db.from(RESOLUTIONS).select('id, scope, reason, note, resolved_by, resolved_at').eq('org_id', orgId).eq('contact_id', contactId).is('reopened_at', null)
  if (error) return []
  const out: LiveResolution[] = []
  for (const r of ((data ?? []) as any[]).filter((x) => !scope || x.scope === scope)) out.push(viewOf(r, await staffName(db, orgId, r.resolved_by)))
  return out
}
