// POST /api/mail/check {id}
// Health check: Gmail users.getProfile for one connection. Success records
// last_checked_at; failure records last_error (a fixed Hub message). Returns only
// emailAddress and messagesTotal. Superadmin + visibility.
import { NextResponse } from 'next/server'
import { withStaff, forbidden } from '@/lib/api-guard'
import { accessTokenFor, gmailProfile, loadVisible, refreshTokenFor, safeMessage, MailError } from '@/lib/mail/google'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('Mailboxes are managed by superadmins.')
  const body = await req.json().catch(() => ({}))
  const row = await loadVisible(ctx, body.id)
  if (!row) return NextResponse.json({ error: 'Mailbox not found.' }, { status: 404 })
  if (row.status === 'revoked') return NextResponse.json({ error: 'This mailbox is disconnected. Connect it again first.' }, { status: 409 })

  try {
    const profile = await gmailProfile(await accessTokenFor(await refreshTokenFor(ctx.db, row.id)))
    if (profile.emailAddress.toLowerCase() !== row.email_address) {
      throw new MailError('Gmail answered for a different address than the one connected.', 'address_mismatch')
    }
    await ctx.db.from('hub_mail_connections')
      .update({ status: 'active', last_checked_at: new Date().toISOString(), last_error: null })
      .eq('id', row.id)
    return NextResponse.json({ emailAddress: profile.emailAddress, messagesTotal: profile.messagesTotal })
  } catch (e) {
    const code = e instanceof MailError ? e.code : 'unknown'
    const message = safeMessage(e)
    console.error('[mail/check] failed:', code)
    // A dead grant or missing secret will not heal on retry; a network blip might.
    const dead = ['invalid_grant', 'no_secret', 'address_mismatch'].includes(code)
    await ctx.db.from('hub_mail_connections')
      .update({ last_error: message.slice(0, 300), ...(dead ? { status: 'error' } : {}) })
      .eq('id', row.id)
    return NextResponse.json({ error: message }, { status: 502 })
  }
})
