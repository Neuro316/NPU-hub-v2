// src/lib/click-to-call/logic.ts
// Pure decisions for click-to-call (docs/plans/hub-click-to-call-rulings.md). No I/O:
// the route gathers the facts, this module decides, and scripts/click-to-call/
// c2c-tamper.cjs compiles this file and tests every gate against it.
//
// The bridge: Twilio rings the signed-in staff member's own phone from the
// conversation's line; when they answer and press 1, it dials the contact with that
// line as caller ID. Nothing here records a call or raises an entry event.
import { toE164, formatUsPhone } from '@/lib/phone'

// ── Flags: org_settings row setting_key 'click_to_call'. Only the exact 'on' counts.
export interface C2CFlags { enabled: boolean; live: boolean }
export function parseC2CFlags(raw: unknown): C2CFlags {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return { enabled: v.enabled === 'on', live: v.live === 'on' }
}

/** Last ten digits, the comparison used by the allowlist and the do-not-contact list. */
export function last10(raw: string | null | undefined): string {
  const d = String(raw || '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : ''
}

// ── Rate limit per staff member, counted from their logged attempts.
export const RATE = { windowMinutes: 10, perWindow: 5, perDay: 40 }
export function rateLimitProblem(attemptsIso: string[], now: Date): { retryAfterMinutes: number } | null {
  const t = now.getTime()
  const day = attemptsIso.map((s) => Date.parse(s)).filter((x) => Number.isFinite(x) && t - x < 86_400_000)
  const win = day.filter((x) => t - x < RATE.windowMinutes * 60_000).sort((a, b) => a - b)
  if (win.length >= RATE.perWindow) {
    return { retryAfterMinutes: Math.max(1, Math.ceil((win[0] + RATE.windowMinutes * 60_000 - t) / 60_000)) }
  }
  if (day.length >= RATE.perDay) {
    const oldest = Math.min(...day)
    return { retryAfterMinutes: Math.max(1, Math.ceil((oldest + 86_400_000 - t) / 60_000)) }
  }
  return null
}

// ── Quiet hours: a warning only, because this is a one to one staff call.
export const QUIET = { start: 8, end: 20 }
export const FALLBACK_TZ = 'America/New_York'
export function validTimeZone(tz: string | null | undefined): string | null {
  if (!tz) return null
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz } catch { return null }
}
export function quietHours(now: Date, contactTz: string | null | undefined, defaultTz: string | null | undefined) {
  const timezone = validTimeZone(contactTz) || validTimeZone(defaultTz) || FALLBACK_TZ
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
  const outside = hour < QUIET.start || hour >= QUIET.end
  return { outside, timezone, localTime: `${String(hour).padStart(2, '0')}:${minute}` }
}

// ── Line: the open conversation's line if it is still one of the org's numbers,
// otherwise the org default (getVoiceCallerId), which the confirm calls Primary.
export interface LineChoice { e164: string; label: string; isDefault: boolean }
export function pickLine(
  numbers: { phone: string; nickname?: string }[],
  conversationLine: string | null | undefined,
  defaultLine: string | null | undefined,
): LineChoice | null {
  const find = (v: string | null | undefined) => {
    const want = toE164(String(v || ''))
    return want ? numbers.find((n) => toE164(n.phone) === want) : undefined
  }
  const own = find(conversationLine)
  if (own) return { e164: toE164(own.phone), label: own.nickname || formatUsPhone(toE164(own.phone)), isDefault: false }
  const def = toE164(String(defaultLine || ''))
  if (!def) return null
  const n = find(def)
  return { e164: def, label: n?.nickname || 'Primary', isDefault: true }
}

// ── The gate. Order matters only for which reason is shown first; every refusal is final.
export interface Facts {
  callerOrgIds: string[]
  conversation: { id: string; org_id: string; contact_id: string | null; line_e164: string | null } | null
  contact: { id: string; first_name: string | null; last_name: string | null; phone: string | null; do_not_contact: boolean | null; timezone: string | null } | null
  flags: C2CFlags
  dncListHit: boolean
  suppressed: boolean
  staffPhone: string | null
  onAllowlist: boolean
  attempts: string[]
  line: LineChoice | null
  defaultTz: string | null
  now: Date
}
export type RefusalCode =
  | 'wrong_org' | 'flag_off' | 'no_contact' | 'no_contact_phone' | 'do_not_contact' | 'suppressed'
  | 'no_staff_phone' | 'no_line' | 'not_allowlisted' | 'rate_limited'
export interface Summary {
  contactName: string
  contactPhone: string
  staffPhone: string
  line: LineChoice | null
  quiet: { outside: boolean; timezone: string; localTime: string } | null
  live: boolean
}
export type Decision =
  | ({ ok: true } & Summary)
  | ({ ok: false; code: RefusalCode; status: number; message: string } & Summary)

