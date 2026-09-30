// src/lib/sms-outbox.ts
// Pure rules for public.hub_sms_outbox: what a claimed row becomes after one send
// attempt. No I/O, so every branch can be tested without Twilio or a database.
// The cron route (/api/cron/sms-outbox) does the claiming and writing.
import type { NotifySmsResult } from '@/lib/notify-sms'

/** A transient failure with nothing sent is retried until attempts reaches this. */
export const OUTBOX_MAX_ATTEMPTS = 3
/** A row left in 'sending' longer than this is failed, never resent. */
export const OUTBOX_STUCK_MINUTES = 10
export const OUTBOX_STUCK_ERROR = 'stuck in sending, possible partial send, check Conversations'

export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'

export interface OutboxFinish {
  status: Exclude<OutboxStatus, 'sending'>
  attempts: number
  sent_parts: number
  total_parts: number | null
  last_error: string | null
  sent_at: string | null
}

/** The only profile role the outbox will text. */
export const OUTBOX_ALLOWED_ROLE = 'superadmin'
export const OUTBOX_RECIPIENT_NOT_ALLOWED = 'recipient_not_allowed'

/**
 * Recipient guard, checked BEFORE anything is sent. Returns the row's final state
 * when the row must not be sent, or null when it may proceed.
 *
 * - role read failed          -> transient: pending again until OUTBOX_MAX_ATTEMPTS, then failed
 * - no profile, or any role
 *   other than superadmin     -> skipped, last_error 'recipient_not_allowed'
 * - superadmin                -> null (send)
 */
export function outboxRecipientGate(
  lookup: { role: string | null | undefined; readErrorCode?: string | null; found: boolean },
  attempts: number,
): OutboxFinish | null {
  const next = attempts + 1
  const none = { attempts: next, sent_parts: 0, total_parts: null, sent_at: null }
  if (lookup.readErrorCode !== undefined && lookup.readErrorCode !== null) {
    const code = `role_read_${lookup.readErrorCode}`
    if (next >= OUTBOX_MAX_ATTEMPTS) return { ...none, status: 'failed', last_error: `${code} (gave up after ${next} attempts)` }
    return { ...none, status: 'pending', last_error: code }
  }
  if (!lookup.found || lookup.role !== OUTBOX_ALLOWED_ROLE) {
    return { ...none, status: 'skipped', last_error: OUTBOX_RECIPIENT_NOT_ALLOWED }
  }
  return null
}

/**
 * The row's next state. `attempts` is the value the row carried when claimed.
 *
 * - every part sent                      -> sent
 * - refused (bad input, consent gate)    -> skipped, reason in last_error
 * - permanent Twilio 4xx                 -> failed
 * - ANY part already sent, then failure  -> failed, NEVER retried (no part is ever re-sent)
 * - transient with nothing sent          -> pending again, until OUTBOX_MAX_ATTEMPTS, then failed
 */
export function outboxFinish(r: NotifySmsResult, attempts: number, nowIso: string): OutboxFinish {
  const next = attempts + 1
  const base = { attempts: next, sent_parts: r.sent_parts, total_parts: r.total_parts || null }
  if (r.statusClass === 'ok') return { ...base, status: 'sent', last_error: null, sent_at: nowIso }
  if (r.statusClass === 'refused') return { ...base, status: 'skipped', last_error: r.reason, sent_at: null }
  const code = r.error_code ?? 'unknown'
  if (r.sent_parts > 0) {
    return { ...base, status: 'failed', last_error: `partial_send_${r.sent_parts}_of_${r.total_parts}: ${code}`, sent_at: null }
  }
  if (r.statusClass === 'permanent') return { ...base, status: 'failed', last_error: code, sent_at: null }
  // transient, nothing sent
  if (next >= OUTBOX_MAX_ATTEMPTS) return { ...base, status: 'failed', last_error: `${code} (gave up after ${next} attempts)`, sent_at: null }
  return { ...base, status: 'pending', last_error: code, sent_at: null }
}
