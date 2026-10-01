// src/lib/marketing/providers/resend.ts
// Resend over its REST API (no npm package: Hub CLAUDE.md requires approval for new
// packages, and one POST does not need a client library).
//
// RESEND_API_KEY is read at call time and never logged, so a rotated key needs no
// code change. Never logs the recipient or the body: send ids and codes only.
import type { EmailMessage, EmailProvider, ProviderResult } from './types'

const ENDPOINT = 'https://api.resend.com/emails'

/** Pure: the request Resend receives. Exported so the harness can assert the headers. */
export function buildResendRequest(msg: EmailMessage): { headers: Record<string, string>; body: Record<string, unknown> } | { refused: string } {
  if (msg.kind === 'marketing' && !msg.unsubscribeUrl) return { refused: 'marketing_without_unsubscribe' }
  const mailHeaders: Record<string, string> = {}
  if (msg.unsubscribeUrl) {
    mailHeaders['List-Unsubscribe'] = `<${msg.unsubscribeUrl}>`
    mailHeaders['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }
  return {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': msg.idempotencyKey },
    body: {
      from: msg.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text,
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      headers: mailHeaders,
      tags: [{ name: 'hub_send_id', value: msg.sendId.replace(/[^A-Za-z0-9_-]/g, '') }, { name: 'kind', value: msg.kind }],
    },
  }
}

export const resendProvider: EmailProvider = {
  name: 'resend',
  async send(msg: EmailMessage): Promise<ProviderResult> {
    const key = process.env.RESEND_API_KEY
    if (!key || !key.trim()) return { ok: false, provider: 'resend', permanent: false, ambiguous: false, code: 'resend_key_missing' }
    const req = buildResendRequest(msg)
    if ('refused' in req) return { ok: false, provider: 'resend', permanent: true, ambiguous: false, code: req.refused }
    let res: Response
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { ...req.headers, Authorization: `Bearer ${key}` },
        body: JSON.stringify(req.body),
      })
    } catch (e: any) {
      console.error(`[resend] send=${msg.sendId} network error ${e?.name ?? 'Error'}`)
      return { ok: false, provider: 'resend', permanent: false, ambiguous: true, code: 'resend_network' }
    }
    const json: any = await res.json().catch(() => ({}))
    if (res.ok && typeof json?.id === 'string') return { ok: true, provider: 'resend', externalId: json.id }
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429
    console.error(`[resend] send=${msg.sendId} status=${res.status} name=${String(json?.name ?? '-').slice(0, 60)}`)
    return { ok: false, provider: 'resend', permanent, ambiguous: res.status >= 500, code: `resend_${res.status}` }
  },
}
