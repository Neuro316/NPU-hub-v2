// src/lib/health/run.ts
// Server only (service role). One Hub Health capture: read every tile's source, write one 'hub' row per tile to
// platform_health_snapshots, and open or resolve platform_alerts on a colour change against each tile's previous
// 'hub' snapshot. A change into red texts the owner through hub_sms_outbox (the urgent-notification path), only when
// the org's notification mode is live; otherwise the alert records the text as held. Writes source 'hub' only.
//
// Reads only, besides those writes. University tables (np_hrv_sync_state) are read only. No message text, address
// or name is read: the failure tiles count rows by status.
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  TILES, TILE_LABEL, alertAction, ciMain, failures, guards, mailboxErrors, migrationParity, openPrsRed, platformSnapshotAge, previousHub, prodDeploy,
  smsBody, xregSyncAge, type CiRun, type Deploy, type GuardResult, type Pr, type SnapshotRow, type TileResult,
} from './rules'

export const HUB_REPO = 'Neuro316/NPU-hub-v2'
export const NP_ORG = '00000000-0000-0000-0000-000000000001'
/** The owner's Hub profile (the watchdog's recipient). Overridable with HUB_HEALTH_ALERT_USER_ID. */
export const DEFAULT_ALERT_USER = '22456608-5f7d-495e-af02-7037fea125cc'
const DAY = 86_400_000
const RED_CHECK = ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']

export interface RepoFacts { hubMigrations: string[]; guards: GuardResult[]; prefixOverlap: string[] }
export type GitHubGet = (path: string) => Promise<{ status: number; data: any }>
export interface Deps {
  db: SupabaseClient
  now: number
  github: GitHubGet | null
  repo: RepoFacts
  alertUserId: string
  mode: () => Promise<string>
  hubUrl: string
}

/** A GitHub reader with a read-only token, or null when the token is not set (the tiles then say unknown). */
export function githubFrom(token: string | undefined, fetchImpl: typeof fetch = fetch): GitHubGet | null {
  if (!token || !token.trim()) return null
  return async (path) => {
    const r = await fetchImpl(`https://api.github.com/repos/${HUB_REPO}${path}`, {
      headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/vnd.github+json', 'User-Agent': 'npu-hub-health', 'X-GitHub-Api-Version': '2022-11-28' },
      cache: 'no-store',
    })
    return { status: r.status, data: r.ok ? await r.json().catch(() => null) : null }
  }
}

async function githubTiles(gh: GitHubGet | null): Promise<TileResult[]> {
  if (!gh) return [ciMain({ token: false, run: null }), prodDeploy({ token: false, deploy: null }), openPrsRed({ token: false, prs: null })]
  const safe = async <T,>(f: () => Promise<T>): Promise<{ v: T | null; error: string | null }> => {
    try { return { v: await f(), error: null } } catch (e: any) { return { v: null, error: String(e?.message ?? 'error').slice(0, 40) } }
  }
  const need = (r: { status: number; data: any }) => { if (r.status !== 200 || !r.data) throw new Error(`HTTP ${r.status}`); return r.data }

  const ci = await safe(async () => {
    const d = need(await gh('/actions/runs?branch=main&status=completed&event=push&per_page=1'))
    const run = d.workflow_runs?.[0]
    return run ? ({ conclusion: run.conclusion ?? null, head_sha: String(run.head_sha ?? ''), updated_at: String(run.updated_at ?? '') } as CiRun) : null
  })
  const dep = await safe(async () => {
    const list = need(await gh('/deployments?environment=Production&per_page=1'))
    const d = list[0]
    if (!d) return null
    const st = need(await gh(`/deployments/${encodeURIComponent(d.id)}/statuses?per_page=1`))
    return { sha: String(d.sha ?? ''), created_at: String(d.created_at ?? ''), state: st[0]?.state ?? null } as Deploy
  })
  const prs = await safe(async () => {
    const list = need(await gh('/pulls?state=open&per_page=30')) as any[]
    const out: Pr[] = []
    for (const p of list.slice(0, 30)) {
      const runs = need(await gh(`/commits/${encodeURIComponent(p.head?.sha ?? '')}/check-runs?per_page=100`))
      out.push({ number: Number(p.number), red: (runs.check_runs ?? []).some((c: any) => RED_CHECK.includes(c.conclusion)) })
    }
    return out
  })
  return [
    ciMain({ token: true, run: ci.v, error: ci.error }),
    prodDeploy({ token: true, deploy: dep.v, error: dep.error }),
    openPrsRed({ token: true, prs: prs.v, error: prs.error }),
  ]
}

/** A count of rows, or null when the table could not be read. */
async function count(q: PromiseLike<{ count: number | null; error: any }>): Promise<number | null> {
  const { count: n, error } = await q
  return error ? null : n ?? 0
}

