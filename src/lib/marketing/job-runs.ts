// src/lib/marketing/job-runs.ts
// Every cron this build adds records start, finish, rows touched and error in
// public.job_runs (ruling 13). The watchdog reads the same table.
import type { SupabaseClient } from '@supabase/supabase-js'

export async function startJob(db: SupabaseClient, job: string): Promise<string | null> {
  const { data, error } = await db.from('job_runs').insert({ job }).select('id').single()
  if (error) console.error(`[job-runs] start ${job} failed: ${error.code ?? 'unknown'}`)
  return data?.id ?? null
}

export async function finishJob(
  db: SupabaseClient, runId: string | null,
  r: { ok: boolean; rows: number; error?: string | null; detail?: Record<string, unknown> },
): Promise<void> {
  if (!runId) return
  const { data, error } = await db.from('job_runs').update({
    finished_at: new Date().toISOString(), ok: r.ok, rows_touched: r.rows,
    error: r.error ? r.error.slice(0, 500) : null, detail: r.detail ?? {},
  }).eq('id', runId).select('id')
  if (error || (data?.length ?? 0) !== 1) {
    console.error(`[job-runs] finish ${runId} ${error ? `error ${error.code ?? 'unknown'}` : `matched ${data?.length ?? 0} rows`}`)
  }
}

/** Runs `fn` between startJob and finishJob, so a throw is still recorded. */
export async function withJobRun<T extends { rows: number; detail?: Record<string, unknown> }>(
  db: SupabaseClient, job: string, fn: () => Promise<T>,
): Promise<T> {
  const runId = await startJob(db, job)
  try {
    const out = await fn()
    await finishJob(db, runId, { ok: true, rows: out.rows, detail: out.detail })
    return out
  } catch (e: any) {
    await finishJob(db, runId, { ok: false, rows: 0, error: `${e?.name ?? 'Error'}: ${String(e?.message ?? e)}` })
    throw e
  }
}
