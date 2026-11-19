// POST /api/public/lead-capture  (PUBLIC, exact path in src/lib/supabase-middleware.ts)
//
// Sign-ups from static partner pages (src/lib/marketing/lead-capture.ts). Body:
//   { name, email, phone, source, resource, bot }
// In order:
//   1. the Origin is one a declared source allows (CORS, OPTIONS preflight); anything else is 403 with no CORS header
//   2. a filled honeypot ("bot") is answered 200 and dropped
//   3. the source is declared and allows this Origin; email (required) and phone (optional) are valid
//   4. more than RATE_PER_IP accepted sign-ups from one address in RATE_WINDOW_MINUTES are refused 429
//   5. the contact is matched (email, then phone) or created; blanks are filled, nothing is overwritten; the tag is
//      added; the contact is placed in the source's pipeline at its stage, forward only; a timeline row is written
// Never echoes or reveals contact data.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { captureLead, corsFor, ipHashOf, isBot, rateLimited, validateLead } from '@/lib/marketing/lead-capture'

export const dynamic = 'force-dynamic'

const OK_MESSAGE = 'Thank you. Your checklist is ready.'
const json = (body: unknown, status: number, h: Record<string, string>) => NextResponse.json(body, { status, headers: h })

export async function OPTIONS(req: NextRequest) {
  const h = corsFor(req.headers.get('origin'))
  return h ? new NextResponse(null, { status: 204, headers: h }) : new NextResponse(null, { status: 403 })
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  const h = corsFor(origin)
  if (!h) return new NextResponse(null, { status: 403 })
  let body: any
  try { body = await req.json() } catch { return json({ error: 'Please send the form again.' }, 400, h) }
  if (!body || typeof body !== 'object') return json({ error: 'Please send the form again.' }, 400, h)
  if (isBot(body)) return json({ ok: true, message: OK_MESSAGE }, 200, h)

  const v = validateLead(body, origin)
  if (!v.ok) return json({ error: v.error, ...(v.fields ? { fields: v.fields } : {}) }, v.status, h)

  const db = createAdminSupabase()
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  const ipHash = ipHashOf(ip, v.def.org)
  if (await rateLimited(db, v.def.org, ipHash)) {
    return json({ error: 'Too many sign-ups from this connection. Please wait a few minutes and try again.' }, 429, h)
  }

  try {
    const r = await captureLead(db, v, ipHash)
    console.log(`[lead-capture] source=${v.source} contact=${r.contactId} created=${r.created} placement=${r.placed}`)
  } catch (e: any) {
    console.error(`[lead-capture] source=${v.source} failed: ${String(e?.message ?? 'error').slice(0, 60)}`)
    return json({ error: 'We could not save your details. Please try again.' }, 500, h)
  }
  return json({ ok: true, message: OK_MESSAGE }, 200, h)
}
