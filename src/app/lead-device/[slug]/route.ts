// GET start.neuroprogeny.com/<slug>   (PUBLIC, reached only through the middleware's exact host rewrite)
// The device's page. A device that is not live answers not available, unless the link carries a signed preview.
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { onPublicOrigin, resolvePublicDevice } from '@/lib/lead-devices/public-device'
import { newNonce, notAvailablePage, pageCsp, publicHeaders, renderPlayer } from '@/lib/lead-devices/player'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  if (!onPublicOrigin(req)) return new NextResponse(null, { status: 404 })
  const preview = new URL(req.url).searchParams.get('preview')
  const r = await resolvePublicDevice(createAdminSupabase(), params.slug, preview)
  if (!r) return new NextResponse(notAvailablePage(), { status: 404, headers: publicHeaders("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'") })
  const nonce = newNonce()
  const html = renderPlayer({ device: r.device, nonce, siteKey: process.env.TURNSTILE_SITE_KEY || '', preview: r.preview })
  return new NextResponse(html, { status: 200, headers: publicHeaders(pageCsp(nonce, r.device.manifest.embed_origins)) })
}
