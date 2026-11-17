// src/lib/comms/privacy.ts
// The pure rules of the contact card's Communications section (Running List q02). No imports, so the harness
// (scripts/comms/comms-tamper.cjs) runs them directly. The server route applies them; the browser never sees a row
// before they have been applied.
//
// Mail privacy (the mail rule of 2026-11-09, extended here):
//   private mailbox   subject and summary to the mailbox's OWNER only; everyone else sees "Email (private inbox)"
//                     with the date and direction, no subject, no summary, no address, no mailbox name
//   shared mailbox    subject and summary to superadmins and the owner (the inbox rule); other staff see
//                     "Email (shared inbox)"
//   sensitive         a message triaged clinical, legal_financial or vendor_billing shows "Private email" with no
//                     subject to anyone but the owner, superadmins included
// Bodies are never read, so no row can carry one: a Touch has exactly the fields below.

export type TouchType = 'email' | 'text' | 'call' | 'meeting' | 'campaign' | 'lifecycle'
export type Direction = 'in' | 'out' | null

/** The only shape the route returns. Nothing else leaves the server. */
export interface Touch {
  id: string
  type: TouchType
  direction: Direction
  at: string
  who: string | null
  summary: string
  /** muted: a lifecycle dry-run "would have" row (superadmins only) */
  muted: boolean
  /** redacted: a mail row the viewer may not read */
  redacted: boolean
}
export const TOUCH_KEYS = ['id', 'type', 'direction', 'at', 'who', 'summary', 'muted', 'redacted'] as const

export interface Viewer { userId: string; isSuperadmin: boolean }
export interface Mailbox { id: string; owner_user_id: string; email_address: string; visibility: string }

export const SENSITIVE_CATEGORIES = ['clinical', 'legal_financial', 'vendor_billing']

export type MailView = 'full' | 'private_inbox' | 'shared_inbox' | 'private_email'

/** What a viewer may see of one mail row. Unknown visibility is treated as private. */
export function mailView(viewer: Viewer, box: Mailbox, category: string | null | undefined): MailView {
  const owner = box.owner_user_id === viewer.userId
  if (owner) return 'full'
  if (category && SENSITIVE_CATEGORIES.includes(category)) return 'private_email'
  if (box.visibility === 'shared') return viewer.isSuperadmin ? 'full' : 'shared_inbox'
  return 'private_inbox'
}

const REDACTED_LABEL: Record<Exclude<MailView, 'full'>, string> = {
  private_inbox: 'Email (private inbox)',
  shared_inbox: 'Email (shared inbox)',
  private_email: 'Private email',
}

const oneLine = (s: unknown, max = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** An email received. Full view: subject and the AI summary on one line; otherwise the label only. */
export function inboundEmail(viewer: Viewer, box: Mailbox, m: { id: string; subject?: string | null; summary?: string | null; category?: string | null; received_at: string }): Touch {
  const view = mailView(viewer, box, m.category)
  if (view !== 'full') return touch({ id: `mail:${m.id}`, type: 'email', direction: 'in', at: m.received_at, who: null, summary: REDACTED_LABEL[view], redacted: true })
  const subject = oneLine(m.subject, 120) || '(no subject)'
  const summary = oneLine(m.summary, 140)
  return touch({ id: `mail:${m.id}`, type: 'email', direction: 'in', at: m.received_at, who: box.email_address, summary: summary ? `${subject}: ${summary}` : subject })
}

/** An email sent (hub_236 metadata only: never a subject). */
export function outboundEmail(viewer: Viewer, box: Mailbox, s: { id: string; sent_at: string }): Touch {
  const view = mailView(viewer, box, null)
  if (view !== 'full') return touch({ id: `sent:${s.id}`, type: 'email', direction: 'out', at: s.sent_at, who: null, summary: REDACTED_LABEL[view], redacted: true })
  return touch({ id: `sent:${s.id}`, type: 'email', direction: 'out', at: s.sent_at, who: box.email_address, summary: `Email sent from ${box.email_address}` })
}

/** Builds a Touch with exactly the allowed fields, whatever the caller passed. */
export function touch(t: { id: string; type: TouchType; direction: Direction; at: string; who: string | null; summary: string; muted?: boolean; redacted?: boolean }): Touch {
  return { id: t.id, type: t.type, direction: t.direction, at: t.at, who: t.who ?? null, summary: oneLine(t.summary, 200), muted: !!t.muted, redacted: !!t.redacted }
}

/** Newest first, then by id so the order is stable. */
export function sortTouches(rows: Touch[]): Touch[] {
  return rows.slice().sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0) || a.id.localeCompare(b.id))
}

export const FILTERS: Array<{ key: 'all' | TouchType; label: string }> = [
  { key: 'all', label: 'All' }, { key: 'email', label: 'Email' }, { key: 'text', label: 'Text' },
  { key: 'call', label: 'Call' }, { key: 'meeting', label: 'Meeting' }, { key: 'campaign', label: 'Campaign' },
]
