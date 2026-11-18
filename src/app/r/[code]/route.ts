// GET /r/<code>  (PUBLIC, Running List q33; listed in src/lib/supabase-middleware.ts as /r/ + 12 letters or digits)
//
// A tracked resource link made on a contact's card (Share a resource). Accepts only a well-formed code that
// exists, is not revoked, and whose resource is active (not retired). It records the click time on the link's
// own contact and redirects: a link resource to its stored https address, a file resource to a 10-minute signed
// URL minted now (the bucket stays private). Anything else gets the same plain "not available" page.
//
// Nothing about the visitor is read or stored: no IP address, user agent, referrer or cookie. Rate limited per
// code and for unknown codes, per server instance (src/lib/resources/links.ts clickLimiter).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { RESOURCE_BUCKET } from '@/lib/resources/common'
import { recordClick, clickLimiter, CODE_RE } from '@/lib/resources/links'

export const dynamic = 'force-dynamic'

const FILE_SECONDS = 10 * 60
const limiter = clickLimiter()

const page = (status: number, title: string, text: string) => new NextResponse(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="font-family:Inter,system-ui,sans-serif;background:#f8fafc;color:#1e293b;padding:40px 16px;text-align:center">
<h1 style="font-size:20px">${title}</h1><p>${text}</p></body></html>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })

const unavailable = () => page(404, 'This link is not available', 'Reply to the message that brought you here and we will send you a fresh one.')
const busy = () => page(429, 'Too many requests', 'Please wait a minute and try again.')

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const code = String(params?.code || '')
  if (!CODE_RE.test(code)) return limiter.allowMiss() ? unavailable() : busy()
  if (!limiter.allowCode(code)) return busy()
  const db = createAdminSupabase()
  const r = await recordClick(db, code, new Date())
  if (!r.ok) return limiter.allowMiss() ? unavailable() : busy()
  if (r.target.kind === 'url') return NextResponse.redirect(r.target.url, 302)
  const { data, error } = await db.storage.from(RESOURCE_BUCKET).createSignedUrl(r.target.storagePath, FILE_SECONDS)
  if (error || !data?.signedUrl) {
    console.error('[r/code] signed url failed')
    return unavailable()
  }
  return NextResponse.redirect(data.signedUrl, 302)
}
