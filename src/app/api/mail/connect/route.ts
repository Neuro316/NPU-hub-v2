// GET /api/mail/connect?orgId=<uuid>
// Starts Google OAuth for a Gmail mailbox. Superadmin only. The signed state ties the
// flow to this Hub user and org; its nonce also goes in an httpOnly cookie so the
// callback only completes in the browser that started it.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, forbidden } from '@/lib/api-guard'
import { authUrl, mintState, safeMessage, STATE_COOKIE } from '@/lib/mail/google'

export const dynamic = 'force-dynamic'

export const GET = withStaff(async (req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('Only a superadmin can connect a mailbox.')
  const orgId = requireOrg(ctx, req.nextUrl.searchParams.get('orgId'))
  if (orgId instanceof Response) return orgId
  try {
    const { state, nonce } = mintState(ctx.userId, orgId)
    const res = NextResponse.redirect(authUrl(req.nextUrl.origin, state))
    res.cookies.set(STATE_COOKIE, nonce, {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/api/mail/callback', maxAge: 600,
    })
    return res
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e) }, { status: 503 })
  }
})
