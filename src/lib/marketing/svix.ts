// src/lib/marketing/svix.ts
// Verifies a Resend webhook (Resend signs with Svix). Pure, so the harness can prove
// that unsigned, re-signed and stale requests are refused.
//
//   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
//   key            = base64-decode(secret without the "whsec_" prefix)
//   header         = space-separated list of "v1,<base64 hmac-sha256>"
import { createHmac, timingSafeEqual } from 'node:crypto'

export const SVIX_TOLERANCE_SECONDS = 300

export type SvixResult = { ok: true } | { ok: false; reason: string }

export function verifySvix(
  secret: string | undefined,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  nowSeconds: number,
): SvixResult {
  if (!secret || !secret.startsWith('whsec_')) return { ok: false, reason: 'secret_missing' }
  if (!headers.id || !headers.timestamp || !headers.signature) return { ok: false, reason: 'unsigned' }
  const ts = Number(headers.timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > SVIX_TOLERANCE_SECONDS) return { ok: false, reason: 'stale' }
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64')
  const want = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest()
  for (const part of headers.signature.split(' ')) {
    const [ver, sig] = part.split(',')
    if (ver !== 'v1' || !sig) continue
    const got = Buffer.from(sig, 'base64')
    if (got.length === want.length && timingSafeEqual(got, want)) return { ok: true }
  }
  return { ok: false, reason: 'bad_signature' }
}
