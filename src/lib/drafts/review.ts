// src/lib/drafts/review.ts
// The Mail section's Drafts tab (q10). Server only (service role behind withStaff). A draft is listed only to a
// viewer who may read its mailbox in full (mailView, the Communications rule): the owner, or a superadmin for a shared
// mailbox. A private mailbox's drafts are never listed, counted or acted on for anyone else. Nothing returned here is
// text: the contact's name, the mailbox address, times, status and a Gmail link.
//   approve / edit   mark the draft and return its Gmail link (the person opens it; the Hub never sends)
//   reject           mark it rejected and delete the Gmail draft (drafts.delete)
import type { SupabaseClient } from '@supabase/supabase-js'
import { mailView, type Mailbox as Box, type Viewer } from '@/lib/comms/privacy'
import { deleteDraft } from './gmail-drafts'
import type { Mailbox } from './support'
import { STOP_TEXT, draftUrl, draftsOn, type StopClass } from './rules'

export interface DraftView {
  id: string; kind: string; contact: string | null; contact_id: string | null; mailbox: string; created_at: string
  status: string; reason: string | null; reviewed_at: string | null; sent_at: string | null; url: string | null; has_lesson: boolean
}

export async function visibleBoxes(db: SupabaseClient, viewer: Viewer, orgIds: string[]): Promise<Map<string, Box>> {
  const { data, error } = await db.from('hub_mail_connections').select('id, owner_user_id, email_address, visibility').in('org_id', orgIds)
  if (error) throw new Error(`hub_mail_connections read: ${error.code ?? 'unknown'}`)
  return new Map(((data ?? []) as Box[]).filter((b) => mailView(viewer, b, null) === 'full').map((b) => [b.id, b]))
}

export async function listDrafts(db: SupabaseClient, viewer: Viewer, orgIds: string[]): Promise<{ mode: 'on' | 'off'; drafts: DraftView[] }> {
  const { data: modes } = await db.from('org_settings').select('setting_value').in('org_id', orgIds).eq('setting_key', 'hub_drafts_mode')
  const mode = ((modes ?? []) as any[]).some((m) => draftsOn(m.setting_value)) ? 'on' : 'off'
  const boxes = await visibleBoxes(db, viewer, orgIds)
  if (!boxes.size) return { mode, drafts: [] }
  const { data, error } = await db.from('hub_drafts').select('id, kind, connection_id, gmail_thread_id, gmail_draft_message_id, contact_id, status, reason, created_at, reviewed_at, sent_at, lesson')
    .in('connection_id', Array.from(boxes.keys())).neq('status', 'skipped').order('created_at', { ascending: false }).limit(100)
  if (error) throw new Error(`hub_drafts read: ${error.code ?? 'unknown'}`)
  const rows = ((data ?? []) as any[]).filter((r) => boxes.has(r.connection_id))
  const ids = Array.from(new Set(rows.map((r) => r.contact_id).filter(Boolean)))
  const names = new Map<string, string>()
  if (ids.length) {
    const { data: cs } = await db.from('contacts').select('id, first_name, last_name').in('id', ids)
    for (const c of (cs ?? []) as any[]) names.set(c.id, [c.first_name, c.last_name].filter(Boolean).join(' ').trim())
  }
  return {
    mode,
    drafts: rows.map((r) => {
      const box = boxes.get(r.connection_id)!
      const open = ['drafted', 'approved', 'edited'].includes(r.status)
      return {
        id: r.id, kind: r.kind, contact: r.contact_id ? names.get(r.contact_id) || null : null, contact_id: r.contact_id ?? null, mailbox: box.email_address,
        created_at: r.created_at, status: r.status,
        reason: r.status === 'needs_person' ? `Needs a person: ${STOP_TEXT[r.reason as StopClass] ?? 'flagged'}` : null,
        reviewed_at: r.reviewed_at ?? null, sent_at: r.sent_at ?? null,
        url: open ? draftUrl(box.email_address, r.gmail_draft_message_id ?? null, r.gmail_thread_id) : null,
        has_lesson: !!r.lesson,
      }
    }),
  }
}

export type Action = 'approve' | 'edit' | 'reject'
const NEXT: Record<Action, string> = { approve: 'approved', edit: 'edited', reject: 'rejected' }

/** One review action. 404 for a draft the viewer may not see (a private mailbox's existence is not confirmed). */
export async function act(db: SupabaseClient, viewer: Viewer, orgIds: string[], id: string, action: Action, mailbox: (connectionId: string) => Promise<Mailbox>, now: Date)
  : Promise<{ status: number; body: Record<string, unknown> }> {
  const { data: r } = await db.from('hub_drafts').select('id, org_id, connection_id, gmail_thread_id, gmail_draft_id, gmail_draft_message_id, status').eq('id', id).maybeSingle()
  const row = r as any
  if (!row || !orgIds.includes(row.org_id)) return { status: 404, body: { error: 'Not found.' } }
  const boxes = await visibleBoxes(db, viewer, [row.org_id])
  const box = boxes.get(row.connection_id)
  if (!box) return { status: 404, body: { error: 'Not found.' } }
  const allowed = action === 'reject' ? ['drafted', 'approved', 'edited', 'needs_person'] : ['drafted', 'approved', 'edited']
  if (!allowed.includes(row.status)) return { status: 409, body: { error: `This draft is already ${row.status}.` } }
  if (action === 'reject' && row.gmail_draft_id) await deleteDraft((await mailbox(row.connection_id)).gmail, row.gmail_draft_id)
  const { error } = await db.from('hub_drafts').update({ status: NEXT[action], reviewed_at: now.toISOString(), reviewed_by: viewer.userId, updated_at: now.toISOString() }).eq('id', id)
  if (error) return { status: 500, body: { error: 'The draft could not be updated.' } }
  return { status: 200, body: { status: NEXT[action], url: action === 'reject' ? null : draftUrl(box.email_address, row.gmail_draft_message_id ?? null, row.gmail_thread_id) } }
}
