// src/lib/drafts/review.ts
// The Mail section's Drafts tab (q10). Server only (service role behind withStaff). A draft is listed only to a
// viewer who may read its mailbox in full (mailView, the Communications rule): the owner, or a superadmin for a shared
// mailbox. A private mailbox's drafts are never listed, counted or acted on for anyone else. Nothing returned here is
// text: the contact's name, the mailbox address, times, status and a Gmail link.
//   approve          mark it approved and return its Gmail link (the person sends it from Gmail; the Hub never sends)
//   edit             "Approve my version": drafts.update with the person's text, mark it edited (never sent)
//   reject           a reason chip and an optional line become the row's lesson; the Gmail draft is deleted
//   redraft          compose again with an optional note; a hard stop makes it needs_person and leaves no draft;
//                    otherwise the new Gmail draft replaces the old one (created first, then the old one deleted)
//   pin / unpin / retire / restore   the Learning tab's controls on a lesson (hub_247)
// Reached from the Inbox's review pane (feat/drafts-inbox-review).
import type { SupabaseClient } from '@supabase/supabase-js'
import { mailView, MAILBOX_COLUMNS, type Mailbox as Box, type Viewer } from '@/lib/comms/privacy'
import { withAlso } from '@/lib/mail/access'
import type { ModelClient } from '@/lib/agent/model'
import { compose, loadVoice } from './compose'
import { buildReplyMime, createDraft, deleteDraft, getDraft, updateDraft } from './gmail-drafts'
import { MESSAGE_COLUMNS, type Mailbox } from './support'
import { STOP_TEXT, draftUrl, draftsOn, hardStop, personLine, rejectLesson, replySubject, shapeOf, type ComposeOut, type StopClass } from './rules'

export interface DraftView {
  id: string; kind: string; contact: string | null; contact_id: string | null; mailbox: string; created_at: string
  status: string; reason: string | null; reviewed_at: string | null; sent_at: string | null; url: string | null; has_lesson: boolean
}

