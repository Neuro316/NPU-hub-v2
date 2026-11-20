// src/lib/texts/status-callback.ts
// What a Twilio message status callback may do to a crm_messages row (used by /api/twilio/message-status).
//
// FORWARD ONLY. Twilio's callbacks can arrive out of order: a late "sending" or "accepted" used to set a delivered or
// failed text back to queued (q43: three texts carried a carrier error code yet showed queued). The order is
// queued < sent < delivered, and failed is final; delivered is final too. The rule is enforced IN THE UPDATE (a where
// clause on the current status), not by reading the row first, so two callbacks for one text arriving together cannot
// race. A callback that would move a row backwards is ignored for the status, logged with the sid, the incoming and the
// current status (job_runs, job 'text-status-ignored'), and its identity fields and carrier error code are still
// recorded.
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Twilio's MessageStatus vocabulary is wider than the crm_messages_status_check constraint (queued | scheduled | sent |
 * delivered | failed | received). `undelivered` -> `failed` matters most: it is what a carrier rejection reports; the
 * specific reason is kept in error_code.
 */
export const STATUS_MAP: Record<string, string> = {
  accepted: 'queued',
  scheduled: 'scheduled',
  queued: 'queued',
  sending: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  read: 'delivered',
  receiving: 'received',
  received: 'received',
  undelivered: 'failed',
  failed: 'failed',
  canceled: 'failed',
}

/** From each current status, the statuses a callback may set. One line per current status. */
export const NEXT_FROM: Record<string, string[]> = {
  scheduled: ['scheduled', 'queued', 'sent', 'delivered', 'failed'],
  queued: ['queued', 'sent', 'delivered', 'failed'],
  sent: ['sent', 'delivered', 'failed'],
  delivered: ['delivered'],
  failed: ['failed'],
  received: ['received'],
}

/** The current statuses a row may be in for a callback to set `next`: the where clause of the update. */
export function allowedFrom(next: string): string[] {
  return Object.keys(NEXT_FROM).filter((cur) => NEXT_FROM[cur].includes(next))
}

export const IGNORED_JOB = 'text-status-ignored'

export interface CallbackResult { ok: true; updated: number; ignored?: { incoming: string; current: string | null }; skipped?: string }

/** Applies one verified callback. Never inserts a message; a sid the Hub has no row for is reported, not invented. */
export async function applyStatusCallback(db: SupabaseClient, params: Record<string, string>): Promise<CallbackResult> {
  const sid = params.MessageSid || params.SmsSid || ''
  if (!sid) return { ok: true, updated: 0, skipped: 'no message sid' }

  // identity and the carrier error code are recorded whatever the status does
  const identity: Record<string, unknown> = {}
  if (params.From) identity.from_e164 = params.From
  if (params.To) identity.to_e164 = params.To
  if (params.ErrorCode) identity.error_code = params.ErrorCode
  const mapped = STATUS_MAP[String(params.MessageStatus || '').toLowerCase()]
  if (!mapped && params.MessageStatus) console.warn('[message-status] unmapped Twilio status', params.MessageStatus, 'sid', sid)

  if (mapped) {
    // the forward-only rule, in the update's where clause
    const { data: moved, error } = await db.from('crm_messages').update({ ...identity, status: mapped }).eq('twilio_sid', sid).in('status', allowedFrom(mapped)).select('id')
    if (error) throw new Error(`crm_messages update: ${error.code ?? 'unknown'}`)
    if (moved?.length) return { ok: true, updated: moved.length }
  }
  if (!mapped && !Object.keys(identity).length) return { ok: true, updated: 0, skipped: 'nothing to set' }

  // the status did not move (backwards, or no row): still record identity and error code, and read what is there
  const { data: rows, error: iErr } = Object.keys(identity).length
    ? await db.from('crm_messages').update(identity).eq('twilio_sid', sid).select('id, status')
    : await db.from('crm_messages').select('id, status').eq('twilio_sid', sid)
  if (iErr) throw new Error(`crm_messages update: ${iErr.code ?? 'unknown'}`)
  if (!rows?.length) {
    console.warn('[message-status] no crm_messages row for sid', sid, 'status', params.MessageStatus)
    return { ok: true, updated: 0 }
  }
  if (!mapped) return { ok: true, updated: rows.length }
  const current = (rows[0] as any).status ?? null
  const at = new Date().toISOString()
  await db.from('job_runs').insert({ job: IGNORED_JOB, started_at: at, finished_at: at, ok: true, rows_touched: 0,
    detail: { sid, incoming: String(params.MessageStatus), mapped, current } })
  console.warn('[message-status] backwards callback ignored', 'sid', sid, 'incoming', params.MessageStatus, 'current', current)
  return { ok: true, updated: 0, ignored: { incoming: mapped, current } }
}
