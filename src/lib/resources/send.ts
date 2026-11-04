// src/lib/resources/send.ts
// MIME build and the Gmail send for "Send resources" (Build 2). Mail goes through Gmail's
// upload endpoint as message/rfc822 (up to 35 MB), so it lands in the mailbox's Sent folder
// and replies come back to it.
//
// HARD RULE: no token, URL or message content in a log line, a response or an error
// message. Failures become MailError with a fixed, Hub-written message.
import { randomBytes } from 'node:crypto'
import { MailError } from '@/lib/mail/google'

export interface MimeAttachment { file_name: string; mime_type: string; data: Buffer }

const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s)
const encodeWord = (s: string) => (ascii(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`)
const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n')
const noCrlf = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()

function dispositionName(name: string): string {
  const clean = noCrlf(name).replace(/["\\]/g, '_')
  const fallback = clean.replace(/[^\x20-\x7e]/g, '_')
  return ascii(clean) ? `filename="${clean}"` : `filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(clean)}`
}

export function buildMime(opts: { from: string; to: string; subject: string; text: string; html: string; attachments: MimeAttachment[] }): Buffer {
  const mixed = `mixed_${randomBytes(12).toString('hex')}`
  const alt = `alt_${randomBytes(12).toString('hex')}`
  const head = [
    `From: ${noCrlf(opts.from)}`,
    `To: ${noCrlf(opts.to)}`,
    `Subject: ${encodeWord(noCrlf(opts.subject))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(opts.text, 'utf8').toString('base64')),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(opts.html, 'utf8').toString('base64')),
    `--${alt}--`,
    '',
  ].join('\r\n')
  const parts: Buffer[] = [Buffer.from(head, 'utf8')]
  for (const a of opts.attachments) {
    parts.push(Buffer.from([
      `--${mixed}`,
      `Content-Type: ${a.mime_type}; name="${noCrlf(a.file_name).replace(/["\\]/g, '_').replace(/[^\x20-\x7e]/g, '_')}"`,
      `Content-Disposition: attachment; ${dispositionName(a.file_name)}`,
      'Content-Transfer-Encoding: base64',
      '',
      '',
    ].join('\r\n'), 'utf8'))
    parts.push(Buffer.from(wrap76(a.data.toString('base64')), 'utf8'))
  }
  parts.push(Buffer.from(`--${mixed}--\r\n`, 'utf8'))
  return Buffer.concat(parts)
}

/** Sends a raw RFC 822 message; returns Gmail's message id. */
export async function gmailSendRaw(accessToken: string, raw: Buffer): Promise<string> {
  let res: Response
  try {
    res = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'message/rfc822' },
      body: new Uint8Array(raw),
      cache: 'no-store',
    })
  } catch {
    throw new MailError('Gmail could not be reached. Nothing was sent; try again.', 'network')
  }
  if (!res.ok) throw new MailError(`Gmail refused the message (HTTP ${res.status}). Nothing was sent.`, 'gmail_error')
  const data = await res.json().catch(() => ({}))
  return typeof data.id === 'string' ? data.id : ''
}
