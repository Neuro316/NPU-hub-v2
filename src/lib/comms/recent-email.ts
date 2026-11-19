// src/lib/comms/recent-email.ts
// Contact card › Recent email (Running List q31, decided 2026-11-18): the contact's last 7 email conversations across
// the Hub's connected mailboxes, newest first. One line per Gmail thread (per mailbox), never one per message.
// Built ONLY from what the Hub already stores: hub_mail_messages (received: from address, subject, time, thread,
// mailbox, triage category) and hub_mail_sent (sent: recipient, time, thread, mailbox). Nothing is fetched from Gmail,
// nothing is stored, and no body, snippet or summary is ever selected.
//
// Privacy reuses mailView (src/lib/comms/privacy.ts), the same rule as the Communications section. A thread takes the
// strictest view of any of its messages. Any view other than 'full' gives a line with the date only: no subject, no
// mailbox, no last reply.
import type { SupabaseClient } from '@supabase/supabase-js'
import { mailView, type Mailbox, type MailView, type Viewer } from './privacy'
import type { Subject } from './history'

export const RECENT_EMAIL_LIMIT = 7
/** The only columns read. Neither list may ever name body, snippet or summary. */
export const RECEIVED_COLUMNS = 'connection_id, gmail_thread_id, subject, category, received_at'
export const SENT_COLUMNS = 'connection_id, gmail_thread_id, sent_at'

/** The only shape that leaves the server. */
export interface RecentEmailLine {
  key: string
  at: string
  /** true: the viewer may not read this thread; label is the placeholder and mailbox and lastReply are null */
  hidden: boolean
  label: string
  mailbox: string | null
  lastReply: string | null
}
export const LINE_KEYS = ['key', 'at', 'hidden', 'label', 'mailbox', 'lastReply'] as const

export interface Received { connection_id: string; gmail_thread_id: string; subject?: string | null; category?: string | null; received_at: string }
export interface Sent { connection_id: string; gmail_thread_id: string; sent_at: string }

const HIDDEN_LABEL: Record<Exclude<MailView, 'full'>, string> = {
  private_inbox: '1 private conversation',
  private_email: '1 private conversation',
  shared_inbox: '1 shared inbox conversation',
}
const STRICTNESS: MailView[] = ['full', 'shared_inbox', 'private_inbox', 'private_email']
const oneLine = (s: unknown, max = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const ms = (iso: string) => Date.parse(iso) || 0

/** Pure: group the messages into threads, apply privacy, keep the newest 7. ownerName maps a user id to a name. */
export function recentEmail(viewer: Viewer, boxes: Mailbox[], received: Received[], sent: Sent[], ownerName: Map<string, string>): RecentEmailLine[] {
  const box = new Map(boxes.map((b) => [b.id, b]))
  type Msg = { at: string; dir: 'in' | 'out'; subject: string; view: MailView }
  const threads = new Map<string, { box: Mailbox; msgs: Msg[] }>()
  const add = (connectionId: string, threadId: string, m: Msg) => {
    const b = box.get(connectionId)
    if (!b || !threadId || !m.at) return
    const k = `${connectionId}:${threadId}`
    if (!threads.has(k)) threads.set(k, { box: b, msgs: [] })
    threads.get(k)!.msgs.push(m)
  }
  for (const r of received) { const b = box.get(r.connection_id); if (b) add(r.connection_id, r.gmail_thread_id, { at: r.received_at, dir: 'in', subject: oneLine(r.subject), view: mailView(viewer, b, r.category) }) }
  for (const s of sent) { const b = box.get(s.connection_id); if (b) add(s.connection_id, s.gmail_thread_id, { at: s.sent_at, dir: 'out', subject: '', view: mailView(viewer, b, null) }) }

  const lines = Array.from(threads.entries()).map(([k, t]) => {
    const msgs = t.msgs.slice().sort((a, b) => ms(b.at) - ms(a.at))
    const latest = msgs[0]
    const view = msgs.reduce<MailView>((v, m) => (STRICTNESS.indexOf(m.view) > STRICTNESS.indexOf(v) ? m.view : v), 'full')
    if (view !== 'full') return { k, line: { key: '', at: latest.at, hidden: true, label: HIDDEN_LABEL[view], mailbox: null, lastReply: null } }
    const subject = msgs.find((m) => m.dir === 'in' && m.subject)?.subject || 'Sent email (subject not stored)'
    const bothSides = msgs.some((m) => m.dir === 'in') && msgs.some((m) => m.dir === 'out')
    const lastReply = !bothSides ? 'No reply yet' : latest.dir === 'in' ? 'Contact' : ownerName.get(t.box.owner_user_id) || t.box.email_address
    return { k, line: { key: '', at: latest.at, hidden: false, label: subject, mailbox: t.box.email_address, lastReply } }
  })
  return lines
    .sort((a, b) => ms(b.line.at) - ms(a.line.at) || a.k.localeCompare(b.k))
    .slice(0, RECENT_EMAIL_LIMIT)
    .map((x, i) => ({ ...x.line, key: `email-${i + 1}` }))
}

const fail = (what: string, e: { code?: string } | null) => new Error(`${what} read: ${e?.code ?? 'unknown'}`)
const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)
const PER_QUERY = 200

/** Server only (service role). The contact's emails come from subjectFor: the card's email, the alternates a merge
 *  records (custom_fields.alt_emails), and those of every contact merged into it. */
export async function loadRecentEmail(db: SupabaseClient, viewer: Viewer, s: Subject): Promise<RecentEmailLine[]> {
  if (!s.emails.length) return []
  const { data: boxes, error } = await db.from('hub_mail_connections').select('id, owner_user_id, email_address, visibility').eq('org_id', s.orgId)
  if (error) throw fail('hub_mail_connections', error)
  const list = (boxes ?? []) as Mailbox[]
  if (!list.length) return []
  const ids = list.map((b) => b.id)
  const received: Received[] = []
  for (const e of s.emails) {
    const { data, error: mErr } = await db.from('hub_mail_messages').select(RECEIVED_COLUMNS)
      .in('connection_id', ids).ilike('from_address', likeExact(e)).order('received_at', { ascending: false }).limit(PER_QUERY)
    if (mErr) throw fail('hub_mail_messages', mErr)
    received.push(...((data ?? []) as any[]))
  }
  const { data: sent, error: sErr } = await db.from('hub_mail_sent').select(SENT_COLUMNS)
    .in('connection_id', ids).in('to_address', s.emails).order('sent_at', { ascending: false }).limit(PER_QUERY)
  if (sErr) throw fail('hub_mail_sent', sErr)
  const owners = Array.from(new Set(list.map((b) => b.owner_user_id).filter(Boolean)))
  const ownerName = new Map<string, string>()
  if (owners.length) {
    const { data: people, error: pErr } = await db.from('team_profiles').select('user_id, display_name').in('user_id', owners)
    if (pErr) throw fail('team_profiles', pErr)
    for (const p of (people ?? []) as any[]) if (p.display_name) ownerName.set(p.user_id, p.display_name)
  }
  return recentEmail(viewer, list, received, (sent ?? []) as Sent[], ownerName)
}
