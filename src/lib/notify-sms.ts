// src/lib/notify-sms.ts
// The one send path for texting a staff member (the owner of a user_id) outside a
// live conversation. Two callers:
//   - POST /api/notify/sms   (bearer authenticated; returns `response` as its JSON)
//   - GET  /api/cron/sms-outbox (drains public.hub_sms_outbox)
//
// SCOPE: texts ONE person only, the owner of the given user_id, at that profile's
// own phone (profiles.phone), after the consent gate, from the Primary line. No
// phone number, contact id or line is accepted from the caller.
//
// Never logs the body text or the phone number. Lengths, part counts and ids only.
// `error_code` carries codes only (no message text), so a caller may store it.
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
export const MAX_BODY_CHARS = 18500
// Checked after splitting and before any database read or Twilio call.
export const MAX_PARTS = 13

/**
 * ok        : every part went out
 * refused   : nothing sent, and resending the same input will be refused again
 *             (bad input, or the consent gate said no)
 * permanent : a Twilio 4xx other than 401, 403, 429; the same request will fail again
 * transient : a 5xx, network error, or a failed read or config lookup; may succeed later
 */
export type NotifySmsStatusClass = 'ok' | 'refused' | 'permanent' | 'transient'

export interface NotifySmsResult {
  /** The HTTP status POST /api/notify/sms answers with. */
  httpStatus: number
  /** The JSON body POST /api/notify/sms answers with, unchanged from before the refactor. */
  response: Record<string, unknown>
  statusClass: NotifySmsStatusClass
  sent: boolean
  /** Parts the body split into; 0 when it was refused before splitting. */
  total_parts: number
  /** Parts Twilio accepted. Nonzero with sent=false means a PARTIAL send. */
  sent_parts: number
  /** The consent or validation reason, when there is one. */
  reason: string | null
  /** Codes only, safe to store: e.g. "twilio_400_21617", "profile_read_42P01". */
  error_code: string | null
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)
// Twilio error text can quote the number it refused. The response never carries one.
const redactNumbers = (s: string) => s.replace(/\+?\d[\d\s().-]{8,}\d/g, '[number]')

/** A Twilio 4xx other than 401, 403 and 429 will be refused again: permanent. */
function classify(e: any): { permanent: boolean; error: string; code: string } {
  const status = Number(e?.status) || 0
  const code = e?.code ? ` ${e.code}` : ''
  const permanent = status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429
  return {
    permanent,
    error: redactNumbers(`twilio ${status || 'network'}${code}: ${String(e?.message ?? e)}`).slice(0, 300),
    code: `twilio_${status || 'network'}${e?.code ? `_${String(e.code).replace(/[^\w-]/g, '')}` : ''}`,
  }
}

type Out = Omit<NotifySmsResult, 'total_parts' | 'sent_parts'> & Partial<Pick<NotifySmsResult, 'total_parts' | 'sent_parts'>>
const done = (r: Out): NotifySmsResult => ({ total_parts: 0, sent_parts: 0, ...r })
const refused = (httpStatus: number, response: Record<string, unknown>, reason: string, total_parts = 0) =>
  done({ httpStatus, response, statusClass: 'refused', sent: false, reason, error_code: null, total_parts })
const transient = (error: string, error_code: string, total_parts: number) =>
  done({ httpStatus: 500, response: { sent: false, error }, statusClass: 'transient', sent: false, reason: null, error_code, total_parts })

/**
 * Validate, gate, split and send. `org_id`, when given (the outbox passes it), must
 * equal the profile's org or nothing is sent. The route passes none, so its
 * behavior is exactly what it was before this module existed.
 */
