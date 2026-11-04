// src/lib/outbound-call-status.ts
// Status, duration and end time for OUTBOUND browser calls (Dialer, contact Call
// buttons, the top Call button), from Twilio's callbacks.
//
// voice/token creates the call_logs row as 'ringing' before the call exists, and
// inbound-call stamps the parent (browser leg) CallSid on it. Two callbacks then
// report on the call, both to /api/twilio/call-status:
//
//   <Number statusCallback>  the CHILD leg to the contact: 'answered' and
//                            'completed' events, CallStatus + CallDuration,
//                            ParentCallSid = the stamped SID. Sent whoever hangs up.
//   <Dial action>            when the dial ends while the browser is still on:
//                            DialCallStatus + DialCallDuration, CallSid = parent.
//
// Either may arrive first, or only one may arrive; both are applied the same way
// and the first final status wins. call_logs.status allows ringing, in_progress,
// completed, missed, voicemail and failed (call_logs_status_check). The old route
// wrote 'in-progress', which that check rejects, and found its row through a
// contacts embed that does not exist (call_logs has no foreign key to contacts),
// so every outbound row stayed 'ringing' with 0 seconds.
//
// No relative imports: scripts/tests/outbound-call-status.test.mjs loads
// this file directly under node's type stripping.

export type OutboundRowStatus = 'ringing' | 'in_progress' | 'completed' | 'failed'

export interface OutboundStatusEvent {
  /** The SID stamped on the call log row (the parent browser leg). */
  parentCallSid: string
  status: OutboundRowStatus | null
  /** Seconds the contact was connected, when the event carries it. */
  durationSeconds: number | null
}

const FINAL = new Set<OutboundRowStatus>(['completed', 'failed'])

/** Twilio call status -> row status. null means "nothing to record". */
export function mapTwilioCallStatus(s: string | undefined | null): OutboundRowStatus | null {
  switch (String(s || '').toLowerCase()) {
    case 'in-progress':
    case 'answered':
      return 'in_progress'
    case 'completed':
      return 'completed'
    // Never connected. The thread shows these as "Not connected".
    case 'busy':
    case 'no-answer':
    case 'failed':
    case 'canceled':
      return 'failed'
    default:
      // queued, initiated, ringing: the row already says ringing.
      return null
  }
}

/** Read either callback shape. null when it cannot be tied to a call log row. */
export function parseOutboundStatusEvent(params: Record<string, string>): OutboundStatusEvent | null {
  const isDialAction = 'DialCallStatus' in params
  const parentCallSid = (isDialAction ? params.CallSid : (params.ParentCallSid || '')).trim()
  if (!parentCallSid) return null
  const raw = isDialAction ? params.DialCallStatus : params.CallStatus
  const dur = parseInt((isDialAction ? params.DialCallDuration : params.CallDuration) || '', 10)
  return {
    parentCallSid,
    status: mapTwilioCallStatus(raw),
    durationSeconds: Number.isFinite(dur) && dur >= 0 ? dur : null,
  }
}

export interface OutboundRowState {
  status: string | null
  duration_seconds: number | null
}

/**
 * The fields to write for this event, or null for no write. `becameFinal` is true
 * only on the event that first moves the row to completed / failed, so per-call
 * side effects (contact talk time, activity) happen once.
 */
export function outboundCallUpdate(
  row: OutboundRowState,
  ev: OutboundStatusEvent,
  nowIso: string
): { updates: Record<string, unknown>; becameFinal: boolean } | null {
  const current = (row.status || 'ringing') as string
  const alreadyFinal = FINAL.has(current as OutboundRowStatus)
  if (alreadyFinal) {
    // The other callback for the same call: only a longer duration is news.
    if (ev.durationSeconds != null && ev.durationSeconds > (row.duration_seconds ?? 0)) {
      return { updates: { duration_seconds: ev.durationSeconds }, becameFinal: false }
    }
    return null
  }
  if (!['ringing', 'in_progress'].includes(current)) return null // e.g. voicemail
  if (!ev.status || ev.status === 'ringing') return null
  if (ev.status === 'in_progress') {
    return current === 'in_progress' ? null : { updates: { status: 'in_progress' }, becameFinal: false }
  }
  return {
    updates: {
      status: ev.status,
      duration_seconds: ev.status === 'completed' ? (ev.durationSeconds ?? 0) : 0,
      ended_at: nowIso,
    },
    becameFinal: true,
  }
}
