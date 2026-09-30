// POST /api/notify/sms
//
// SCOPE: this route texts ONE person only, the owner of the given user_id, at that
// profile's own phone (profiles.phone), after the consent gate, from the Primary
// line. There is no other recipient path: no phone number, contact id or line is
// accepted from the caller. It exists so scheduled tasks can text staff (Cameron),
// replacing inserts into the platform's scheduled_jobs table. University
// notifications stay in the platform.
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
import { createAdminSupabase } from '@/lib/supabase'
import { getOrgTwilioConfig, sendOrgSms } from '@/lib/twilio-org'
import { toE164 } from '@/lib/phone'
import { getOrCreateConversation, bumpConversation } from '@/lib/crm-server'
import { splitSmsBody } from '@/lib/sms-split'

// The only sender registered to the A2P campaign. The WNW Office line fails with 30034.
const PRIMARY_NICKNAME = 'Primary'
// Anything longer is a caller bug, not a notice. This bounds LENGTH only: the
// splitter keeps paragraphs whole, so many mid-sized paragraphs can make more
// parts than the length suggests. The part count is bounded by MAX_PARTS.
const MAX_BODY_CHARS = 18500
// Checked after splitting and before any database read or Twilio call.
const MAX_PARTS = 13

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

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)
// Twilio error text can quote the number it refused. The response never carries one.
const redactNumbers = (s: string) => s.replace(/\+?\d[\d\s().-]{8,}\d/g, '[number]')

