// src/lib/resolve/check.ts
// THE "No reply needed" check (src/lib/resolve/rules.ts writes the rows). Read by exactly one place in each monitor:
// the text alert (src/lib/touchpoints/text-alerts.ts), the touchpoint raise and digest (src/lib/touchpoints/run.ts) and
// speed to lead (resolvedLeads in src/lib/touch/first-touch.ts: the tiles, the brief and lead_no_touch_24h). Keyed on
// the contact, never the login. No imports from the monitors, so they can all import it.
import type { SupabaseClient } from '@supabase/supabase-js'

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
  const { data, error } = await db.from(RESOLUTIONS).select('id, contact_id, scope, resolved_at').in('contact_id', ids).is('reopened_at', null)
  if (error) return out
  for (const r of ((data ?? []) as any[]).filter((x) => covers(x.scope, scope))) {
    if (await inboundSince(db, r.contact_id, r.resolved_at)) {
      await db.from(RESOLUTIONS).update({ reopened_at: iso(now), reopened_reason: 'new_inbound' }).eq('id', r.id).is('reopened_at', null)
      continue
    }
    out.add(r.contact_id)
  }
  return out
}

