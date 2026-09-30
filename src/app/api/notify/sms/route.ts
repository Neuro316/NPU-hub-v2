// POST /api/notify/sms
//
// SCOPE: this route texts ONE person only, the owner of the given user_id, at that
// profile's own phone (profiles.phone), after the consent gate, from the Primary
// line. There is no other recipient path: no phone number, contact id or line is
// accepted from the caller. It exists so scheduled tasks can text staff (Cameron),
// replacing inserts into the platform's scheduled_jobs table. University
// notifications stay in the platform.
//
// The send itself (validation, consent gate, split, send, Conversations logging)
// lives in src/lib/notify-sms.ts, shared with /api/cron/sms-outbox. This file is
// auth and HTTP only.
//
// Auth is a bearer secret (HUB_NOTIFY_SECRET), compared in constant time. The
// route is excluded from the session middleware (src/middleware.ts), so THIS
// check is its only gate. Unset or empty secret, or a bad token: 401, nothing sent.
//
// Never logs the token, the body text or the phone number. Lengths, part counts
// and ids only.
//
// idempotency_key is accepted and IGNORED: crm_messages has no metadata column
// to carry it, and adding one needs a migration. A caller that retries after a
// partial failure will re-send the earlier parts.
import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { sendNotifySms } from '@/lib/notify-sms'

function authorized(req: NextRequest): boolean {
  const secret = process.env.HUB_NOTIFY_SECRET
  if (!secret || !secret.trim()) {
    console.error('[notify/sms] HUB_NOTIFY_SECRET is not set on this host; refusing every request')
    return false
  }
  // Hash both sides so timingSafeEqual always compares equal-length (32 byte) buffers.
  const got = createHash('sha256').update(req.headers.get('authorization') || '').digest()
  const want = createHash('sha256').update(`Bearer ${secret}`).digest()
  return got.length === want.length && timingSafeEqual(got, want)
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let input: any
  try { input = await req.json() } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const r = await sendNotifySms({ user_id: input?.user_id, body: input?.body })
  return NextResponse.json(r.response, { status: r.httpStatus })
}

// Only POST. Next answers 405 for an unexported method on its own; these make it
// explicit so a later edit cannot quietly open another verb.
const methodNotAllowed = () => NextResponse.json({ error: 'method not allowed' }, { status: 405, headers: { Allow: 'POST' } })
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE }
