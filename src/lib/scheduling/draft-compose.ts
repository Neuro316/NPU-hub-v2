// src/lib/scheduling/draft-compose.ts
// Pure: the text, the recipient choice and the RFC 2822 message for a scheduling reply DRAFT
// (src/lib/scheduling/drafts.ts). No I/O and no imports, so scripts/scheduling/drafts-check.mjs runs it directly.
//
// Rules this file enforces:
//   - the reply is short and plain, and never contains an em or en dash (assertNoDash throws)
//   - the incoming message is never quoted: the builders take no body text at all
//   - exactly ONE recipient: the sender (or their Reply-To when it is on the sender's own domain). No Cc, no Bcc,
//     no attachments, nothing forwarded
//   - every header value is stripped of CR and LF, so nothing can be injected

export type DraftCategory = 'one_on_one' | 'podcast' | 'in_person' | 'group_coaching' | 'team_familiar'

export const SENSITIVE = /personal|family|legal|lawyer|attorney|contract|invoice|payment|tax|medical|clinical|diagnos|therap|prescri/i
const PODCAST = /podcast|episode|interview|show/i
const IN_PERSON = /in[- ]person|coffee|lunch|visit|meet up|on site/i
const DASHES = /[–—]/

export function isSensitive(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => typeof t === 'string' && SENSITIVE.test(t))
}

export function draftCategory(p: { trustedSender: boolean; subject?: string | null; summary?: string | null }): DraftCategory {
  if (p.trustedSender) return 'team_familiar'
  const text = `${p.subject ?? ''}\n${p.summary ?? ''}`
  if (PODCAST.test(text)) return 'podcast'
  if (IN_PERSON.test(text)) return 'in_person'
  return 'one_on_one'
}

export function assertNoDash(s: string): string {
  if (DASHES.test(s)) throw new Error('dash_in_draft')
  return s
}

/** The first name from a display name, or null when there is nothing name-like. */
export function firstName(fromName: string | null | undefined): string | null {
  if (typeof fromName !== 'string') return null
  const cleaned = fromName.replace(/["'`]/g, ' ').trim()
  if (!cleaned || /@/.test(cleaned)) return null
  // "Last, First" → First
  const comma = cleaned.split(',')
  const part = comma.length === 2 && comma[1].trim() ? comma[1].trim() : cleaned
  const token = part.split(/\s+/)[0] ?? ''
  if (!/^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ.-]{0,39}$/.test(token)) return null
  const t = token.replace(/\.+$/, '')
  if (t.length < 2) return null
  return t === t.toUpperCase() || t === t.toLowerCase() ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t
}

const greeting = (first: string | null) => (first ? `Hi ${first},` : 'Hi there,')

export function slotsText(first: string | null, labels: string[]): string {
  if (!labels.length) throw new Error('no_slots')
  return assertNoDash(
    `${greeting(first)}\n\nThanks for reaching out. Here are a few times that work on my end (Eastern):\n\n` +
    `${labels.join('\n')}\n\nLet me know which works best and I'll send an invite.\n\nCameron`,
  )
}

export function linkText(first: string | null, url: string): string {
  if (!/^https:\/\/[^\s"'<>]+$/.test(url)) throw new Error('bad_url')
  return assertNoDash(
    `${greeting(first)}\n\nThanks for reaching out. The easiest way to find a time is my booking page: ${url}\n\nLooking forward to it.\n\nCameron`,
  )
}

/** The owner's text when no slot is open: first name only, never the address or subject. */
export function exceptionSms(first: string | null, appUrl: string): string {
  return assertNoDash(`Scheduling: no open time for a request from ${first ?? 'a new sender'}. Approve or decline in the Hub: ${appUrl.replace(/\/+$/, '')}/mail`)
}

// ─── addresses ───────────────────────────────────────────────────────────────
const ADDRESS = /^[A-Za-z0-9.!#$%&*+/=?^_{|}~'-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$/

/** Every address in a header like `"A" <a@x.com>, b@y.com`. Quoted display names may hold commas. */
export function parseAddresses(header: string | null | undefined): string[] {
  if (typeof header !== 'string' || !header.trim()) return []
  const noQuoted = header.replace(/"(?:[^"\\]|\\.)*"/g, '""')
  const out: string[] = []
  for (const piece of noQuoted.split(/[,;]/)) {
    const m = /<([^<>]*)>/.exec(piece)
    const addr = (m ? m[1] : piece).trim().toLowerCase()
    if (addr) out.push(addr)
  }
  return out
}

export const isAddress = (a: string) => ADDRESS.test(a) && a.length <= 254
const domainOf = (a: string) => a.slice(a.lastIndexOf('@') + 1).toLowerCase()

/**
 * The ONE address the draft goes to. Reply-To wins only when it is a single address on the same domain as From;
 * otherwise From. Null when From is not exactly one valid address.
 */
export function chooseRecipient(fromHeader: string | null | undefined, replyToHeader: string | null | undefined): string | null {
  const from = parseAddresses(fromHeader)
  if (from.length !== 1 || !isAddress(from[0])) return null
  const rt = parseAddresses(replyToHeader)
  if (rt.length === 1 && isAddress(rt[0]) && domainOf(rt[0]) === domainOf(from[0])) return rt[0]
  return from[0]
}

// ─── the message ─────────────────────────────────────────────────────────────
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()

export function replySubject(subject: string | null | undefined): string {
  const s = oneLine(typeof subject === 'string' ? subject : '')
  if (!s) return 'Re: Scheduling'
  return /^re\s*:/i.test(s) ? s : `Re: ${s}`
}

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s)

function b64(s: string): string {
  // UTF-8 bytes, then base64, without Buffer (so this stays importable anywhere)
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export function base64url(s: string): string {
  return b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** RFC 2047 for a non-ASCII subject. */
export function encodeHeader(v: string): string {
  return isAscii(v) ? v : `=?UTF-8?B?${b64(v)}?=`
}

export interface DraftMessage {
  from: string
  to: string
  subject: string | null
  messageId: string | null
  body: string
}

/** RFC 2822, UTF-8, text/plain, CRLF. One To, no Cc/Bcc, In-Reply-To and References only when the id is sane. */
export function buildRfc2822(m: DraftMessage): string {
  const from = oneLine(m.from).toLowerCase()
  const to = oneLine(m.to).toLowerCase()
  if (!isAddress(from)) throw new Error('bad_from')
  if (!isAddress(to)) throw new Error('bad_to')
  assertNoDash(m.body)
  const mid = typeof m.messageId === 'string' ? oneLine(m.messageId) : ''
  const validMid = /^<[^<>\s]{1,900}>$/.test(mid)
  const body = m.body.replace(/\r?\n/g, '\r\n')
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(replySubject(m.subject))}`,
    ...(validMid ? [`In-Reply-To: ${mid}`, `References: ${mid}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ]
  const encoded = (b64(body).match(/.{1,76}/g) ?? []).join('\r\n')
  return `${lines.join('\r\n')}\r\n\r\n${encoded}\r\n`
}