export async function sendNotifySms(input: { user_id: unknown; body: unknown; org_id?: string | null }): Promise<NotifySmsResult> {
  const userId = typeof input?.user_id === 'string' ? input.user_id.trim() : ''
  const body = typeof input?.body === 'string' ? input.body : ''
  if (!userId || !body.trim()) {
    return refused(400, { error: 'user_id and body are required' }, 'missing_input')
  }
  if (body.length > MAX_BODY_CHARS) {
    console.warn(`[notify/sms] user=${userId} body_len=${body.length} refused: over ${MAX_BODY_CHARS}`)
    return refused(413, { error: `body over ${MAX_BODY_CHARS} characters` }, 'body_too_long')
  }

  const parts = splitSmsBody(body)
  const n = parts.length
  if (n > MAX_PARTS) {
    console.warn(`[notify/sms] refused: parts=${n} over ${MAX_PARTS}`)
    return refused(413, { sent: false, reason: 'too_many_parts', total_parts: n }, 'too_many_parts', n)
  }
  console.info(`[notify/sms] user=${userId} body_len=${body.length} parts=${n} lens=[${parts.map((p) => p.length)}]`)

  const admin = createAdminSupabase()

  // ── Recipient: the profile's own phone. The only recipient this path has. ──
  const { data: profile, error: profErr } = await admin
    .from('profiles').select('id, email, phone, organization_id').eq('id', userId).maybeSingle()
  if (profErr) return transient(`profile read failed (${profErr.code ?? 'unknown'})`, `profile_read_${profErr.code ?? 'unknown'}`, n)
  if (!profile) return refused(200, { sent: false, reason: 'no_profile' }, 'no_profile', n)
  const rawPhone = String(profile.phone || '').trim()
  const to = toE164(rawPhone)
  if (!to) return refused(200, { sent: false, reason: 'no_phone' }, 'no_phone', n)
  const orgId = profile.organization_id as string | null
  if (!orgId || !profile.email) return refused(200, { sent: false, reason: 'no_contact' }, 'no_contact', n)
  if (input.org_id && input.org_id !== orgId) return refused(200, { sent: false, reason: 'org_mismatch' }, 'org_mismatch', n)

  // ── Consent gate, the platform's rule: the contact matching the profile email
  //    must have sms_consent = true, and the number must not be on the
  //    do-not-contact list. A read error sends nothing, never a pass. ──
  const { data: contacts, error: cErr } = await admin
    .from('contacts')
    .select('id, sms_consent, do_not_contact, pipeline_stage')
    .eq('org_id', orgId)
    .ilike('email', escapeLike(String(profile.email).trim().toLowerCase()))
    .is('merged_into_id', null)
    .order('created_at', { ascending: true })
    .limit(1)
  if (cErr) return transient(`contact read failed (${cErr.code ?? 'unknown'})`, `contact_read_${cErr.code ?? 'unknown'}`, n)
  const contact = contacts?.[0]
  if (!contact) return refused(200, { sent: false, reason: 'no_contact' }, 'no_contact', n)
  if (contact.sms_consent !== true) return refused(200, { sent: false, reason: 'no_consent' }, 'no_consent', n)
  if (contact.do_not_contact) return refused(200, { sent: false, reason: 'dnc' }, 'dnc', n)
  const { data: dnc, error: dErr } = await admin
    .from('do_not_contact_list').select('id').in('phone', Array.from(new Set([rawPhone, to]))).limit(1)
  if (dErr) return transient(`dnc read failed (${dErr.code ?? 'unknown'})`, `dnc_read_${dErr.code ?? 'unknown'}`, n)
  if ((dnc?.length ?? 0) > 0) return refused(200, { sent: false, reason: 'dnc' }, 'dnc', n)

  // ── Sender: the Primary line, pinned through sendOrgSms's existing `from` option ──
  const config = await getOrgTwilioConfig(admin, orgId)
  if (!config.account_sid) return transient('twilio not configured for org', 'twilio_not_configured', n)
  const primary = toE164(config.numbers.find((x) => x.nickname === PRIMARY_NICKNAME)?.phone || '')
  if (!primary) return transient('no Primary line configured for org', 'no_primary_line', n)

  // ── The thread, resolved BEFORE sending: a failure here sends nothing ──
  let conversationId: string
  try {
    const conv = await getOrCreateConversation(admin, contact.id, 'sms', orgId, primary)
    conversationId = conv.id
  } catch (e: any) {
    return transient(`conversation failed (${e?.code ?? 'unknown'})`, `conversation_${e?.code ?? 'unknown'}`, n)
  }

  // ── Send in order. Stop at the first failure; no retry here. ──
  const sids: string[] = []
  let logFailures = 0
  const bump = (i: number) => bumpConversation(admin, conversationId, {
    preview: parts[i], direction: 'outbound', lineE164: primary, occurredAt: new Date().toISOString(),
  })
  for (let i = 0; i < n; i++) {
    let msg: any
    try {
      msg = await sendOrgSms(config, to, parts[i], 'client_message', contact.pipeline_stage ?? null, { from: primary })
    } catch (e: any) {
      const { permanent, error, code } = classify(e)
      console.error(`[notify/sms] user=${userId} part ${i + 1}/${n} failed status=${Number(e?.status) || 'network'} code=${e?.code ?? '-'} permanent=${permanent} sent_parts=${i}`)
      if (i > 0) await bump(i - 1)
      return done({
        httpStatus: permanent ? 200 : 502,
        response: { sent: false, sent_parts: i, total_parts: n, error },
        statusClass: permanent ? 'permanent' : 'transient',
        sent: false, total_parts: n, sent_parts: i, reason: null, error_code: code,
      })
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
      console.error(`[notify/sms] crm_messages log for part ${i + 1}/${n} sid=${msg.sid} conversation=${conversationId}: ${insErr ? `error ${insErr.code ?? 'unknown'}` : `matched ${rows?.length ?? 0} rows`}`)
    }
  }
  await bump(n - 1)

  return done({
    httpStatus: 200,
    response: {
      sent: true, total_parts: n, part_lengths: parts.map((p) => p.length),
      twilio_sids: sids, logged_parts: n - logFailures,
    },
    statusClass: 'ok', sent: true, total_parts: n, sent_parts: n, reason: null, error_code: null,
  })
}
