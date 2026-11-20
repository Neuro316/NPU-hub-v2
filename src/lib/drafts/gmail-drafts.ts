// src/lib/drafts/gmail-drafts.ts
// The Gmail calls drafting makes, and ONLY these (q10 drafts, docs/plans/support-drafts.md A3):
//   POST   /users/me/drafts            drafts.create: a reply saved as a draft in the original thread
//   GET    /users/me/drafts/{id}       drafts.get: does the draft still exist, and (in memory only) its text
//   DELETE /users/me/drafts/{id}       drafts.delete: a rejected draft is removed from Gmail
// Never messages.send and never drafts.send: the Hub does not send. Failures become MailError with a fixed message;
// no token, header value or text is logged.
import { MailError } from '@/lib/mail/google'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

const noCrlf = (s: string) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim()
const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`)
const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, (m) => `${m}\r\n`).trimEnd()

/** A plain-text reply. In-Reply-To and References name the original, so Gmail files it in the same thread. */
export function buildReplyMime(o: { from: string; to: string; subject: string; text: string; inReplyTo: string | null; references: string | null }): string {
  const refs = [o.references, o.inReplyTo].filter(Boolean).join(' ').trim()
  const head = [
    `From: ${noCrlf(o.from)}`,
    `To: ${noCrlf(o.to)}`,
    `Subject: ${encodeWord(noCrlf(o.subject))}`,
    ...(o.inReplyTo ? [`In-Reply-To: ${noCrlf(o.inReplyTo)}`] : []),
    ...(refs ? [`References: ${noCrlf(refs)}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(o.text, 'utf8').toString('base64')),
    '',
  ].join('\r\n')
  return Buffer.from(head, 'utf8').toString('base64url')
}

export type GmailCall = (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) => Promise<{ status: number; data: any }>

/** The live caller for one mailbox's access token. Only the three paths above are ever passed to it. */
export function gmailCaller(accessToken: string): GmailCall {
  return async (method, path, body) => {
    let res: Response
    try {
      res = await fetch(`${API}${path}`, {
        method, cache: 'no-store',
        headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch {
      throw new MailError('Gmail could not be reached. Try again.', 'network')
    }
    return { status: res.status, data: res.status === 204 ? {} : await res.json().catch(() => ({})) }
  }
}

/** drafts.create in the original thread. Returns the draft id and its message id (the pointer the Hub keeps). */
export async function createDraft(gmail: GmailCall, raw: string, threadId: string): Promise<{ draftId: string; messageId: string | null }> {
  const { status, data } = await gmail('POST', '/drafts', { message: { raw, threadId } })
  if (status !== 200 || typeof data?.id !== 'string') throw new MailError(`Gmail refused the draft (HTTP ${status}).`, 'gmail_error')
  return { draftId: data.id, messageId: typeof data.message?.id === 'string' ? data.message.id : null }
}

/** drafts.delete. A draft already gone counts as deleted. */
export async function deleteDraft(gmail: GmailCall, draftId: string): Promise<void> {
  const { status } = await gmail('DELETE', `/drafts/${encodeURIComponent(draftId)}`)
  if (status !== 204 && status !== 200 && status !== 404) throw new MailError(`Gmail refused to delete the draft (HTTP ${status}).`, 'gmail_error')
}

/** drafts.get: null when the draft no longer exists (sent or deleted). The text is returned in memory only. */
export async function getDraftText(gmail: GmailCall, draftId: string): Promise<string | null> {
  const { status, data } = await gmail('GET', `/drafts/${encodeURIComponent(draftId)}?format=full`)
  if (status === 404) return null
  if (status !== 200) throw new MailError(`Gmail refused the draft request (HTTP ${status}).`, 'gmail_error')
  const find = (p: any): string => {
    if (!p) return ''
    if (p.mimeType === 'text/plain' && p.body?.data) { try { return Buffer.from(p.body.data, 'base64url').toString('utf8') } catch { return '' } }
    for (const c of p.parts ?? []) { const t = find(c); if (t) return t }
    return ''
  }
  return find(data?.message?.payload).slice(0, 8000)
}