/** A Twilio 4xx other than 401, 403 and 429 will be refused again: permanent. */
function classify(e: any): { permanent: boolean; error: string } {
  const status = Number(e?.status) || 0
  const code = e?.code ? ` ${e.code}` : ''
  const permanent = status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429
  return { permanent, error: redactNumbers(`twilio ${status || 'network'}${code}: ${String(e?.message ?? e)}`).slice(0, 300) }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let input: any
  try { input = await req.json() } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const userId = typeof input?.user_id === 'string' ? input.user_id.trim() : ''
  const body = typeof input?.body === 'string' ? input.body : ''
  if (!userId || !body.trim()) {
    return NextResponse.json({ error: 'user_id and body are required' }, { status: 400 })
  }
  if (body.length > MAX_BODY_CHARS) {
    console.warn(`[notify/sms] user=${userId} body_len=${body.length} refused: over ${MAX_BODY_CHARS}`)
    return NextResponse.json({ error: `body over ${MAX_BODY_CHARS} characters` }, { status: 413 })
  }

  const parts = splitSmsBody(body)
  if (parts.length > MAX_PARTS) {
    console.warn(`[notify/sms] refused: parts=${parts.length} over ${MAX_PARTS}`)
    return NextResponse.json({ sent: false, reason: 'too_many_parts', total_parts: parts.length }, { status: 413 })
  }
  console.info(`[notify/sms] user=${userId} body_len=${body.length} parts=${parts.length} lens=[${parts.map((p) => p.length)}]`)

  const admin = createAdminSupabase()

  // ── Recipient: the profile's own phone. The only recipient this route has. ──
  const { data: profile, error: profErr } = await admin
    .from('profiles').select('id, email, phone, organization_id').eq('id', userId).maybeSingle()
  if (profErr) return NextResponse.json({ sent: false, error: `profile read failed (${profErr.code ?? 'unknown'})` }, { status: 500 })
  if (!profile) return NextResponse.json({ sent: false, reason: 'no_profile' })
  const rawPhone = String(profile.phone || '').trim()
  const to = toE164(rawPhone)
  if (!to) return NextResponse.json({ sent: false, reason: 'no_phone' })
  const orgId = profile.organization_id as string | null
  if (!orgId || !profile.email) return NextResponse.json({ sent: false, reason: 'no_contact' })

  // ── Consent gate, the platform's rule: the contact matching the profile email
  //    must have sms_consent = true, and the number must not be on the
  //    do-not-contact list. A read error sends nothing (500), never a pass. ──
  const { data: contacts, error: cErr } = await admin
    .from('contacts')
    .select('id, sms_consent, do_not_contact, pipeline_stage')
    .eq('org_id', orgId)
    .ilike('email', escapeLike(String(profile.email).trim().toLowerCase()))
    .is('merged_into_id', null)
    .order('created_at', { ascending: true })
    .limit(1)
  if (cErr) return NextResponse.json({ sent: false, error: `contact read failed (${cErr.code ?? 'unknown'})` }, { status: 500 })
  const contact = contacts?.[0]
  if (!contact) return NextResponse.json({ sent: false, reason: 'no_contact' })
  if (contact.sms_consent !== true) return NextResponse.json({ sent: false, reason: 'no_consent' })
  if (contact.do_not_contact) return NextResponse.json({ sent: false, reason: 'dnc' })
  const { data: dnc, error: dErr } = await admin
    .from('do_not_contact_list').select('id').in('phone', Array.from(new Set([rawPhone, to]))).limit(1)
  if (dErr) return NextResponse.json({ sent: false, error: `dnc read failed (${dErr.code ?? 'unknown'})` }, { status: 500 })
  if ((dnc?.length ?? 0) > 0) return NextResponse.json({ sent: false, reason: 'dnc' })

  // ── Sender: the Primary line, pinned through sendOrgSms's existing `from` option ──
  const config = await getOrgTwilioConfig(admin, orgId)
  if (!config.account_sid) return NextResponse.json({ sent: false, error: 'twilio not configured for org' }, { status: 500 })
  const primary = toE164(config.numbers.find((n) => n.nickname === PRIMARY_NICKNAME)?.phone || '')
  if (!primary) return NextResponse.json({ sent: false, error: 'no Primary line configured for org' }, { status: 500 })

  // ── The thread, resolved BEFORE sending: a failure here sends nothing ──
  let conversationId: string
  try {
    const conv = await getOrCreateConversation(admin, contact.id, 'sms', orgId, primary)
    conversationId = conv.id
  } catch (e: any) {
    return NextResponse.json({ sent: false, error: `conversation failed (${e?.code ?? 'unknown'})` }, { status: 500 })
  }

  // ── Send in order. Stop at the first failure; no retry inside the route. ──
  const sids: string[] = []
  let logFailures = 0
  const bump = (i: number) => bumpConversation(admin, conversationId, {
    preview: parts[i], direction: 'outbound', lineE164: primary, occurredAt: new Date().toISOString(),
  })
  for (let i = 0; i < parts.length; i++) {
    let msg: any
    try {
      msg = await sendOrgSms(config, to, parts[i], 'client_message', contact.pipeline_stage ?? null, { from: primary })
    } catch (e: any) {
      const { permanent, error } = classify(e)
      console.error(`[notify/sms] user=${userId} part ${i + 1}/${parts.length} failed status=${Number(e?.status) || 'network'} code=${e?.code ?? '-'} permanent=${permanent} sent_parts=${i}`)
      if (i > 0) await bump(i - 1)
      return NextResponse.json({ sent: false, sent_parts: i, total_parts: parts.length, error }, { status: permanent ? 200 : 502 })
    }
    sids.push(msg.sid)

    // Log the part on the thread. Verified by ROW COUNT: a filtered write returns
    // error null with zero rows. A logging failure does not stop the sequence,
    // since the text already went out; it is counted and reported. Only the error
    // CODE is logged: a Postgres message can quote the failing row, body and phone.
    const { data: rows, error: insErr } = await admin.from('crm_messages').insert({
      conversation_id: conversationId, org_id: orgId, direction: 'outbound', msg_type: 'sms',
      body: parts[i], status: 'queued', twilio_sid: msg.sid,
      to_e164: to, from_e164: msg.from || primary, sent_at: new Date().toISOString(),
    }).select('id')
    if (insErr || (rows?.length ?? 0) !== 1) {
      logFailures++
      console.error(`[notify/sms] crm_messages log for part ${i + 1}/${parts.length} sid=${msg.sid} conversation=${conversationId}: ${insErr ? `error ${insErr.code ?? 'unknown'}` : `matched ${rows?.length ?? 0} rows`}`)
    }
  }
  await bump(parts.length - 1)

  return NextResponse.json({
    sent: true, total_parts: parts.length, part_lengths: parts.map((p) => p.length),
    twilio_sids: sids, logged_parts: parts.length - logFailures,
  })
}

// Only POST. Next answers 405 for an unexported method on its own; these make it
// explicit so a later edit cannot quietly open another verb.
const methodNotAllowed = () => NextResponse.json({ error: 'method not allowed' }, { status: 405, headers: { Allow: 'POST' } })
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE }
