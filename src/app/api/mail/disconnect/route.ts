// POST /api/mail/disconnect {id}
// Revokes the grant at Google, then deletes the Vault secret and marks the row
// revoked. If Google cannot confirm the revocation, nothing is deleted locally so the
// call can be retried. Superadmin + visibility (owner, or a shared mailbox in the
// caller's org).
import { NextResponse } from 'next/server'
import { withStaff, forbidden } from '@/lib/api-guard'
import { loadVisible, refreshTokenFor, revokeToken, safeMessage, MailError } from '@/lib/mail/google'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('Mailboxes are managed by superadmins.')
  const body = await req.json().catch(() => ({}))
  const row = await loadVisible(ctx, body.id)
  if (!row) return NextResponse.json({ error: 'Mailbox not found.' }, { status: 404 })
  if (row.status === 'revoked') return NextResponse.json({ ok: true, status: 'revoked' })

  try {
    const token = await refreshTokenFor(ctx.db, row.id).catch(e => {
      // No secret means there is nothing left to revoke at Google.
      if (e instanceof MailError && e.code === 'no_secret') return ''
      throw e
    })
    await revokeToken(token)
  } catch (e) {
    console.error('[mail/disconnect] revoke failed:', e instanceof MailError ? e.code : 'unknown')
    return NextResponse.json({ error: safeMessage(e) }, { status: 502 })
  }

  const { error } = await ctx.db.rpc('hub_mail_connection_revoke', { p_connection_id: row.id })
  if (error) return NextResponse.json({ error: 'Access was revoked at Google, but the Hub record could not be updated. Try again.' }, { status: 500 })
  return NextResponse.json({ ok: true, status: 'revoked' })
})
