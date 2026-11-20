// src/lib/drafts/inbox.ts
// Drafts reviewed in the Inbox (feat/drafts-inbox-review). Server only (service role behind withStaff).
// Everything here follows the Inbox's mailbox rule (canSee in src/lib/mail/google.ts: a private mailbox to its owner,
// a shared one to superadmins of its org). A private mailbox's message, draft and lesson are never returned to anyone
// else, and its Gmail is never called for them.
//   reviewQueue   the messages that need review: a hub_drafts row in REVIEW_STATUSES (drafted, needs_person) only
//   draftBadges   the draft badge of each listed message
//   reviewPane    one message: the email (metadata and the AI summary), what the drafter looked at (metadata only,
//                 nothing quoted from mail), the draft read live from Gmail (in memory, never stored), why it was
//                 written that way (from its shape), the lesson
//   learning      the Learning tab: a 30-day scorecard per mailbox, the lessons, the priority corrections
import type { SupabaseClient } from '@supabase/supabase-js'
import { listVisible, loadVisible, type MailConnectionRow } from '@/lib/mail/google'
import { priorityWhy } from '@/lib/mail/priority'
import { getDraft } from './gmail-drafts'
import type { Mailbox } from './support'
import { REVIEW_STATUSES, STOP_TEXT, badgeOf, draftUrl, whyLine, type Badge, type StopClass } from './rules'

export interface InboxViewer { db: SupabaseClient; userId: string; isSuperadmin: boolean; orgIds: string[]; orgRoles?: Record<string, string> }

const DAY = 86_400_000
const ctxOf = (v: InboxViewer) => ({ orgRoles: {}, ...v })
const escLike = (s: string) => s.replace(/[\\%_]/g, (x) => '\\' + x)
const missing = (e: { code?: string } | null | undefined) => !!e && ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(String(e.code))

/** The messages needing review in the viewer's mailboxes, and how many. */
export async function reviewQueue(v: InboxViewer, connectionIds?: string[]): Promise<{ count: number; messageIds: string[] }> {
  const boxes = (await listVisible(ctxOf(v))) ?? []
  const ids = boxes.map((b) => b.id).filter((id) => !connectionIds || connectionIds.includes(id))
  if (!ids.length) return { count: 0, messageIds: [] }
  const { data, error } = await v.db.from('hub_drafts').select('source_id, connection_id, status')
    .in('connection_id', ids).eq('source_table', 'hub_mail_messages').in('status', REVIEW_STATUSES).limit(500)
  if (error) throw new Error(`hub_drafts read: ${error.code ?? 'unknown'}`)
  const messageIds = Array.from(new Set(((data ?? []) as any[]).filter((r) => ids.includes(r.connection_id)).map((r) => r.source_id as string)))
  return { count: messageIds.length, messageIds }
}

/** message id -> its draft's status and badge (for messages in mailboxes the caller already checked). */
export async function draftBadges(db: SupabaseClient, messageIds: string[]): Promise<Map<string, { status: string; badge: Badge }>> {
  const out = new Map<string, { status: string; badge: Badge }>()
  if (!messageIds.length) return out
  const { data } = await db.from('hub_drafts').select('source_id, status').eq('source_table', 'hub_mail_messages').in('source_id', messageIds)
  for (const r of (data ?? []) as any[]) out.set(r.source_id, { status: r.status, badge: badgeOf(r.status) })
  return out
}

/** message id -> who last set its priority by hand ('you' or 'teammate'). Empty before hub_247. */
export async function prioritySetters(db: SupabaseClient, viewerId: string, messageIds: string[]): Promise<Map<string, { by: 'you' | 'teammate'; reason: string | null }>> {
  const out = new Map<string, { by: 'you' | 'teammate'; reason: string | null }>()
  if (!messageIds.length) return out
  const { data, error } = await db.from('hub_priority_feedback').select('message_id, set_by, reason, created_at').in('message_id', messageIds).order('created_at', { ascending: false })
  if (error) return out
  for (const r of (data ?? []) as any[]) if (!out.has(r.message_id)) out.set(r.message_id, { by: r.set_by === viewerId ? 'you' : 'teammate', reason: r.reason ?? null })
  return out
}

