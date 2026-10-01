// /api/email/unsubscribe  (PUBLIC, exact path in middleware; ruling 14)
//
// GET  ?t=<token>  shows a confirmation page with one button.
// POST ?t=<token>  unsubscribes. This is also the RFC 8058 one-click target named in
//                  every marketing email's List-Unsubscribe header, which mail
//                  providers POST with body "List-Unsubscribe=One-Click".
//
// The token names a message_sends row and is HMAC-signed (src/lib/marketing/tokens.ts);
// it carries no personal data. An unsubscribe is never refused for a flag: it calls
// public.record_consent, which is not flag-gated, and which suppresses marketing email
// for that address at once. Reads and writes nothing else about the person, and
// returns nothing about them.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { verifyUnsubscribeToken } from '@/lib/marketing/tokens'

export const dynamic = 'force-dynamic'

const page = (title: string, body: string, status = 200) => new NextResponse(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:Inter,system-ui,sans-serif;background:#f8fafc;color:#1e293b;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
main{background:#fff;border:1px solid #e2e8f0;border-radius:12px;max-width:420px;padding:28px}h1{font-size:20px;margin:0 0 12px}p{line-height:1.5;margin:0 0 16px}
button{background:#228DC4;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:15px;cursor:pointer}</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })

export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get('t') || ''
  if (!verifyUnsubscribeToken(t)) {
    return page('This link is not valid', '<p>This unsubscribe link could not be confirmed. Reply to any email from us and we will remove you by hand.</p>', 400)
  }
  return page('Stop these emails?', `<p>Press the button below and we will stop sending you marketing emails. Messages about things you have booked or bought will still reach you.</p>
<form method="post" action="/api/email/unsubscribe?t=${encodeURIComponent(t)}"><button type="submit">Unsubscribe me</button></form>`)
}

export async function POST(req: NextRequest) {
  const t = req.nextUrl.searchParams.get('t') || ''
  const sendId = verifyUnsubscribeToken(t)
  const oneClick = (await req.text().catch(() => '')).includes('List-Unsubscribe=One-Click')
  if (!sendId) {
    return oneClick ? new NextResponse('invalid', { status: 400 })
      : page('This link is not valid', '<p>This unsubscribe link could not be confirmed. Reply to any email from us and we will remove you by hand.</p>', 400)
  }
  const db = createAdminSupabase()
  const { data: send, error } = await db.from('message_sends').select('id, org_id, contact_id, to_address, channel').eq('id', sendId).maybeSingle()
  if (error || !send || send.channel !== 'email') {
    console.error(`[unsubscribe] send=${sendId} lookup ${error ? `error ${error.code ?? 'unknown'}` : 'not found'}`)
    return oneClick ? new NextResponse('error', { status: 500 })
      : page('Something went wrong', '<p>We could not record your request just now. Reply to any email from us and we will remove you by hand.</p>', 500)
  }
  let ok = false
  if (send.contact_id) {
    const { error: cErr } = await db.rpc('record_consent', {
      p_contact: send.contact_id, p_channel: 'email', p_kind: 'marketing', p_action: 'revoked', p_basis: 'unsubscribe',
      p_source: 'unsubscribe_link', p_text_shown: null, p_evidence: { send_id: send.id, one_click: oneClick },
    })
    ok = !cErr
    if (cErr) console.error(`[unsubscribe] send=${sendId} record_consent error ${cErr.code ?? 'unknown'}`)
  }
  // Always suppress the address this email was actually sent to as well: the contact may
  // have been deleted, or its email changed since, and record_consent suppresses the
  // contact's CURRENT address. 23505 means it is already suppressed.
  const { error: sErr } = await db.from('suppressions').insert({ org_id: send.org_id, channel: 'email',
    address: send.to_address, scope: 'marketing', reason: 'unsubscribe', source: 'unsubscribe_link' })
  if (!send.contact_id) ok = !sErr || sErr.code === '23505'
  else if (sErr && sErr.code !== '23505') console.error(`[unsubscribe] send=${sendId} address suppression error ${sErr.code ?? 'unknown'}`)
  if (!ok) {
    return oneClick ? new NextResponse('error', { status: 500 })
      : page('Something went wrong', '<p>We could not record your request just now. Reply to any email from us and we will remove you by hand.</p>', 500)
  }
  return oneClick ? new NextResponse('ok', { status: 200 })
    : page('You are unsubscribed', '<p>You will not receive marketing emails from us again. Thank you for letting us know.</p>')
}
