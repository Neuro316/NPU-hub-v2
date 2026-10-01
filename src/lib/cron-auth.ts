// src/lib/cron-auth.ts
// The fail-closed cron check, the same rule /api/cron/sms-outbox applies inline:
// an unset or empty CRON_SECRET refuses every request (rather than accepting the
// literal "Bearer undefined"), and the comparison is constant time. Every cron
// this build adds calls this, and scripts/guards checks that they do.
import { createHash, timingSafeEqual } from 'node:crypto'

export function cronAuthorized(req: Request, label: string): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !secret.trim()) {
    console.error(`[${label}] CRON_SECRET is not set on this host; refusing every request`)
    return false
  }
  const got = createHash('sha256').update(req.headers.get('authorization') || '').digest()
  const want = createHash('sha256').update(`Bearer ${secret}`).digest()
  return got.length === want.length && timingSafeEqual(got, want)
}