export interface Pane {
  email: { id: string; subject: string | null; from_name: string | null; from_address: string | null; mailbox: string; received_at: string; category: string | null
    priority: string | null; summary: string | null; suggested_action: string | null; why_priority: string; priority_set_by: 'you' | 'teammate' | null; gmail_url: string }
  looked_at: {
    contact: { id: string; name: string } | null
    pipelines: Array<{ pipeline: string; stage: string }>
    university: string | null
    calendar: string | null
    recent_threads: number
  }
  draft: null | {
    id: string; status: string; badge: Badge; reason: string | null; url: string | null
    live: { from: string; to: string; text: string } | null
    live_error: string | null
    why: string | null
    lesson: string | null
    lesson_pending: boolean
  }
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })

/** One message's review pane. null when the caller may not see it (the route answers 404). */
export async function reviewPane(v: InboxViewer, messageId: string, mailbox: (connectionId: string) => Promise<Mailbox>, now: number): Promise<Pane | null> {
  const { db } = v
  const { data: m } = await db.from('hub_mail_messages').select('id, connection_id, gmail_thread_id, from_address, from_name, subject, received_at, created_at, category, priority, summary, suggested_action')
    .eq('id', messageId).maybeSingle()
  const msg = m as any
  if (!msg) return null
  const box = await loadVisible(ctxOf(v), msg.connection_id) as MailConnectionRow | null
  if (!box) return null

  const setters = await prioritySetters(db, v.userId, [msg.id])
  const set = setters.get(msg.id) ?? null
  const email: Pane['email'] = {
    id: msg.id, subject: msg.subject ?? null, from_name: msg.from_name ?? null, from_address: msg.from_address ?? null, mailbox: box.email_address,
    received_at: msg.received_at ?? msg.created_at, category: msg.category ?? null, priority: msg.priority ?? null, summary: msg.summary ?? null,
    suggested_action: msg.suggested_action ?? null, why_priority: priorityWhy(msg.priority ?? null, msg.category ?? null, set ? { reason: set.reason, byViewer: set.by === 'you' } : null),
    priority_set_by: set?.by ?? null,
    gmail_url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(box.email_address)}#all/${msg.gmail_thread_id}`,
  }

  // ── what the drafter looked at: metadata only ──
  const addr = String(msg.from_address ?? '').trim().toLowerCase()
  const looked: Pane['looked_at'] = { contact: null, pipelines: [], university: null, calendar: null, recent_threads: 0 }
  const { data: d } = await db.from('hub_drafts').select('id, contact_id, status, reason, gmail_draft_id, gmail_draft_message_id, gmail_thread_id, draft_shape, lesson, reviewed_at')
    .eq('source_table', 'hub_mail_messages').eq('source_id', msg.id).maybeSingle()
  const draftRow = d as any
  let contactId: string | null = draftRow?.contact_id ?? null
  if (!contactId && addr.includes('@')) {
    const { data: c } = await db.from('contacts').select('id').eq('org_id', box.org_id).ilike('email', escLike(addr)).is('merged_into_id', null).limit(1)
    contactId = (c as any[] | null)?.[0]?.id ?? null
  }
  if (contactId) {
    const { data: c } = await db.from('contacts').select('id, first_name, last_name').eq('id', contactId).maybeSingle()
    if (c) looked.contact = { id: (c as any).id, name: [(c as any).first_name, (c as any).last_name].filter(Boolean).join(' ').trim() || 'Contact' }
    const { data: pos } = await db.from('contact_pipeline_positions').select('pipeline_id, stage_id').eq('org_id', box.org_id).eq('contact_id', contactId)
    const pIds = ((pos ?? []) as any[]).map((p) => p.pipeline_id), sIds = ((pos ?? []) as any[]).map((p) => p.stage_id)
    if (pIds.length) {
      const [{ data: ps }, { data: ss }] = await Promise.all([
        db.from('pipelines').select('id, name').in('id', pIds), db.from('pipeline_stages').select('id, name').in('id', sIds),
      ])
      const pn = new Map(((ps ?? []) as any[]).map((p) => [p.id, p.name])), sn = new Map(((ss ?? []) as any[]).map((s) => [s.id, s.name]))
      looked.pipelines = ((pos ?? []) as any[]).map((p) => ({ pipeline: String(pn.get(p.pipeline_id) ?? 'Pipeline'), stage: String(sn.get(p.stage_id) ?? 'Stage') }))
    }
    const { data: ev } = await db.from('hub_lifecycle_events').select('event_type, occurred_at').eq('org_id', box.org_id).eq('contact_id', contactId)
      .order('occurred_at', { ascending: false }).limit(1)
    const e = (ev as any[] | null)?.[0]
    if (e) looked.university = `Last University event: ${String(e.event_type).replace(/_/g, ' ')} on ${fmtDay(e.occurred_at)}`
    const { data: bk } = await db.from('hub_booking_syncs').select('appointment_type, starts_at, status').eq('org_id', box.org_id).eq('contact_id', contactId)
      .order('starts_at', { ascending: false }).limit(10)
    const books = (bk ?? []) as any[]
    const next = books.filter((b) => Date.parse(b.starts_at) >= now && b.status !== 'cancelled').sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0]
    const last = books.find((b) => Date.parse(b.starts_at) < now)
    looked.calendar = next ? `Next: ${next.appointment_type ?? 'call'} on ${fmtDay(next.starts_at)}`
      : last ? `Last: ${last.appointment_type ?? 'call'} on ${fmtDay(last.starts_at)} (${last.status ?? 'booked'})` : 'No calls booked'
  }
  if (!looked.university && addr.includes('@')) {
    const { data: p } = await db.from('profiles').select('id').ilike('email', escLike(addr)).limit(1)
    looked.university = (p as any[] | null)?.length ? 'Has a University account' : 'No University account found'
  }
  if (addr.includes('@')) {
    const { data: threads } = await db.from('hub_mail_messages').select('gmail_thread_id').eq('connection_id', box.id).ilike('from_address', escLike(addr))
      .gte('received_at', new Date(now - 90 * DAY).toISOString()).limit(200)
    looked.recent_threads = new Set(((threads ?? []) as any[]).map((t) => t.gmail_thread_id)).size
  }

  // ── the draft, live from Gmail (in memory only) ──
  let draft: Pane['draft'] = null
  if (draftRow && draftRow.status !== 'skipped') {
    const open = ['drafted', 'approved', 'edited'].includes(draftRow.status)
    let live: { from: string; to: string; text: string } | null = null, liveError: string | null = null
    if (open && draftRow.gmail_draft_id) {
      try {
        const g = await getDraft((await mailbox(msg.connection_id)).gmail, draftRow.gmail_draft_id)
        if (g) live = { from: g.from, to: g.to, text: g.text }
        else liveError = 'This draft is no longer in Gmail. It was sent or deleted there.'
      } catch {
        liveError = 'Gmail could not be reached. Try again.'
      }
    }
    draft = {
      id: draftRow.id, status: draftRow.status, badge: badgeOf(draftRow.status),
      reason: draftRow.status === 'needs_person' ? STOP_TEXT[draftRow.reason as StopClass] ?? 'flagged' : null,
      url: open ? draftUrl(box.email_address, draftRow.gmail_draft_message_id ?? null, draftRow.gmail_thread_id) : null,
      live, live_error: liveError, why: whyLine(draftRow.draft_shape),
      lesson: draftRow.lesson ?? null, lesson_pending: !draftRow.lesson && ['approved', 'edited'].includes(draftRow.status),
    }
  }
  return { email, looked_at: looked, draft }
}

