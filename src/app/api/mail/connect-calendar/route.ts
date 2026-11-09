// GET /api/mail/connect-calendar?connection_id=<uuid>
// Reconnects an existing Gmail mailbox with the two read-only Google Calendar scopes added (scheduling agent,
// phase 3). Only the mailbox's owner, and only a superadmin (the callback refuses anyone else). Mirrors
// /api/mail/connect: same signed state, same nonce cookie, same callback, which stores the new refresh token in
// Vault and the granted scopes on the row through hub_mail_connection_put.
//
// Differences from /api/mail/connect, all on the Google URL: scope = MAIL_SCOPES + CALENDAR_SCOPES,
// include_granted_scopes=true (the new grant keeps the Gmail scopes already given), and login_hint = the
// mailbox's own address so Google offers the right account.
import { NextResponse } from 'next/server'
import { withStaff, forbidden } from '@/lib/api-guard'
import { MAIL_DOMAIN, MAIL_SCOPES, mintState, redirectUri, safeMessage, STATE_COOKIE } from '@/lib/mail/google'
import { CALENDAR_SCOPES } from '@/lib/calendar/scopes'

export const dynamic = 'force-dynamic'

export const GET = withStaff(async (req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('Only a superadmin can connect a mailbox.')
  const id = req.nextUrl.searchParams.get('connection_id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Mailbox not found.' }, { status: 404 })
  const { data: row, error } = await ctx.db.from('hub_mail_connections')
    .select('id, org_id, owner_user_id, email_address, status').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: 'The mailbox could not be read. Try again.' }, { status: 503 })
  // 404, not 403, so a mailbox's existence is confirmed only to its owner
  if (!row || (row as any).owner_user_id !== ctx.userId) return NextResponse.json({ error: 'Mailbox not found.' }, { status: 404 })
  const orgId = (row as any).org_id as string
  if (!ctx.orgIds.includes(orgId)) return NextResponse.json({ error: 'You do not have access to that organization.' }, { status: 403 })

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'Gmail connections are not configured on this deployment.' }, { status: 503 })
  try {
    const { state, nonce } = mintState(ctx.userId, orgId)
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(req.nextUrl.origin),
      response_type: 'code',
      scope: [...MAIL_SCOPES, ...CALENDAR_SCOPES].join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      hd: MAIL_DOMAIN,
      login_hint: String((row as any).email_address),
      state,
    })
    const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`)
    res.cookies.set(STATE_COOKIE, nonce, {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/api/mail/callback', maxAge: 600,
    })
    return res
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e) }, { status: 503 })
  }
})
