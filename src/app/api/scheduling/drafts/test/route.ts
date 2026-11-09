// POST /api/scheduling/drafts/test {message_id}
//
// Superadmin only. Runs the scheduling reply-draft pipeline (src/lib/scheduling/drafts.ts) for ONE message, even
// when drafts are switched off, so the owner can try it before switching it on. It still never sends: the only
// Gmail write is a draft in the message's own thread, to its sender only. The message must be in a mailbox the
// caller may see (the inbox's visibility rule) and in the scheduling owner's active mailboxes.
// Returns {draft_status, gmail_draft_id} and a short code; never content.
import { NextResponse } from 'next/server'
import { withStaff, forbidden, bad } from '@/lib/api-guard'
import { loadVisible } from '@/lib/mail/google'
import { testDraftOne } from '@/lib/scheduling/drafts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notFound = () => NextResponse.json({ error: 'Not found.' }, { status: 404 })

export const POST = withStaff(async (req, ctx) => {
  if (!ctx.isSuperadmin) return forbidden('Draft tests are for superadmins.')
  const body = await req.json().catch(() => ({}))
  if (typeof body?.message_id !== 'string' || !UUID.test(body.message_id)) return bad('message_id is required.')
  const { data: msg } = await ctx.db.from('hub_mail_messages').select('id, connection_id').eq('id', body.message_id).maybeSingle()
  if (!msg || !(await loadVisible(ctx, (msg as any).connection_id))) return notFound()
  const r = await testDraftOne(ctx.db, (msg as any).id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ draft_status: r.draft_status, gmail_draft_id: r.gmail_draft_id, note: r.note })
})
