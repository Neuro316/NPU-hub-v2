// src/lib/lead-devices/turnstile.ts
// Server-side Cloudflare Turnstile check. Ported from the University platform at 9bb18cba
// (src/lib/public-mode/turnstile.ts). An unset secret is a refusal, never a pass: a public write path
// with no challenge is worse than a broken page, because the page announces itself.
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileResult = { ok: true } | { ok: false; code: 'not_configured' | 'missing_token' | 'rejected' | 'unreachable' }

export async function verifyTurnstile(token: unknown, remoteIp: string | null, env: Record<string, string | undefined> = process.env): Promise<TurnstileResult> {
  const secret = env.TURNSTILE_SECRET_KEY
  if (!secret) return { ok: false, code: 'not_configured' }
  if (typeof token !== 'string' || !token.trim()) return { ok: false, code: 'missing_token' }
  const body = new URLSearchParams({ secret, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)
  let json: any
  try {
    const res = await fetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    })
    json = await res.json()
  } catch {
    return { ok: false, code: 'unreachable' }
  }
  return json?.success === true ? { ok: true } : { ok: false, code: 'rejected' }
}
