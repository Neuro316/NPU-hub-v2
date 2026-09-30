// GET /api/cron/sms-outbox (Vercel cron, every minute)
//
// Drains public.hub_sms_outbox. Scheduled tasks INSERT a row { org_id, user_id, body,
// source }; this sends it through src/lib/notify-sms.ts, the same path as
// POST /api/notify/sms: the owner's own profile phone only, after the consent
// gate, from the Primary line, split into ordered parts.
//
// RECIPIENTS: superadmins only. Before sending, the row's profile role is read; a
// missing profile or any other role is skipped with 'recipient_not_allowed' and
// nothing is sent (src/lib/sms-outbox.ts outboxRecipientGate). The HTTP route has
// no such guard.
//
// Auth: `Authorization: Bearer <CRON_SECRET>`, the pattern the other crons use
// (Vercel attaches it when CRON_SECRET is set). Unlike them this FAILS CLOSED: an
// unset or empty CRON_SECRET refuses every request, rather than accepting the
// literal "Bearer undefined". /api/cron is excluded from the session middleware,
// so this check is the only gate.
//
// Claiming: rows are claimed ONE AT A TIME with a conditional update
// (pending -> sending, only if still pending), verified by ROW COUNT, so two
// overlapping runs can never both claim, and so never both send, the same row.
// A row that fails after ANY part went out is failed and never retried, and a row
// left in 'sending' past OUTBOX_STUCK_MINUTES is failed and never retried, so no
// part is ever sent twice. What this costs: a crash mid-row means a human checks
// Conversations and resends by hand.
//
// Never logs body text, phone numbers or tokens: row ids, part counts, statuses.
// last_error holds codes and reasons only.
import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createAdminSupabase } from '@/lib/supabase'
import { sendNotifySms } from '@/lib/notify-sms'
import { outboxFinish, outboxRecipientGate, OUTBOX_STUCK_ERROR, OUTBOX_STUCK_MINUTES, type OutboxFinish } from '@/lib/sms-outbox'

export const maxDuration = 60
const BATCH = 5
// Stop claiming new rows after this long, so a 13-part row still finishes inside maxDuration.
const CLAIM_BUDGET_MS = 40_000

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !secret.trim()) {
    console.error('[cron/sms-outbox] CRON_SECRET is not set on this host; refusing every request')
    return false
  }
  const got = createHash('sha256').update(req.headers.get('authorization') || '').digest()
  const want = createHash('sha256').update(`Bearer ${secret}`).digest()
  return got.length === want.length && timingSafeEqual(got, want)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const started = Date.now()
  const db = createAdminSupabase()

  // ── 1. Stuck rows: failed, never resent. A part may already have gone out. ──
  const cutoff = new Date(Date.now() - OUTBOX_STUCK_MINUTES * 60_000).toISOString()
  const { data: stuck, error: stuckErr } = await db.from('hub_sms_outbox')
    .update({ status: 'failed', last_error: OUTBOX_STUCK_ERROR })
    .eq('status', 'sending').lt('claimed_at', cutoff)
    .select('id')
  if (stuckErr) console.error(`[cron/sms-outbox] stuck sweep failed: ${stuckErr.code ?? 'unknown'}`)
  for (const s of stuck ?? []) console.error(`[cron/sms-outbox] row=${s.id} status=failed reason=stuck_in_sending`)

  // ── 2. The oldest pending rows, read ONCE, so a row put back to pending this
  //       run is not retried again seconds later in the same run. ──
  const { data: candidates, error: listErr } = await db.from('hub_sms_outbox')
    .select('id').eq('status', 'pending')
    .order('created_at', { ascending: true }).limit(BATCH)
  if (listErr) {
    console.error(`[cron/sms-outbox] list failed: ${listErr.code ?? 'unknown'}`)
    return NextResponse.json({ error: 'list failed', stuck_failed: stuck?.length ?? 0 }, { status: 500 })
  }

  const processed: Array<{ id: string; status: string; sent_parts: number; total_parts: number | null }> = []
  for (const cand of candidates ?? []) {
    if (Date.now() - started > CLAIM_BUDGET_MS) break

    // ── 3. Claim: pending -> sending ONLY if still pending. Exactly one row, or skip. ──
    const { data: claimed, error: claimErr } = await db.from('hub_sms_outbox')
      .update({ status: 'sending', claimed_at: new Date().toISOString() })
      .eq('id', cand.id).eq('status', 'pending')
      .select('id, org_id, user_id, body, attempts')
    if (claimErr || (claimed?.length ?? 0) !== 1) {
      console.info(`[cron/sms-outbox] row=${cand.id} not claimed (${claimErr ? `error ${claimErr.code ?? 'unknown'}` : `matched ${claimed?.length ?? 0} rows`})`)
      continue
    }
    const row = claimed![0]

    // ── 4. Recipient guard: the outbox texts superadmins only. Checked before
    //       anything is sent; a refusal is final (skipped), a failed read retries. ──
    let finish: OutboxFinish | null
    const { data: who, error: whoErr } = await db.from('profiles').select('role').eq('id', row.user_id).maybeSingle()
    finish = outboxRecipientGate(
      { role: who?.role ?? null, found: !!who, readErrorCode: whoErr ? (whoErr.code ?? 'unknown') : null },
      row.attempts ?? 0,
    )
    if (finish) console.info(`[cron/sms-outbox] row=${row.id} recipient guard: ${finish.status} ${finish.last_error}`)

    // ── 5. Send through the shared path. An unexpected throw may come after a
    //       part went out, so it is treated as a possible partial send: failed. ──
    if (!finish) {
      try {
        const r = await sendNotifySms({ user_id: row.user_id, body: row.body, org_id: row.org_id })
        finish = outboxFinish(r, row.attempts ?? 0, new Date().toISOString())
      } catch (e: any) {
        console.error(`[cron/sms-outbox] row=${row.id} threw: ${e?.name ?? 'Error'}`)
        finish = { status: 'failed' as const, attempts: (row.attempts ?? 0) + 1, sent_parts: 0, total_parts: null,
          last_error: 'unexpected_error, possible partial send, check Conversations', sent_at: null }
      }
    }

    // ── 6. Record, only if the row is still ours (still 'sending'). ──
    const { data: fin, error: finErr } = await db.from('hub_sms_outbox')
      .update(finish).eq('id', row.id).eq('status', 'sending').select('id')
    if (finErr || (fin?.length ?? 0) !== 1) {
      console.error(`[cron/sms-outbox] row=${row.id} FINISH WRITE (${finish.status}) ${finErr ? `error ${finErr.code ?? 'unknown'}` : `matched ${fin?.length ?? 0} rows`}; the stuck sweep will fail it`)
    }
    console.info(`[cron/sms-outbox] row=${row.id} status=${finish.status} parts=${finish.sent_parts}/${finish.total_parts ?? 0} attempts=${finish.attempts}`)
    processed.push({ id: row.id, status: finish.status, sent_parts: finish.sent_parts, total_parts: finish.total_parts })
  }

  return NextResponse.json({ stuck_failed: stuck?.length ?? 0, processed })
}