export async function visibleBoxes(db: SupabaseClient, viewer: Viewer, orgIds: string[]): Promise<Map<string, Box>> {
  const { data, error } = await withAlso(MAILBOX_COLUMNS, (cols) => db.from('hub_mail_connections').select(cols).in('org_id', orgIds))
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

export type Action = 'approve' | 'edit' | 'reject' | 'redraft' | 'pin' | 'unpin' | 'retire' | 'restore'
export const ACTIONS: Action[] = ['approve', 'edit', 'reject', 'redraft', 'pin', 'unpin', 'retire', 'restore']
export interface ActInput {
  /** edit: the person's version of the draft (in memory only: it goes to Gmail and nowhere else) */
  text?: unknown
  /** reject: one of REJECT_CHIPS, and an optional line */
  chip?: unknown
  line?: unknown
  /** redraft: an optional note for compose */
  note?: unknown
  /** redraft: the model */
  model?: ModelClient
}
const OPEN = ['drafted', 'approved', 'edited']
const EDIT_MIN = 1, EDIT_MAX = 8000

/** One review action. 404 for a draft the viewer may not see (a private mailbox's existence is not confirmed). */
export async function act(db: SupabaseClient, viewer: Viewer, orgIds: string[], id: string, action: Action, mailbox: (connectionId: string) => Promise<Mailbox>, now: Date, input: ActInput = {})
  : Promise<{ status: number; body: Record<string, unknown> }> {
  const { data: r } = await db.from('hub_drafts').select('id, org_id, connection_id, gmail_thread_id, gmail_draft_id, gmail_draft_message_id, status, source_table, source_id, contact_id, lesson')
    .eq('id', id).maybeSingle()
  const row = r as any
  if (!row || !orgIds.includes(row.org_id)) return { status: 404, body: { error: 'Not found.' } }
  const boxes = await visibleBoxes(db, viewer, [row.org_id])
  const box = boxes.get(row.connection_id)
  if (!box) return { status: 404, body: { error: 'Not found.' } }
  const iso = now.toISOString()
  const reviewed = { reviewed_at: iso, reviewed_by: viewer.userId, updated_at: iso }
  const link = (msgId: string | null) => draftUrl(box.email_address, msgId, row.gmail_thread_id)

  // ── Learning tab: pin and retire a lesson ──
  if (action === 'pin' || action === 'unpin' || action === 'retire' || action === 'restore') {
    if (!row.lesson) return { status: 409, body: { error: 'This draft has no lesson.' } }
    const patch = action === 'pin' ? { is_pinned: true, retired_at: null } : action === 'unpin' ? { is_pinned: false }
      : action === 'retire' ? { is_pinned: false, retired_at: iso } : { retired_at: null }
    const { error } = await db.from('hub_drafts').update({ ...patch, updated_at: iso }).eq('id', id)
    if (error) return { status: error.code === '42703' || error.code === 'PGRST204' ? 503 : 500, body: { error: error.code === '42703' || error.code === 'PGRST204' ? 'Pin and Retire need hub_247, which is not applied yet.' : 'The lesson could not be updated.' } }
    return { status: 200, body: { ok: true, ...patch } }
  }

  const allowed = action === 'reject' ? [...OPEN, 'needs_person'] : OPEN
  if (!allowed.includes(row.status)) return { status: 409, body: { error: `This draft is already ${row.status}.` } }

  if (action === 'approve') {
    const { error } = await db.from('hub_drafts').update({ status: 'approved', ...reviewed }).eq('id', id)
    if (error) return { status: 500, body: { error: 'The draft could not be updated.' } }
    return { status: 200, body: { status: 'approved', url: link(row.gmail_draft_message_id ?? null) } }
  }

  if (action === 'reject') {
    // a draft needs a reason chip; dismissing a needs-a-person row may leave it out
    const lesson = input.chip === undefined && row.status === 'needs_person' ? null : rejectLesson(input.chip, input.line)
    if (lesson === null && !(input.chip === undefined && row.status === 'needs_person')) {
      return { status: 400, body: { error: 'Choose a reason. The optional line must be under 200 characters, on one line, with no @.' } }
    }
    if (row.gmail_draft_id) await deleteDraft((await mailbox(row.connection_id)).gmail, row.gmail_draft_id)
    const { error } = await db.from('hub_drafts').update({ status: 'rejected', ...(lesson ? { lesson } : {}), ...reviewed }).eq('id', id)
    if (error) return { status: 500, body: { error: 'The draft could not be updated.' } }
    return { status: 200, body: { status: 'rejected', url: null, lesson } }
  }

  if (action === 'edit') {
    // "Approve my version": the same Gmail draft gets the person's text (drafts.update). Never sent.
    const text = typeof input.text === 'string' ? input.text.replace(/\r\n/g, '\n').trim() : ''
    if (text.length < EDIT_MIN || text.length > EDIT_MAX) return { status: 400, body: { error: 'The draft text is empty or too long.' } }
    const gmail = (await mailbox(row.connection_id)).gmail
    const live = await getDraft(gmail, row.gmail_draft_id)
    if (!live) return { status: 409, body: { error: 'This draft is no longer in Gmail. It was sent or deleted there.' } }
    const raw = buildReplyMime({ from: live.from || box.email_address, to: live.to, subject: live.subject || replySubject(null), text, inReplyTo: live.inReplyTo, references: live.references })
    const made = await updateDraft(gmail, row.gmail_draft_id, raw, live.threadId ?? row.gmail_thread_id)
    const msgId = made.messageId ?? row.gmail_draft_message_id ?? null
    const { error } = await db.from('hub_drafts').update({ status: 'edited', gmail_draft_message_id: msgId, draft_shape: { ...shapeOf(text), edited: true }, ...reviewed }).eq('id', id)
    if (error) return { status: 500, body: { error: 'Gmail has your version, but the Hub could not mark it edited.' } }
    return { status: 200, body: { status: 'edited', url: link(msgId) } }
  }

  // ── redraft: compose again for the same message, with the note; the hard stop still applies ──
  const note = personLine(input.note)
  if (note === undefined) return { status: 400, body: { error: 'The note must be under 200 characters, on one line, with no @.' } }
  if (!input.model || row.source_table !== 'hub_mail_messages') return { status: 409, body: { error: 'This draft cannot be redrafted.' } }
  const { data: m } = await db.from('hub_mail_messages').select(MESSAGE_COLUMNS).eq('id', row.source_id).maybeSingle()
  if (!m) return { status: 409, body: { error: 'The email for this draft is no longer in the Hub.' } }
  const mb = await mailbox(row.connection_id)
  const msg = await mb.read((m as any).gmail_message_id)   // body in memory only
  const { data: c } = row.contact_id ? await db.from('contacts').select('first_name').eq('id', row.contact_id).maybeSingle() : { data: null }
  const firstName = (c as any)?.first_name ?? null
  // the email is screened here first, before any model call; compose screens it again
  const early = hardStop(msg.subject, msg.body)
  const out: ComposeOut = early ? { ok: false, stop: early }
    : await compose(input.model, 'support', { fromName: msg.fromName, fromAddress: msg.fromAddress, subject: msg.subject, body: msg.body, firstName, note }, await loadVoice(db, row.org_id))
  if (!out.ok && 'stop' in out) {
    if (row.gmail_draft_id) await deleteDraft(mb.gmail, row.gmail_draft_id)
    const { error } = await db.from('hub_drafts').update({ status: 'needs_person', reason: out.stop, gmail_draft_id: null, gmail_draft_message_id: null, draft_shape: {},
      reviewed_at: null, reviewed_by: null, updated_at: iso }).eq('id', id)
    if (error) return { status: 500, body: { error: 'The draft could not be updated.' } }
    return { status: 200, body: { status: 'needs_person', reason: out.stop, url: null } }
  }
  if (!out.ok) return { status: 422, body: { error: 'The redraft did not produce a usable reply. The current draft is unchanged.' } }
  const raw = buildReplyMime({ from: box.email_address, to: msg.fromAddress ?? (m as any).from_address, subject: replySubject(msg.subject), text: out.draft.body,
    inReplyTo: msg.rfcMessageId ?? null, references: msg.references ?? null })
  const made = await createDraft(mb.gmail, raw, row.gmail_thread_id)
  if (row.gmail_draft_id) await deleteDraft(mb.gmail, row.gmail_draft_id)
  const { error } = await db.from('hub_drafts').update({ status: 'drafted', gmail_draft_id: made.draftId, gmail_draft_message_id: made.messageId,
    draft_shape: shapeOf(out.draft.body, firstName), reviewed_at: null, reviewed_by: null, updated_at: iso }).eq('id', id)
  if (error) return { status: 500, body: { error: 'Gmail has the new draft, but the Hub could not record it.' } }
  return { status: 200, body: { status: 'drafted', url: link(made.messageId) } }
}
