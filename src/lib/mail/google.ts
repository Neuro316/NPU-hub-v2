// src/lib/mail/google.ts
// Google OAuth + Gmail plumbing for connected mailboxes (inbox agent phase 1,
// docs/plans/hub-gmail-mailboxes-rulings.md).
//
// HARD RULE: no token and no message content ever leaves this file in a log line,
// a response body or an error message. Every failure here becomes a MailError with
// a fixed, Hub-written message; Google's response bodies are never echoed, because
// a token endpoint error can quote the grant that was sent.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { StaffContext } from '@/lib/api-guard'

export const MAIL_DOMAIN = 'neuroprogeny.com'
export const MAIL_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
]
const REQUIRED_GRANTS = MAIL_SCOPES.slice(2)
export const STATE_COOKIE = 'npu_mail_oauth'
const STATE_TTL_MS = 10 * 60 * 1000

export class MailError extends Error {
  constructor(message: string, readonly code: string) { super(message) }
}

function oauthClient(): { id: string; secret: string } {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!id || !secret) throw new MailError('Gmail connections are not configured on this deployment.', 'not_configured')
  return { id, secret }
}

/** Same host for connect and callback, so the session cookie is present on return. */
export function redirectUri(origin: string): string {
  return `${origin}/api/mail/callback`
}

// ─── signed state ────────────────────────────────────────────────────────────
// state = b64url(json{u,o,n,e}).b64url(hmac). The key is derived from the OAuth client
// secret under a fixed label, so no extra env var is needed and rotating the client
// secret invalidates in-flight states. `n` is also set in an httpOnly cookie, which
// binds the flow to the browser that started it as well as to the Hub user.
interface StatePayload { u: string; o: string; n: string; e: number }

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function stateMac(body: string): string {
  const key = createHmac('sha256', oauthClient().secret).update('npu-hub:mail-oauth-state:v1').digest()
  return b64url(createHmac('sha256', key).update(body).digest())
}

export function mintState(userId: string, orgId: string): { state: string; nonce: string } {
  const nonce = b64url(randomBytes(24))
  const body = b64url(Buffer.from(JSON.stringify({ u: userId, o: orgId, n: nonce, e: Date.now() + STATE_TTL_MS })))
  return { state: `${body}.${stateMac(body)}`, nonce }
}

/** The org id from a genuine, unexpired state issued to this user in this browser; else null. */
export function verifyState(state: string | null, userId: string, cookieNonce: string | undefined): string | null {
  if (!state || !cookieNonce) return null
  const [body, mac] = state.split('.')
  if (!body || !mac) return null
  const want = Buffer.from(stateMac(body))
  const got = Buffer.from(mac)
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  let p: StatePayload
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) } catch { return null }
  const n1 = Buffer.from(String(p.n)), n2 = Buffer.from(cookieNonce)
  if (n1.length !== n2.length || !timingSafeEqual(n1, n2)) return null
  if (p.u !== userId || typeof p.o !== 'string' || !(p.e > Date.now())) return null
  return p.o
}

export function authUrl(origin: string, state: string): string {
  const q = new URLSearchParams({
    client_id: oauthClient().id,
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: MAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    hd: MAIL_DOMAIN,
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}

// ─── token endpoint ──────────────────────────────────────────────────────────
interface CodeExchange { refreshToken: string; accessToken: string; email: string; scopes: string[] }

async function tokenRequest(params: Record<string, string>): Promise<any> {
  const { id, secret } = oauthClient()
  let res: Response
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
      cache: 'no-store',
    })
  } catch {
    throw new MailError('Google could not be reached. Try again.', 'network')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Only Google's short error code is kept, and only from a fixed list.
    const code = ['invalid_grant', 'invalid_client', 'unauthorized_client'].includes(data?.error) ? data.error : 'token_error'
    const msg = code === 'invalid_grant'
      ? 'Google no longer accepts this connection. Disconnect and connect again.'
      : 'Google refused the token request.'
    throw new MailError(msg, code)
  }
  return data
}

/** The id_token's claims. It came straight from Google's token endpoint over TLS, so
 *  OpenID Connect Core 3.1.3.7 allows reading it without verifying the signature. */
function idClaims(idToken: unknown): Record<string, any> {
  if (typeof idToken !== 'string') return {}
  try { return JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) } catch { return {} }
}

