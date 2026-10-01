// GET /a/<token>  (PUBLIC, approved as /a/*; rulings 11 and 14)
//
// The deliver step's link. The token is single purpose (one asset), expires, and
// carries no personal data; only its sha256 is stored. A valid token redirects to the
// University's own domain and nowhere else: the host is fixed here, and the stored path
// is constrained by a CHECK to begin with one slash (never "//") and contain no
// backslash. University access rules are untouched: the link lands on the existing
// signup and access path.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { hashAssetToken, byteaHex } from '@/lib/marketing/tokens'
import { universityTarget } from '@/lib/marketing/university'

export const dynamic = 'force-dynamic'

const expired = () => new NextResponse(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link expired</title></head>
<body style="font-family:Inter,system-ui,sans-serif;background:#f8fafc;color:#1e293b;padding:40px 16px;text-align:center">
<h1 style="font-size:20px">This link has expired</h1><p>Links to free resources last a limited time. Reply to the message that brought you here and we will send you a fresh one.</p></body></html>`,
  { status: 410, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const token = String(params?.token || '')
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return expired()
  const { data, error } = await createAdminSupabase().rpc('redeem_asset_grant', { p_token_hash: byteaHex(hashAssetToken(token)) })
  if (error) {
    console.error(`[a/token] redeem failed: ${error.code ?? 'unknown'}`)
    return expired()
  }
  const target = (data as any)?.ok ? universityTarget((data as any).path) : null
  return target ? NextResponse.redirect(target, 302) : expired()
}
