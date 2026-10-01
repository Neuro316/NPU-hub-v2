// POST /api/intake  (PUBLIC, exact path in middleware; rulings 12 and 14)
//
// The one public intake endpoint. Body: { form: <slug>, values: {...}, consents: [<id>],
// website: <honeypot>, utm: {...} }. In order:
//   1. the form exists, is published, and its org has the `intake` flag on
//   2. bot protection: a filled honeypot is accepted silently and dropped; more than
//      RATE_PER_IP submissions per address per window, or RATE_PER_FORM per form per
//      minute, are refused 429
//   3. values are validated against the stored definition (src/lib/marketing/intake.ts)
//   4. the contact is matched or created (public.hub_intake_contact)
//   5. each ticked consent is recorded with the EXACT text the definition holds
//      (public.record_consent), never text from the client
//   6. the form's source_key is routed into campaigns (public.route_and_enroll), with
//      the submission id as the event id, so a replayed submission enrolls once
// Returns only the form's success message; never echoes or reveals contact data.
//
// SERVER MODE (docs/INTEGRATION_CONTRACT.md): a caller presenting
// `Authorization: Bearer <HUB_INTAKE_SERVER_SECRET>` is another of our systems (the
// University platform). It must send `event_id`, which makes the call idempotent: the
// same event is accepted once and replays answer `duplicate: true`. The per-address rate
// limit and the honeypot do not apply, since every server call shares one address. A
// wrong or present-but-unset secret is refused 401; it never falls back to public mode.
import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createAdminSupabase } from '@/lib/supabase'
import { getFlags } from '@/lib/marketing/flags'
import { validateIntake, type FormDefinition } from '@/lib/marketing/intake'
import { toE164 } from '@/lib/phone'

export const dynamic = 'force-dynamic'

const RATE_WINDOW_MINUTES = 10
const RATE_PER_IP = 5
const RATE_PER_FORM = 60