export interface Learning {
  mailboxes: Array<{ id: string; email_address: string; drafted: number; approved: number; edited: number; rejected: number; needs_person: number }>
  lessons: Array<{ id: string; mailbox: string; lesson: string; status: string; at: string | null; is_pinned: boolean; retired: boolean }>
  corrections: Array<{ id: string; mailbox: string; from_address: string | null; subject: string | null; from_priority: string | null; to_priority: string; reason: string | null; by: 'you' | 'teammate'; at: string }>
  pin_ready: boolean
}

/** The Learning tab, for the mailboxes the viewer may see. */
export async function learning(v: InboxViewer, now: number): Promise<Learning> {
  const { db } = v
  const boxes = (await listVisible(ctxOf(v))) ?? []
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const ids = Array.from(byId.keys())
  const out: Learning = { mailboxes: [], lessons: [], corrections: [], pin_ready: true }
  if (!ids.length) return out
  const since = new Date(now - 30 * DAY).toISOString()

  const { data: recent } = await db.from('hub_drafts').select('connection_id, status, draft_shape').in('connection_id', ids).gte('created_at', since).limit(2000)
  for (const b of boxes) {
    const rows = ((recent ?? []) as any[]).filter((r) => r.connection_id === b.id && r.status !== 'skipped')
    const edited = (r: any) => r.status === 'edited' || (r.status === 'sent' && r.draft_shape?.edited === true)
    out.mailboxes.push({
      id: b.id, email_address: b.email_address,
      drafted: rows.filter((r) => r.status !== 'needs_person').length,
      approved: rows.filter((r) => r.status === 'approved' || (r.status === 'sent' && !edited(r))).length,
      edited: rows.filter(edited).length,
      rejected: rows.filter((r) => r.status === 'rejected').length,
      needs_person: rows.filter((r) => r.status === 'needs_person').length,
    })
  }

  let lessons: any[] = []
  const withPins = await db.from('hub_drafts').select('id, connection_id, lesson, status, reviewed_at, sent_at, is_pinned, retired_at').in('connection_id', ids).not('lesson', 'is', null)
    .order('reviewed_at', { ascending: false }).limit(100)
  if (missing(withPins.error)) {
    out.pin_ready = false
    const plain = await db.from('hub_drafts').select('id, connection_id, lesson, status, reviewed_at, sent_at').in('connection_id', ids).not('lesson', 'is', null)
      .order('reviewed_at', { ascending: false }).limit(100)
    lessons = (plain.data ?? []) as any[]
  } else lessons = (withPins.data ?? []) as any[]
  out.lessons = lessons.filter((l) => byId.has(l.connection_id)).map((l) => ({
    id: l.id, mailbox: byId.get(l.connection_id)!.email_address, lesson: String(l.lesson), status: l.status, at: l.sent_at ?? l.reviewed_at ?? null,
    is_pinned: !!l.is_pinned, retired: !!l.retired_at,
  }))

  const { data: fb, error: fErr } = await db.from('hub_priority_feedback').select('id, message_id, connection_id, from_priority, to_priority, reason, set_by, created_at')
    .in('connection_id', ids).order('created_at', { ascending: false }).limit(50)
  if (!fErr && fb?.length) {
    const { data: ms } = await db.from('hub_mail_messages').select('id, from_address, subject').in('id', (fb as any[]).map((f) => f.message_id))
    const meta = new Map(((ms ?? []) as any[]).map((x) => [x.id, x]))
    out.corrections = (fb as any[]).filter((f) => byId.has(f.connection_id)).map((f) => ({
      id: f.id, mailbox: byId.get(f.connection_id)!.email_address, from_address: meta.get(f.message_id)?.from_address ?? null, subject: meta.get(f.message_id)?.subject ?? null,
      from_priority: f.from_priority ?? null, to_priority: f.to_priority, reason: f.reason ?? null, by: f.set_by === v.userId ? 'you' : 'teammate', at: f.created_at,
    }))
  }
  return out
}
