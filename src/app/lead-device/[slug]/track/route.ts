// POST start.neuroprogeny.com/<slug>/track   (PUBLIC)
// NPU.track and page views. It records an event name and nothing else, and always answers 204, so a page can
// never learn from it whether a device exists or a limit was hit.
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { clientIp, onPublicOrigin, resolvePublicDevice } from '@/lib/lead-devices/public-device'
import { ipHash } from '@/lib/lead-devices/intake'
import { LEAD_DEVICE_ORIGIN } from '@/lib/lead-devices/public-origin'

export const dynamic = 'force-dynamic'

const WINDOW_MINUTES = 10
const EVENTS_PER_WINDOW = 60
const EVENT = /^[a-z0-9_]{1,40}$/
const quiet = () => new NextResponse(null, { status: 204 })

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  if (!onPublicOrigin(req)) return new NextResponse(null, { status: 404 })
  const origin = req.headers.get('origin')
  if (origin && origin !== LEAD_DEVICE_ORIGIN) return quiet()
  const b: any = await req.json().catch(() => null)
  const event = typeof b?.event === 'string' ? b.event.trim().toLowerCase() : ''
  // 'attempt' is written only by the capture endpoint, because the rate limit counts it.
  if (!EVENT.test(event) || event === 'attempt') return quiet()

  const db = createAdminSupabase()
  const r = await resolvePublicDevice(db, params.slug, b?.preview)
  if (!r) return quiet()
  const hash = ipHash(clientIp(req), r.device.org_id)
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()
  const { count, error } = await db.from('lead_device_events').select('id', { count: 'exact', head: true }).eq('ip_hash', hash).gte('created_at', since)
  if (error || (count ?? 0) >= EVENTS_PER_WINDOW) return quiet()
  const { error: wErr } = await db.from('lead_device_events').insert({
    org_id: r.device.org_id, device_id: r.device.id, version_id: r.versionId, event, ip_hash: hash,
    utm_source: typeof b?.utm_source === 'string' ? b.utm_source.slice(0, 200) : null,
    is_test: !!r.preview || r.device.status !== 'live',
  })
  if (wErr) console.error(`[lead-device] track failed device=${r.device.id}: ${wErr.code ?? 'unknown'}`)
  return quiet()
}
