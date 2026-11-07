// POST start.neuroprogeny.com/<slug>/submit   (PUBLIC, the capture endpoint)
// In order, so an abusive caller costs least: the device, the rate limit (which counts every attempt), the
// honeypot, Turnstile, then the lead's own fields. The secret never reaches the browser and nothing identifying
// is logged.
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { clientIp, onPublicOrigin, resolvePublicDevice } from '@/lib/lead-devices/public-device'
import { checkAnswers, checkHostedLead, cleanUtm, hostedConsents, IDEMPOTENCY_KEY, ipHash, processSubmission } from '@/lib/lead-devices/intake'
import { verifyTurnstile } from '@/lib/lead-devices/turnstile'
import { LEAD_DEVICE_ORIGIN } from '@/lib/lead-devices/public-origin'

export const dynamic = 'force-dynamic'

const WINDOW_MINUTES = 10
const ATTEMPTS_PER_WINDOW = 10
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  if (!onPublicOrigin(req)) return new NextResponse(null, { status: 404 })
  const origin = req.headers.get('origin')
  if (origin && origin !== LEAD_DEVICE_ORIGIN) return json({ error: 'not_allowed' }, 403)
  const b: any = await req.json().catch(() => null)
  if (!b || typeof b !== 'object') return json({ error: 'Please send the form again.' }, 400)

  const db = createAdminSupabase()
  const r = await resolvePublicDevice(db, params.slug, b.preview)
  if (!r) return json({ error: 'This page is not taking submissions right now.' }, 404)
  const { device } = r

  const ip = clientIp(req)
  const hash = ipHash(ip, device.org_id)
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()
  const { count, error: cErr } = await db.from('lead_device_events').select('id', { count: 'exact', head: true })
    .eq('ip_hash', hash).eq('event', 'attempt').gte('created_at', since)
  // A failed read of the limiter refuses: treating it as zero would remove the limit when the database struggles.
  if (cErr) return json({ error: 'Please try again in a moment.' }, 503)
  if ((count ?? 0) >= ATTEMPTS_PER_WINDOW) return json({ error: 'Too many submissions from this network. Please try again in about ten minutes.' }, 429)
  const { error: aErr } = await db.from('lead_device_events').insert({ org_id: device.org_id, device_id: device.id, version_id: r.versionId, event: 'attempt', ip_hash: hash, is_test: !!r.preview })
  if (aErr) console.error(`[lead-device] attempt not counted device=${device.id}: ${aErr.code ?? 'unknown'}`)

  // A filled honeypot looks accepted and writes nothing.
  if (typeof b.website === 'string' && b.website.trim() !== '') return json({ ok: true }, 200)

  const ts = await verifyTurnstile(b.turnstileToken, ip)
  if (!ts.ok) {
    if (ts.code === 'not_configured' || ts.code === 'unreachable') {
      console.error(`[lead-device] turnstile ${ts.code} device=${device.id}`)
      return json({ error: 'The anti-spam check is unavailable right now. Please try again shortly.' }, 503)
    }
    return json({ error: 'The anti-spam check did not pass. Please try again.' }, 400)
  }

  const lead = checkHostedLead(b)
  if (!lead.ok) return json({ error: 'Please check the highlighted fields.', fields: lead.errors }, 400)
  const answers = checkAnswers(b.answers)
  if (!answers) return json({ error: 'Your answers could not be read. Please try again.' }, 400)
  if (typeof b.idempotency_key !== 'string' || !IDEMPOTENCY_KEY.test(b.idempotency_key)) return json({ error: 'Please reload the page and try again.' }, 400)

  const result = await processSubmission(db, device, {
    channel: device.content === 'form' ? 'form' : 'hosted',
    idempotencyKey: b.idempotency_key,
    email: lead.email, firstName: lead.firstName, lastName: lead.lastName, phone: lead.phone,
    outcome: typeof b.outcome === 'string' ? b.outcome : null,
    answers, consents: hostedConsents(device, b.consent),
    utm: cleanUtm(b.utm),
    pageUrl: typeof b.page_url === 'string' ? b.page_url.slice(0, 2000) : null,
    submittedAt: null, ipHash: hash, userAgent: (req.headers.get('user-agent') || '').slice(0, 200),
    versionId: r.versionId, preview: !!r.preview,
  })
  if (!result.ok) return json({ error: result.error }, result.status)
  return json({ ok: true, id: result.id }, 200)
}
