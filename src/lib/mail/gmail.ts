// src/lib/mail/gmail.ts
// Read-only Gmail calls for inbox sync (inbox agent phase 2,
// docs/plans/hub-mail-triage-rulings.md). Same hard rule as google.ts: failures become
// MailError with a fixed message; no token, header value or body text is ever logged
// or put in an error. The plain-text body returned by getMessage exists only in memory,
// for the classifier, and is never stored.
import { MailError } from '@/lib/mail/google'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
export const BODY_CHARS = 4000
/** history.list pages read per run; anything beyond waits for the next run. */
const MAX_HISTORY_PAGES = 10

async function gmailGet(accessToken: string, path: string): Promise<{ status: number; data: any }> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
  } catch {
    throw new MailError('Gmail could not be reached. Try again.', 'network')
  }
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

/** The mailbox's current history id: the sync cursor for "from now on". */
export async function currentHistoryId(accessToken: string): Promise<string> {
  const { status, data } = await gmailGet(accessToken, '/profile')
  if (status !== 200 || !/^\d+$/.test(String(data.historyId ?? ''))) {
    throw new MailError(`Gmail refused the profile request (HTTP ${status}).`, 'gmail_error')
  }
  return String(data.historyId)
}

export interface AddedMessage { id: string; threadId: string }

/** Messages added to INBOX since `startHistoryId`, and the cursor to store next.
 *  A 404 means Gmail no longer holds history that old (code history_expired). */
export async function inboxAddedSince(accessToken: string, startHistoryId: string): Promise<{ added: AddedMessage[]; historyId: string }> {
  const seen = new Map<string, AddedMessage>()
  let pageToken = ''
  let historyId = startHistoryId
  let lastRecordId = ''
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const q = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', labelId: 'INBOX', maxResults: '500' })
    if (pageToken) q.set('pageToken', pageToken)
    const { status, data } = await gmailGet(accessToken, `/history?${q}`)
    if (status === 404) throw new MailError('Gmail history expired; sync restarted from now. Mail received in the gap was not imported.', 'history_expired')
    if (status !== 200) throw new MailError(`Gmail refused the history request (HTTP ${status}).`, 'gmail_error')
    for (const h of data.history ?? []) {
      if (/^\d+$/.test(String(h.id ?? ''))) lastRecordId = String(h.id)
      for (const a of h.messagesAdded ?? []) {
        const m = a.message ?? {}
        const labels: string[] = m.labelIds ?? []
        if (!labels.includes('INBOX') || labels.includes('DRAFT')) continue
        if (/^[0-9a-f]{1,32}$/.test(m.id ?? '') && /^[0-9a-f]{1,32}$/.test(m.threadId ?? '')) seen.set(m.id, { id: m.id, threadId: m.threadId })
      }
    }
    pageToken = data.nextPageToken ?? ''
    if (!pageToken) {
      // Read to the end: the response's historyId is the mailbox's current cursor.
      if (/^\d+$/.test(String(data.historyId ?? ''))) historyId = String(data.historyId)
      return { added: Array.from(seen.values()), historyId }
    }
  }
  // Page cap reached with history left: resume from the last record read, so the rest
  // comes in on the next run (a repeat is harmless, rows are unique per message).
  return { added: Array.from(seen.values()), historyId: lastRecordId || historyId }
}

export interface MessageForTriage {
  threadId: string
  fromName: string | null
  fromAddress: string | null
  subject: string | null
  receivedAt: string | null
  /** first BODY_CHARS of plain text; in memory only, never stored or logged */
  body: string
}