export function decide(f: Facts): Decision {
  const contactPhone = toE164(String(f.contact?.phone || ''))
  const staffPhone = toE164(String(f.staffPhone || ''))
  const name = [f.contact?.first_name, f.contact?.last_name].filter(Boolean).join(' ').trim() || 'this contact'
  const summary: Summary = {
    contactName: name, contactPhone, staffPhone, line: f.line, live: f.flags.live,
    quiet: f.contact ? quietHours(f.now, f.contact.timezone, f.defaultTz) : null,
  }
  const no = (code: RefusalCode, status: number, message: string): Decision => ({ ok: false, code, status, message, ...summary })

  if (!f.conversation || !f.callerOrgIds.includes(f.conversation.org_id)) {
    return no('wrong_org', 403, 'You do not have access to that conversation.')
  }
  if (!f.flags.enabled) return no('flag_off', 403, 'Click-to-call is turned off for this organization.')
  if (!f.contact) return no('no_contact', 404, 'This conversation has no contact to call.')
  if (!contactPhone) return no('no_contact_phone', 422, `${name} has no phone number on file.`)
  if (f.contact.do_not_contact || f.dncListHit) return no('do_not_contact', 403, `${name} is on the do-not-contact list, so calls are blocked.`)
  if (f.suppressed) return no('suppressed', 403, `${name}'s number is suppressed, so calls are blocked.`)
  if (!staffPhone) return no('no_staff_phone', 422, 'Add your phone number to your team profile so the call can ring you first.')
  if (!f.line) return no('no_line', 422, 'This organization has no phone line set up to call from.')
  if (!f.flags.live && !f.onAllowlist) {
    return no('not_allowlisted', 403, 'Click-to-call is in test mode. This contact is not on the test list, so it cannot be called yet.')
  }
  const rl = rateLimitProblem(f.attempts, f.now)
  if (rl) return no('rate_limited', 429, `You have placed several calls in a short time. Try again in ${rl.retryAfterMinutes} minute${rl.retryAfterMinutes === 1 ? '' : 's'}.`)
  return { ok: true, ...summary }
}

// ── TwiML. Built by hand so this module stays pure. No <Record>, no record attribute.
export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
const VOICE = 'Polly.Joanna'
/** Staff leg answered: ask for a 1 so a voicemail pickup never dials the contact. */
export function confirmTwiml(actionUrl: string, firstName: string | null): string {
  const who = (firstName || '').trim() || 'your contact'
  return `<?xml version="1.0" encoding="UTF-8"?><Response>`
    + `<Gather numDigits="1" timeout="8" method="POST" action="${xmlEscape(actionUrl)}">`
    + `<Say voice="${VOICE}">Press 1 to call ${xmlEscape(who)}.</Say></Gather>`
    + `<Say voice="${VOICE}">No key was pressed. Goodbye.</Say><Hangup/></Response>`
}
/** Staff pressed 1: dial the contact with the conversation's line as caller ID. */
export function dialTwiml(contactE164: string, callerId: string, actionUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${VOICE}">Connecting.</Say>`
    + `<Dial callerId="${xmlEscape(callerId)}" answerOnBridge="true" timeout="30" method="POST" action="${xmlEscape(actionUrl)}">`
    + `<Number>${xmlEscape(contactE164)}</Number></Dial></Response>`
}
export function hangupTwiml(say?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say ? `<Say voice="${VOICE}">${xmlEscape(say)}</Say>` : ''}<Hangup/></Response>`
}

// ── Outcomes. call_logs.status allows ringing, in_progress, completed, missed, voicemail, failed.
export type CallStatus = 'completed' | 'missed' | 'failed'
/** The <Dial> to the contact ended. Duration is talk time with the contact. */
export function dialOutcome(dialStatus: string, dialDuration: string | undefined) {
  const seconds = Math.max(0, parseInt(dialDuration || '0', 10) || 0)
  switch (dialStatus) {
    case 'completed': return { status: 'completed' as CallStatus, outcome: 'connected', seconds }
    case 'answered': return { status: 'completed' as CallStatus, outcome: 'connected', seconds }
    case 'no-answer': return { status: 'missed' as CallStatus, outcome: 'contact_no_answer', seconds: 0 }
    case 'busy': return { status: 'missed' as CallStatus, outcome: 'contact_busy', seconds: 0 }
    case 'canceled': return { status: 'failed' as CallStatus, outcome: 'staff_hung_up_before_answer', seconds: 0 }
    default: return { status: 'failed' as CallStatus, outcome: 'contact_failed', seconds: 0 }
  }
}
/** The staff leg ended without the contact ever being dialed. */
export function staffLegOutcome(callStatus: string): { status: CallStatus; outcome: string } {
  switch (callStatus) {
    case 'completed': return { status: 'failed', outcome: 'staff_no_confirm' }
    case 'no-answer': return { status: 'failed', outcome: 'staff_no_answer' }
    case 'busy': return { status: 'failed', outcome: 'staff_busy' }
    case 'canceled': return { status: 'failed', outcome: 'staff_canceled' }
    default: return { status: 'failed', outcome: 'staff_failed' }
  }
}
export const TERMINAL_CALL_STATUSES = ['completed', 'no-answer', 'busy', 'failed', 'canceled']

/** The callback URLs. Query order is fixed, since the signature covers the full URL. */
export function callbackUrls(base: string, callLogId: string) {
  const b = base.replace(/\/+$/, '')
  const id = encodeURIComponent(callLogId)
  return {
    bridge: `${b}/api/twilio/click-to-call/bridge?log=${id}`,
    confirm: `${b}/api/twilio/click-to-call/bridge?log=${id}&step=dial`,
    status: `${b}/api/twilio/click-to-call/status?log=${id}`,
    dialAction: `${b}/api/twilio/click-to-call/status?log=${id}&leg=dial`,
  }
}