export async function exchangeCode(code: string, origin: string): Promise<CodeExchange> {
  const data = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri(origin) })
  const claims = idClaims(data.id_token)
  const email = String(claims.email ?? '').toLowerCase()
  const scopes = String(data.scope ?? '').split(' ').filter(Boolean)
  const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : ''
  const accessToken = typeof data.access_token === 'string' ? data.access_token : ''

  const reject = async (msg: string, c: string): Promise<never> => {
    await revokeToken(refreshToken || accessToken).catch(() => {})
    throw new MailError(msg, c)
  }
  if (!email.endsWith(`@${MAIL_DOMAIN}`) || claims.email_verified !== true || claims.hd !== MAIL_DOMAIN) {
    return reject(`Only @${MAIL_DOMAIN} Google accounts can be connected.`, 'wrong_domain')
  }
  if (!REQUIRED_GRANTS.every(s => scopes.includes(s))) {
    return reject('Gmail read and send access were not both granted. Connect again and allow both.', 'missing_scope')
  }
  if (!refreshToken) return reject('Google did not return offline access. Connect again.', 'no_refresh_token')
  return { refreshToken, accessToken, email, scopes }
}

export async function accessTokenFor(refreshToken: string): Promise<string> {
  const data = await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' })
  if (typeof data.access_token !== 'string') throw new MailError('Google refused the token request.', 'token_error')
  return data.access_token
}

/** Revokes the grant at Google. An already-dead token (400) counts as revoked. */
export async function revokeToken(token: string): Promise<void> {
  if (!token) return
  let res: Response
  try {
    res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      cache: 'no-store',
    })
  } catch {
    throw new MailError('Google could not be reached to revoke access. Try again.', 'network')
  }
  if (!res.ok && res.status !== 400) throw new MailError('Google did not confirm the revocation. Try again.', 'revoke_failed')
}

/** users.getProfile: only the two fields phase 1 needs. */
export async function gmailProfile(accessToken: string): Promise<{ emailAddress: string; messagesTotal: number }> {
  let res: Response
  try {
    res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
  } catch {
    throw new MailError('Gmail could not be reached. Try again.', 'network')
  }
  if (!res.ok) throw new MailError(`Gmail refused the profile request (HTTP ${res.status}).`, 'gmail_error')
  const p = await res.json().catch(() => ({}))
  return { emailAddress: String(p.emailAddress ?? ''), messagesTotal: Number(p.messagesTotal ?? 0) }
}

// ─── access rules ────────────────────────────────────────────────────────────
export interface MailConnectionRow {
  id: string
  org_id: string
  owner_user_id: string
  email_address: string
  visibility: 'private' | 'shared'
  status: 'active' | 'revoked' | 'error'
  scopes: string[]
  connected_at: string
  last_checked_at: string | null
  last_error: string | null
}

export const CONNECTION_COLUMNS =
  'id, org_id, owner_user_id, email_address, visibility, status, scopes, connected_at, last_checked_at, last_error'

/** Private: owner only. Shared: any superadmin who belongs to the row's org. */
export function canSee(ctx: StaffContext, row: Pick<MailConnectionRow, 'owner_user_id' | 'visibility' | 'org_id'>): boolean {
  if (!ctx.isSuperadmin) return false
  if (row.owner_user_id === ctx.userId) return true
  return row.visibility === 'shared' && ctx.orgIds.includes(row.org_id)
}

/** The connection the caller may act on, or null (callers answer 404, not 403, so a
 *  private mailbox's existence is not confirmed to anyone but its owner). */
export async function loadVisible(ctx: StaffContext, id: unknown): Promise<MailConnectionRow | null> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data } = await ctx.db.from('hub_mail_connections').select(CONNECTION_COLUMNS).eq('id', id).maybeSingle()
  return data && canSee(ctx, data as MailConnectionRow) ? (data as MailConnectionRow) : null
}

export async function refreshTokenFor(db: SupabaseClient, id: string): Promise<string> {
  const { data, error } = await db.rpc('hub_mail_token_get', { p_connection_id: id })
  if (error || typeof data !== 'string' || !data) throw new MailError('The stored credential for this mailbox is missing. Reconnect it.', 'no_secret')
  return data
}

export function safeMessage(e: unknown): string {
  return e instanceof MailError ? e.message : 'Something went wrong with the mailbox request.'
}