function decodePart(data: string | undefined): string {
  if (!data) return ''
  try { return Buffer.from(data, 'base64url').toString('utf8') } catch { return '' }
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

function findBody(part: any, mime: string): string {
  if (!part) return ''
  if (part.mimeType === mime && part.body?.data) return decodePart(part.body.data)
  for (const p of part.parts ?? []) {
    const found = findBody(p, mime)
    if (found) return found
  }
  return ''
}

/** "Name <addr@x>" or "addr@x" → parts. Gmail returns header values already decoded. */
export function parseFrom(raw: string | undefined): { name: string | null; address: string | null } {
  if (!raw) return { name: null, address: null }
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  const address = (m ? m[2] : raw).trim().toLowerCase()
  const name = m ? m[1].trim() : ''
  return { name: name ? name.slice(0, 200) : null, address: /@/.test(address) ? address.slice(0, 320) : null }
}

export async function getMessageForTriage(accessToken: string, id: string): Promise<MessageForTriage> {
  const { status, data } = await gmailGet(accessToken, `/messages/${encodeURIComponent(id)}?format=full`)
  if (status === 404) throw new MailError('The message is no longer in Gmail.', 'message_gone')
  if (status !== 200) throw new MailError(`Gmail refused the message request (HTTP ${status}).`, 'gmail_error')
  const headers: { name: string; value: string }[] = data.payload?.headers ?? []
  const header = (n: string) => headers.find(h => h.name?.toLowerCase() === n)?.value
  const from = parseFrom(header('from'))
  const plain = findBody(data.payload, 'text/plain') || htmlToText(findBody(data.payload, 'text/html'))
  const internal = Number(data.internalDate)
  return {
    threadId: String(data.threadId ?? ''),
    fromName: from.name,
    fromAddress: from.address,
    subject: (header('subject') ?? '').slice(0, 500) || null,
    receivedAt: Number.isFinite(internal) && internal > 0 ? new Date(internal).toISOString() : null,
    body: plain.replace(/[ \t\f\v\r]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim().slice(0, BODY_CHARS),
  }
}

// ─── SENT label, metadata only (speed to lead; hub_236) ──────────────────────
/** Messages added to SENT since `startHistoryId`, and the cursor to store next (same paging as the inbox). */
export async function sentAddedSince(accessToken: string, startHistoryId: string): Promise<{ added: AddedMessage[]; historyId: string }> {
  const seen = new Map<string, AddedMessage>()
  let pageToken = ''
  let historyId = startHistoryId
  let lastRecordId = ''
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const q = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', labelId: 'SENT', maxResults: '500' })
    if (pageToken) q.set('pageToken', pageToken)
    const { status, data } = await gmailGet(accessToken, `/history?${q}`)
    if (status === 404) throw new MailError('Gmail history expired; sent-mail sync restarted from now.', 'history_expired')
    if (status !== 200) throw new MailError(`Gmail refused the history request (HTTP ${status}).`, 'gmail_error')
    for (const h of data.history ?? []) {
      if (/^\d+$/.test(String(h.id ?? ''))) lastRecordId = String(h.id)
      for (const a of h.messagesAdded ?? []) {
        const m = a.message ?? {}
        const labels: string[] = m.labelIds ?? []
        if (!labels.includes('SENT') || labels.includes('DRAFT')) continue
        if (/^[0-9a-f]{1,32}$/.test(m.id ?? '') && /^[0-9a-f]{1,32}$/.test(m.threadId ?? '')) seen.set(m.id, { id: m.id, threadId: m.threadId })
      }
    }
    pageToken = data.nextPageToken ?? ''
    if (!pageToken) {
      if (/^\d+$/.test(String(data.historyId ?? ''))) historyId = String(data.historyId)
      return { added: Array.from(seen.values()), historyId }
    }
  }
  return { added: Array.from(seen.values()), historyId: lastRecordId || historyId }
}

/** Split a To/Cc/Bcc header into lower-case addresses. */
export function parseAddressList(raw: string | undefined): string[] {
  if (!raw) return []
  const out = new Set<string>()
  for (const m of Array.from(raw.matchAll(/[^\s<>",;:()]+@[^\s<>",;:()]+\.[^\s<>",;:()]+/g))) {
    const a = m[0].toLowerCase().replace(/[.]+$/, '')
    if (a.length <= 320) out.add(a)
  }
  return Array.from(out)
}

/** A sent message's recipients and time. format=metadata with only the address headers: no subject, no body. */
export async function getSentMetadata(accessToken: string, id: string): Promise<{ recipients: string[]; sentAt: string | null }> {
  const q = new URLSearchParams({ format: 'metadata' })
  for (const h of ['To', 'Cc', 'Bcc']) q.append('metadataHeaders', h)
  const { status, data } = await gmailGet(accessToken, `/messages/${encodeURIComponent(id)}?${q}`)
  if (status === 404) throw new MailError('The message is no longer in Gmail.', 'message_gone')
  if (status !== 200) throw new MailError(`Gmail refused the message request (HTTP ${status}).`, 'gmail_error')
  const headers: { name: string; value: string }[] = data.payload?.headers ?? []
  const recipients = Array.from(new Set(headers.filter(h => /^(to|cc|bcc)$/i.test(h.name ?? '')).flatMap(h => parseAddressList(h.value))))
  const internal = Number(data.internalDate)
  return { recipients, sentAt: Number.isFinite(internal) && internal > 0 ? new Date(internal).toISOString() : null }
}