export async function collectTiles(d: Deps): Promise<TileResult[]> {
  const { db, now } = d
  const since = new Date(now - DAY).toISOString()
  const head = { count: 'exact' as const, head: true }

  const gh = await githubTiles(d.github)

  const { data: ledger, error: lErr } = await db.rpc('hub_migration_ledger')
  const parity = migrationParity({ repo: d.repo.hubMigrations, ledger: lErr ? null : ((ledger ?? []) as any[]).map((r) => (typeof r === 'string' ? r : r?.name ?? r?.hub_migration_ledger)).filter(Boolean), error: lErr ? 'hub_244 ledger reader not installed' : null })

  const { data: sync, error: sErr } = await db.from('np_hrv_sync_state').select('is_active, last_sync_at, sync_interval_minutes, last_error_at')
  const xreg = sErr ? xregSyncAge({ rows: [], now }) : xregSyncAge({ rows: (sync ?? []) as any[], now })

  const crm = failures('crm_sync_failures', {
    'failed job runs': await count(db.from('job_runs').select('id', head).eq('ok', false).neq('job', 'hub-health').gte('started_at', since)),
  })
  const sms = failures('sms_failures', {
    'texts failed': await count(db.from('crm_messages').select('id', head).eq('direction', 'outbound').in('status', ['failed', 'undelivered']).gte('created_at', since)),
    'outbox failed': await count(db.from('hub_sms_outbox').select('id', head).eq('status', 'failed').gte('created_at', since)),
    'campaign texts failed': await count(db.from('message_sends').select('id', head).eq('channel', 'sms').eq('status', 'failed').gte('claimed_at', since)),
  })
  const email = failures('email_failures', {
    'campaign emails failed': await count(db.from('message_sends').select('id', head).eq('channel', 'email').eq('status', 'failed').gte('claimed_at', since)),
    'stage emails failed': await count(db.from('stage_email_sends').select('id', head).eq('status', 'failed').gte('claimed_at', since)),
  })
  const slack = failures('slack_failures', {
    'lead alert posts failed': await count(db.from('hub_lead_alerts').select('id', head).eq('push_status', 'failed').gte('created_at', since)),
  })

  const { data: boxes, error: bErr } = await db.from('hub_mail_connections').select('status, last_error')
  const mail = bErr ? { ...mailboxErrors({ boxes: [] }), status: 'unknown' as const, reason: 'Mailboxes could not be read' } : mailboxErrors({ boxes: (boxes ?? []) as any[] })

  const { data: plat } = await db.from('platform_health_snapshots').select('captured_at').eq('source', 'platform').order('captured_at', { ascending: false }).limit(1)
  const platform = platformSnapshotAge({ latest: (plat as any[] | null)?.[0]?.captured_at ?? null, now })

  const g = guards({ guards: d.repo.guards, prefixOverlap: d.repo.prefixOverlap })
  const all = [...gh, parity, g, xreg, crm, sms, email, slack, mail, platform]
  return TILES.map((t) => all.find((x) => x.kind === t.kind)!).filter(Boolean)
}

export interface RunResult { written: number; opened: string[]; resolved: string[]; texts: Record<string, string> }

/** Writes the snapshots and applies the alert rules. */
export async function runHubHealth(d: Deps): Promise<RunResult> {
  const { db } = d
  const capturedAt = new Date(d.now).toISOString()
  const tiles = await collectTiles(d)

  // previous HUB snapshots only; a platform row is never compared with a hub tile
  const { data: prevRows, error: pErr } = await db.from('platform_health_snapshots').select('source, kind, status, captured_at')
    .eq('source', 'hub').in('kind', tiles.map((t) => t.kind)).order('captured_at', { ascending: false }).limit(200)
  if (pErr) throw new Error(`snapshots read: ${pErr.code ?? 'unknown'}`)
  const prev = (prevRows ?? []) as SnapshotRow[]

  const { error: wErr } = await db.from('platform_health_snapshots').insert(tiles.map((t) => ({
    source: 'hub', kind: t.kind, status: t.status, value: t.value, detail: { reason: t.reason, ...t.detail }, captured_at: capturedAt,
  })))
  if (wErr) throw new Error(`snapshots write: ${wErr.code ?? 'unknown'}`)

  const out: RunResult = { written: tiles.length, opened: [], resolved: [], texts: {} }
  for (const t of tiles) {
    const act = alertAction(previousHub(prev, t.kind), t.status)
    if (act.resolve) {
      const { error } = await db.from('platform_alerts').update({ resolved_at: capturedAt }).eq('source', 'hub').eq('kind', t.kind).is('resolved_at', null)
      if (error) throw new Error(`alert resolve: ${error.code ?? 'unknown'}`)
      out.resolved.push(t.kind)
    }
    if (!act.open) continue
    let text: string | null = null
    if (act.text) {
      const mode = await d.mode()
      if (mode === 'live') {
        const { error } = await db.from('hub_sms_outbox').insert({ org_id: NP_ORG, user_id: d.alertUserId, source: `hub-health:${t.kind}`, body: smsBody(t.kind, t.reason, d.hubUrl) })
        text = error ? `queue_failed_${error.code ?? 'unknown'}` : 'queued'
      } else text = `held_mode_${mode}`
      out.texts[t.kind] = text
    }
    const { error } = await db.from('platform_alerts').insert({
      source: 'hub', kind: t.kind, severity: act.open, message: `${TILE_LABEL[t.kind]}: ${t.reason}`.slice(0, 300),
      detail: { status: t.status, value: t.value, ...(text ? { text } : {}) }, opened_at: capturedAt,
    })
    // 23505: an alert for this tile is already open (a capture raced this one); nothing more to do
    if (error && error.code !== '23505') throw new Error(`alert open: ${error.code ?? 'unknown'}`)
    out.opened.push(t.kind)
  }
  return out
}