function cors(req: NextRequest): Record<string, string> | null {
  const origin = req.headers.get('origin')
  if (!origin) return {}
  const allowed = (process.env.HUB_INTAKE_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const self = process.env.NEXT_PUBLIC_APP_URL || ''
  if (origin !== self && !allowed.includes(origin)) return null
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
}

const json = (body: unknown, status: number, h: Record<string, string>) => NextResponse.json(body, { status, headers: h })

/** null: no server credential offered (public mode). true: valid. false: offered and wrong, or the secret is unset. */
function serverCaller(req: NextRequest): boolean | null {
  const auth = req.headers.get('authorization')
  if (!auth) return null
  const secret = process.env.HUB_INTAKE_SERVER_SECRET
  if (!secret || secret.trim().length < 32) return false
  const got = createHash('sha256').update(auth).digest()
  const want = createHash('sha256').update(`Bearer ${secret}`).digest()
  return timingSafeEqual(got, want)
}
const EVENT_ID = /^[A-Za-z0-9:_.-]{1,120}$/

export async function OPTIONS(req: NextRequest) {
  const h = cors(req)
  return h ? new NextResponse(null, { status: 204, headers: h }) : new NextResponse(null, { status: 403 })
}

export async function POST(req: NextRequest) {
  const h = cors(req)
  if (!h) return new NextResponse(null, { status: 403 })
  const server = serverCaller(req)
  if (server === false) return json({ error: 'unauthorized' }, 401, h)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'Please send the form again.' }, 400, h) }
  const eventId = server ? (typeof body?.event_id === 'string' && EVENT_ID.test(body.event_id) ? body.event_id : null) : null
  if (server && !eventId) return json({ error: 'event_id is required: letters, numbers and : _ . - only, up to 120 characters' }, 400, h)
  const slug = typeof body?.form === 'string' ? body.form : ''
  const db = createAdminSupabase()

  const { data: form } = slug
    ? await db.from('form_definitions').select('id, org_id, slug, status, version, fields, consents, source_key, success_message').eq('slug', slug).maybeSingle()
    : { data: null }
  if (!form || form.status !== 'published' || !(await getFlags(db, form.org_id)).intake) {
    return json({ error: 'This form is not taking submissions right now.' }, 404, h)
  }

  const ip = server ? 'server' : (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  const ipHash = createHash('sha256').update(`${ip}|${form.org_id}`).digest('hex')
  if (server) {
    const { data: seen } = await db.from('form_submissions').select('id').eq('form_id', form.id).eq('payload->>event_id', eventId).limit(1)
    if (seen?.length) return json({ ok: true, duplicate: true, message: form.success_message }, 200, h)
  }
  const ua = (req.headers.get('user-agent') || '').slice(0, 200)

  const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000).toISOString()
  const minute = new Date(Date.now() - 60_000).toISOString()
  const [{ count: perIp }, { count: perForm }] = await Promise.all([
    db.from('form_submissions').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since),
    db.from('form_submissions').select('id', { count: 'exact', head: true }).eq('form_id', form.id).gte('created_at', minute),
  ])
  if (!server && ((perIp ?? 0) >= RATE_PER_IP || (perForm ?? 0) >= RATE_PER_FORM)) {
    return json({ error: 'Too many submissions. Please wait a few minutes and try again.' }, 429, h)
  }

  if (!server && typeof body?.website === 'string' && body.website.trim() !== '') {
    await db.from('form_submissions').insert({ org_id: form.org_id, form_id: form.id, form_version: form.version, ip_hash: ipHash, outcome: 'honeypot' })
    return json({ ok: true, message: form.success_message }, 200, h)
  }

  const v = validateIntake(form as unknown as FormDefinition, body?.values, body?.consents)
  if (!v.ok) {
    await db.from('form_submissions').insert({ org_id: form.org_id, form_id: form.id, form_version: form.version, ip_hash: ipHash, outcome: 'invalid' })
    return json({ error: 'Please check the highlighted fields.', fields: v.errors }, 400, h)
  }

  const utm = body?.utm && typeof body.utm === 'object' ? Object.fromEntries(Object.entries(body.utm)
    .filter(([k, x]) => /^utm_[a-z]+$/.test(k) && typeof x === 'string').map(([k, x]) => [k, String(x).slice(0, 200)])) : null
  const { data: sub, error: sErr } = await db.from('form_submissions').insert({
    org_id: form.org_id, form_id: form.id, form_version: form.version, ip_hash: ipHash, outcome: 'received',
    payload: { values: v.values, consents: v.consents.map((c) => c.id), utm, event_id: eventId },
  }).select('id').single()
  if (sErr || !sub) return json({ error: 'We could not save your details. Please try again.' }, 500, h)

  const { data: contactId, error: cErr } = await db.rpc('hub_intake_contact', {
    p_org: form.org_id, p_email: v.email, p_phone: v.phone, p_first: v.first, p_last: v.last,
    p_source_key: form.source_key, p_utm: utm,
  })
  if (cErr || !contactId) {
    await db.from('form_submissions').update({ outcome: 'contact_failed' }).eq('id', sub.id)
    console.error(`[intake] submission=${sub.id} contact failed: ${cErr?.code ?? 'no id'}`)
    return json({ error: 'We could not save your details. Please try again.' }, 500, h)
  }
  // A public form can be filled in by anyone with someone else's details, so it may ADD a
  // consent but never reverse a person's own opt-out, and an SMS consent counts only for
  // the number the visitor typed, never for a different number already on the contact.
  const { data: who } = await db.from('contacts').select('phone').eq('id', contactId).maybeSingle()
  const skipped: string[] = []
  for (const c of v.consents) {
    if (c.channel === 'sms' && toE164(String(who?.phone ?? '')) !== v.phone) { skipped.push(`${c.id}:phone_differs`); continue }
    const { data: st } = await db.rpc('consent_state', { p_contact: contactId, p_channel: c.channel, p_kind: c.kind })
    if (String((st as any)?.reason ?? '').endsWith('_revoked')) { skipped.push(`${c.id}:opted_out`); continue }
    const { error } = await db.rpc('record_consent', {
      p_contact: contactId, p_channel: c.channel, p_kind: c.kind, p_action: 'granted', p_basis: 'express_consent',
      p_source: `form:${form.slug}`, p_text_shown: c.text,
      p_evidence: { form_id: form.id, form_version: form.version, consent_id: c.id, submission_id: sub.id, ip_hash: ipHash, user_agent: ua },
    })
    if (error) console.error(`[intake] submission=${sub.id} consent ${c.id} failed: ${error.code ?? 'unknown'}`)
  }
  const { data: routed, error: rErr } = await db.rpc('route_and_enroll', {
    p_org: form.org_id, p_contact: contactId, p_source_key: form.source_key, p_event_id: eventId ? `platform:${eventId}` : `form_submission:${sub.id}`,
  })
  if (rErr) console.error(`[intake] submission=${sub.id} routing failed: ${rErr.code ?? 'unknown'}`)
  await db.from('form_submissions').update({ outcome: 'accepted', contact_id: contactId,
    payload: { values: v.values, consents: v.consents.map((c) => c.id), consents_not_recorded: skipped, utm, event_id: eventId, routed: routed ?? null } }).eq('id', sub.id)
  return json({ ok: true, message: form.success_message }, 200, h)
}
