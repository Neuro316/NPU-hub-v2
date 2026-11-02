// GET /api/mail/callback
// Google's redirect after consent. Verifies the signed state against this user and
// browser, exchanges the code, rejects anything but a verified @neuroprogeny.com
// account with both Gmail scopes, then writes the refresh token to Vault and the
// connection row in one database call. Always ends with a redirect to Settings
// carrying only a fixed outcome code.
import { NextResponse } from 'next/server'
import { withStaff } from '@/lib/api-guard'
import { exchangeCode, revokeToken, verifyState, MailError, STATE_COOKIE } from '@/lib/mail/google'

export const dynamic = 'force-dynamic'

export const GET = withStaff(async (req, ctx) => {
  const back = (outcome: string) => {
    const res = NextResponse.redirect(new URL(`/settings?section=mailboxes&mail=${outcome}`, req.nextUrl.origin))
    res.cookies.set(STATE_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/mail/callback', maxAge: 0 })
    return res
  }
  if (!ctx.isSuperadmin) return back('forbidden')

  const q = req.nextUrl.searchParams
  let orgId: string | null
  try {
    orgId = verifyState(q.get('state'), ctx.userId, req.cookies.get(STATE_COOKIE)?.value)
  } catch {
    return back('not_configured')
  }
  if (!orgId || !ctx.orgIds.includes(orgId)) return back('bad_state')
  if (q.get('error')) return back('denied')
  const code = q.get('code')
  if (!code) return back('denied')

  let grant
  try {
    grant = await exchangeCode(code, req.nextUrl.origin)
  } catch (e) {
    const c = e instanceof MailError ? e.code : 'token_error'
    console.error('[mail/callback] exchange failed:', c)
    return back(c)
  }

  const { error } = await ctx.db.rpc('hub_mail_connection_put', {
    p_org_id: orgId,
    p_owner: ctx.userId,
    p_email: grant.email,
    p_secret: grant.refreshToken,
    p_scopes: grant.scopes,
  })
  if (error) {
    // Nothing was stored, so the grant Google just issued must not outlive this request.
    await revokeToken(grant.refreshToken).catch(() => {})
    const owned = /mailbox_owned_by_other/.test(error.message ?? '')
    console.error('[mail/callback] store failed:', owned ? 'owned_by_other' : error.code)
    return back(owned ? 'owned_by_other' : 'store_failed')
  }
  return back('connected')
})
