// src/lib/marketing/watchdog.ts
// Pure decision for the job watchdog: given recent job_runs, which jobs are unhealthy.
// A job is unhealthy when it has not STARTED within its allowed gap, or when its two
// most recent FINISHED runs both failed (ruling 13: "has not run or failed twice").

export interface ExpectedJob { job: string; maxGapMinutes: number }
export interface RunRow { job: string; started_at: string; finished_at: string | null; ok: boolean | null }
export interface Problem { job: string; problem: 'not_running' | 'failed_twice'; detail: string }

/** Jobs this build adds. Existing crons do not write job_runs and are not listed. */
export const EXPECTED_JOBS: ExpectedJob[] = [
  { job: 'campaign-steps', maxGapMinutes: 20 },
]

export function findProblems(expected: ExpectedJob[], runs: RunRow[], now: Date): Problem[] {
  const out: Problem[] = []
  for (const e of expected) {
    const mine = runs.filter((r) => r.job === e.job).sort((a, b) => b.started_at.localeCompare(a.started_at))
    const last = mine[0]
    if (!last || now.getTime() - new Date(last.started_at).getTime() > e.maxGapMinutes * 60_000) {
      out.push({ job: e.job, problem: 'not_running', detail: last ? `last start ${last.started_at}` : 'no run recorded' })
      continue
    }
    const finished = mine.filter((r) => r.finished_at)
    if (finished.length >= 2 && finished[0].ok === false && finished[1].ok === false) {
      out.push({ job: e.job, problem: 'failed_twice', detail: `failed at ${finished[1].finished_at} and ${finished[0].finished_at}` })
    }
  }
  return out
}

/** One text per distinct problem set, at most once per window. */
export const ALERT_REPEAT_HOURS = 6

export function alertSignature(problems: Problem[]): string {
  return problems.map((p) => `${p.job}:${p.problem}`).sort().join('|')
}

export function alertBody(problems: Problem[]): string {
  const lines = problems.map((p) => p.problem === 'not_running'
    ? `${p.job} has not run on schedule (${p.detail}).`
    : `${p.job} has failed twice in a row (${p.detail}).`)
  return `Hub watchdog: ${lines.join(' ')} Check job_runs in the Hub.`
}
