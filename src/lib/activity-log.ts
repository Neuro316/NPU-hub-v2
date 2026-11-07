// src/lib/activity-log.ts
// The one place that knows activity_log's real columns. The table has action, entity_type,
// entity_id, details and created_at. The app reads an entry as event_type, event_data, ref_table,
// ref_id and occurred_at, so both directions are translated here.
//
// actor_id is a foreign key to team_members, while callers know the auth user. The auth user is
// kept in details.actor_user_id, because a superadmin may have no team_members row in that org.
// activity_log has no foreign key to contacts, so names are read in a second query.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ActivityInput {
  contact_id: string
  org_id: string
  event_type: string
  event_data?: Record<string, unknown>
  ref_table?: string
  ref_id?: string
  /** The auth user who acted. */
  actor_id?: string
}

export interface ActivityEntry {
  id: string
  contact_id: string
  org_id: string
  event_type: string
  event_data: Record<string, unknown> | null
  ref_table: string | null
  ref_id: string | null
  /** The auth user who acted, or null for the system. */
  actor_id: string | null
  occurred_at: string
  created_at: string
  contacts?: { first_name: string; last_name: string } | null
}

export const ACTIVITY_COLUMNS = 'id, org_id, contact_id, actor_id, action, entity_type, entity_id, details, created_at'
export const ACTOR_USER_PATH = 'details->>actor_user_id'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The log says that something happened, never what a message, email or call said. Any org member can
// read this table, so these are dropped here even if a caller passes one.
const CONTENT_KEYS = new Set(['body', 'content', 'html', 'message', 'preview', 'subject', 'summary', 'text', 'transcript', 'transcription'])

function withoutContent(data: Record<string, unknown> | undefined) {
  if (!data) return null
  return Object.fromEntries(Object.entries(data).filter(([k]) => !CONTENT_KEYS.has(k.toLowerCase())))
}

/** Pure: the row to insert. entity_id is a uuid column, so any other reference stays in details. */
export function toActivityRow(entry: ActivityInput, teamMemberId: string | null) {
  const refIsUuid = !!entry.ref_id && UUID.test(entry.ref_id)
  return {
    org_id: entry.org_id,
    contact_id: entry.contact_id,
    actor_id: teamMemberId,
    action: entry.event_type,
    entity_type: entry.ref_table ?? 'contact',
    entity_id: refIsUuid ? entry.ref_id! : null,
    details: {
      event_data: withoutContent(entry.event_data),
      actor_user_id: entry.actor_id ?? null,
      ...(entry.ref_id && !refIsUuid ? { ref_id: entry.ref_id } : {}),
    },
  }
}

/** Pure: a stored row as the app reads it. Also used on realtime payloads. */
export function fromActivityRow(row: any): ActivityEntry {
  const details = row?.details && typeof row.details === 'object' ? row.details : {}
  return {
    id: row.id,
    org_id: row.org_id,
    contact_id: row.contact_id ?? '',
    event_type: row.action,
    event_data: details.event_data ?? null,
    ref_table: row.entity_type ?? null,
    ref_id: row.entity_id ?? details.ref_id ?? null,
    actor_id: details.actor_user_id ?? null,
    occurred_at: row.created_at,
    created_at: row.created_at,
  }
}

/** Newest first, with contact names. A failed read throws rather than looking like an empty log. */
export async function loadActivity(db: SupabaseClient, q: {
  orgId?: string
  contactId?: string
  actionPrefix?: string
  /** A user id, or 'system' for entries no person made. */
  actor?: string
  limit: number
}): Promise<ActivityEntry[]> {
  let query = db.from('activity_log').select(ACTIVITY_COLUMNS).order('created_at', { ascending: false }).limit(q.limit)
  if (q.orgId) query = query.eq('org_id', q.orgId)
  if (q.contactId) query = query.eq('contact_id', q.contactId)
  if (q.actionPrefix) query = query.like('action', `${q.actionPrefix}%`)
  if (q.actor === 'system') query = query.is(ACTOR_USER_PATH, null)
  else if (q.actor) query = query.eq(ACTOR_USER_PATH, q.actor)
  const { data, error } = await query
  if (error) throw error
  const entries = (data ?? []).map(fromActivityRow)
  const ids = Array.from(new Set(entries.map((e) => e.contact_id).filter(Boolean)))
  if (!ids.length) return entries
  const { data: people } = await db.from('contacts').select('id, first_name, last_name').in('id', ids)
  const byId = new Map((people ?? []).map((p: any) => [p.id, { first_name: p.first_name ?? '', last_name: p.last_name ?? '' }]))
  return entries.map((e) => ({ ...e, contacts: byId.get(e.contact_id) ?? null }))
}
