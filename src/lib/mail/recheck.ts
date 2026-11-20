// src/lib/mail/recheck.ts
// The daily automatic recheck of a mailbox marked error (run from the mail-sync cron, before the sync). Once a day per
// mailbox it runs the same token check the Check button runs (/api/mail/check: a fresh access token from the stored
// sign-in, then Gmail users.getProfile, which must answer for the connected address).
//   success  status back to 'active', last_checked_at set, last_error cleared: the same run's sync picks it up again
//   failure  the error stays; last_error records the code and its fixed Hub text
// Once a day is tracked in job_runs (job 'mail-recheck', detail { connection_id, code }): hub_mail_connections has no
// metadata column, and a new column is not wanted. The day is claimed BEFORE the check, so a run that dies midway does
// not recheck again the same day. Nothing here stores a token: the stored sign-in is only read.
import type { SupabaseClient } from '@supabase/supabase-js'
import { MailError, accessTokenFor, gmailProfile, lastErrorText, refreshTokenFor, safeMessage } from './google'

export const RECHECK_EVERY_MS = 24 * 3_600_000
export const RECHECK_JOB = 'mail-recheck'

export type Checker = (db: SupabaseClient, row: { id: string; email_address: string }) => Promise<void>

/** The Check button's check. Throws MailError with a code on any failure. */
export const liveCheck: Checker = async (db, row) => {
  const profile = await gmailProfile(await accessTokenFor(await refreshTokenFor(db, row.id)))
  if (profile.emailAddress.toLowerCase() !== row.email_address.toLowerCase()) {
    throw new MailError('Gmail answered for a different address than the one connected.', 'address_mismatch')
  }
}

export interface RecheckResult { connection_id: string; ok: boolean; code: string | null }

export async function recheckErrored(db: SupabaseClient, now: number, check: Checker = liveCheck): Promise<RecheckResult[]> {
  const iso = new Date(now).toISOString()
  const { data: rows, error } = await db.from('hub_mail_connections').select('id, email_address').eq('status', 'error')
  if (error) throw new Error(`hub_mail_connections read failed: ${error.code ?? 'unknown'}`)
  if (!rows?.length) return []
  const { data: recent, error: rErr } = await db.from('job_runs').select('detail').eq('job', RECHECK_JOB).gte('started_at', new Date(now - RECHECK_EVERY_MS).toISOString())
  if (rErr) throw new Error(`job_runs read failed: ${rErr.code ?? 'unknown'}`)
  const done = new Set(((recent ?? []) as any[]).map((r) => String(r.detail?.connection_id ?? '')))
  const out: RecheckResult[] = []
  for (const row of rows as any[]) {
    if (done.has(row.id)) continue
    const { data: claim, error: cErr } = await db.from('job_runs').insert({ job: RECHECK_JOB, started_at: iso, detail: { connection_id: row.id } }).select('id').single()
    if (cErr || !claim) continue
    let code: string | null = null
    try {
      await check(db, row)
      await db.from('hub_mail_connections').update({ status: 'active', last_checked_at: iso, last_error: null }).eq('id', row.id).eq('status', 'error')
    } catch (e) {
      code = e instanceof MailError ? e.code : 'unknown'
      await db.from('hub_mail_connections').update({ last_error: lastErrorText(code, safeMessage(e)) }).eq('id', row.id)
    }
    // ok: the recheck ran (a mailbox still in error is not a failed job; its code is in detail)
    await db.from('job_runs').update({ finished_at: iso, ok: true, rows_touched: code ? 0 : 1, detail: { connection_id: row.id, code } }).eq('id', (claim as any).id)
    out.push({ connection_id: row.id, ok: !code, code })
  }
  return out
}
