// src/lib/health/rules.ts
// Hub Health (Running List q23, the Hub half of Platform Health, platform k28). Pure: no imports, so the harness
// (scripts/health/hub-health-tamper.cjs) runs it directly.
//
// Each tile is one 'hub' row in platform_health_snapshots per capture (pf_313). Colours map green/amber/red to
// ok/warn/down; 'unknown' means the tile could not be read (a token is not set, a source is missing).
//
// Alerts (platform_alerts) open and resolve ONLY on a colour change against the tile's previous 'hub' snapshot. A
// platform snapshot is never compared with a hub tile.

export type Status = 'ok' | 'warn' | 'down' | 'unknown'
export interface TileResult { kind: TileKind; status: Status; value: number | null; reason: string; detail: Record<string, unknown> }

export const TILES = [
  { kind: 'ci_main', label: 'Hub CI on main' },
  { kind: 'prod_deploy', label: 'Hub production deploy' },
  { kind: 'open_prs_red', label: 'Open Hub PRs with red checks' },
  { kind: 'migration_parity', label: 'Hub migrations: repo and ledger' },
  { kind: 'guards', label: 'Hub guards' },
  { kind: 'xreg_sync_age', label: 'xRegulation sync age' },
  { kind: 'crm_sync_failures', label: 'Sync job failures (24h)' },
  { kind: 'sms_failures', label: 'Text send failures (24h)' },
  { kind: 'email_failures', label: 'Email send failures (24h)' },
  { kind: 'slack_failures', label: 'Slack post failures (24h)' },
  { kind: 'mailbox_errors', label: 'Mailbox connections in error' },
  { kind: 'platform_snapshot_age', label: 'Platform health snapshot age' },
] as const
export type TileKind = (typeof TILES)[number]['kind']
export const TILE_LABEL = Object.fromEntries(TILES.map((t) => [t.kind, t.label])) as Record<TileKind, string>

const MIN = 60_000
const tile = (kind: TileKind, status: Status, value: number | null, reason: string, detail: Record<string, unknown> = {}): TileResult =>
  ({ kind, status, value, reason: reason.replace(/\s+/g, ' ').trim().slice(0, 200), detail })
const ago = (mins: number) => (mins < 120 ? `${Math.round(mins)} min` : mins < 48 * 60 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`)

// ─── GitHub tiles (read-only token; 'unknown' when it is not set) ─────────────
export interface CiRun { conclusion: string | null; head_sha: string; updated_at: string }
export function ciMain(f: { token: boolean; run: CiRun | null; error?: string | null }): TileResult {
  if (!f.token) return tile('ci_main', 'unknown', null, 'GitHub token not set')
  if (f.error) return tile('ci_main', 'unknown', null, `GitHub could not be read (${f.error})`)
  if (!f.run) return tile('ci_main', 'unknown', null, 'No finished CI run on main')
  const sha = f.run.head_sha.slice(0, 7)
  if (f.run.conclusion === 'success') return tile('ci_main', 'ok', null, `Passed on ${sha}`, { sha })
  return tile('ci_main', 'down', null, `CI ${f.run.conclusion ?? 'failed'} on ${sha}`, { sha, conclusion: f.run.conclusion })
}

export interface Deploy { sha: string; created_at: string; state: string | null }
export function prodDeploy(f: { token: boolean; deploy: Deploy | null; error?: string | null }): TileResult {
  if (!f.token) return tile('prod_deploy', 'unknown', null, 'GitHub token not set')
  if (f.error) return tile('prod_deploy', 'unknown', null, `Deployments could not be read (${f.error})`)
  if (!f.deploy) return tile('prod_deploy', 'unknown', null, 'No production deployment found')
  const { sha, created_at, state } = f.deploy
  const detail = { sha: sha.slice(0, 7), at: created_at, state }
  if (state === 'success') return tile('prod_deploy', 'ok', null, `${sha.slice(0, 7)} is live (${created_at.slice(0, 16).replace('T', ' ')} UTC)`, detail)
  if (state === 'failure' || state === 'error') return tile('prod_deploy', 'down', null, `Deploy of ${sha.slice(0, 7)} ${state}`, detail)
  return tile('prod_deploy', 'warn', null, `Deploy of ${sha.slice(0, 7)} is ${state ?? 'pending'}`, detail)
}

export interface Pr { number: number; red: boolean }
export function openPrsRed(f: { token: boolean; prs: Pr[] | null; error?: string | null }): TileResult {
  if (!f.token) return tile('open_prs_red', 'unknown', null, 'GitHub token not set')
  if (f.error || !f.prs) return tile('open_prs_red', 'unknown', null, `Pull requests could not be read (${f.error ?? 'none'})`)
  const red = f.prs.filter((p) => p.red).map((p) => p.number)
  if (!red.length) return tile('open_prs_red', 'ok', 0, `${f.prs.length} open, none red`)
  return tile('open_prs_red', 'warn', red.length, `Red checks on ${red.map((n) => `#${n}`).join(', ')}`, { prs: red })
}

// ─── migrations: repo files against the ledger, both ways (Hub band: hub_NNN and bare 2NN) ─────
/** Hub-band files with no ledger row, known since before Hub Health (applied outside apply_migration). */
export const KNOWN_UNLEDGERED = ['205_acct_audit_log', '206_repair_accounting_crm_links', '209_call_logs_conversation_link_and_last_activity']
export const HUB_BAND = /^(hub_\d{3}|2\d{2})_/
export function migrationParity(f: { repo: string[]; ledger: string[] | null; error?: string | null }): TileResult {
  if (!f.ledger) return tile('migration_parity', 'unknown', null, `The ledger could not be read (${f.error ?? 'no reader'})`)
  const repo = new Set(f.repo.filter((n) => HUB_BAND.test(n)))
  const ledger = new Set(f.ledger.filter((n) => HUB_BAND.test(n)))
  const notInRepo = Array.from(ledger).filter((n) => !repo.has(n)).sort()
  const notApplied = Array.from(repo).filter((n) => !ledger.has(n) && !KNOWN_UNLEDGERED.includes(n)).sort()
  const detail = { not_in_repo: notInRepo, not_applied: notApplied }
  if (notInRepo.length) return tile('migration_parity', 'down', notInRepo.length, `Applied but not on main: ${notInRepo.join(', ')}`, detail)
  if (notApplied.length) return tile('migration_parity', 'warn', notApplied.length, `On main but not applied: ${notApplied.join(', ')}`, detail)
  return tile('migration_parity', 'ok', 0, `${repo.size} Hub migrations, all applied`, detail)
}

// ─── guards (recorded when the deployed build was made) ────────────────────────
export interface GuardResult { id: string; ok: boolean; new: number; known: number }
/** The known prefix collision: pf_211 to pf_213 share numbers with hub_211 to hub_213. */
export const KNOWN_PREFIX_COLLISION = ['211', '212', '213']
export function guards(f: { guards: GuardResult[]; prefixOverlap: string[] }): TileResult {
  if (!f.guards.length) return tile('guards', 'unknown', null, 'No guard results were recorded at build time')
  const failing = f.guards.filter((g) => !g.ok || g.new > 0).map((g) => g.id)
  if (failing.length) return tile('guards', 'down', failing.length, `New findings in ${failing.join(', ')}`, { failing })
  const overlap = f.prefixOverlap.filter((n) => KNOWN_PREFIX_COLLISION.includes(n))
  if (overlap.length) return tile('guards', 'warn', overlap.length, `G5: known prefix collision pf_${overlap[0]} to pf_${overlap[overlap.length - 1]} with hub_ of the same numbers`, { overlap })
  return tile('guards', 'ok', 0, `${f.guards.length} guards pass`)
}

// ─── xRegulation sync (np_hrv_sync_state, read only) ─────────────────────────
export interface SyncState { is_active: boolean; last_sync_at: string | null; sync_interval_minutes: number | null; last_error_at: string | null }
export function xregSyncAge(f: { rows: SyncState[]; now: number }): TileResult {
  const active = f.rows.filter((r) => r.is_active)
  if (!active.length) return tile('xreg_sync_age', 'unknown', null, 'No active xRegulation sync')
  const newest = active.map((r) => Date.parse(r.last_sync_at ?? '') || 0).reduce((a, b) => Math.max(a, b), 0)
  if (!newest) return tile('xreg_sync_age', 'down', null, 'xRegulation has never synced')
  const mins = (f.now - newest) / MIN
  const interval = Math.max(5, ...active.map((r) => r.sync_interval_minutes ?? 30))
  const erroredSince = active.some((r) => (Date.parse(r.last_error_at ?? '') || 0) > newest)
  const detail = { minutes: Math.round(mins), interval }
  if (mins > 6 * 60) return tile('xreg_sync_age', 'down', Math.round(mins), `Last sync ${ago(mins)} ago`, detail)
  if (mins > 2 * interval || erroredSince) return tile('xreg_sync_age', 'warn', Math.round(mins), `Last sync ${ago(mins)} ago${erroredSince ? ', with an error since' : ''}`, detail)
  return tile('xreg_sync_age', 'ok', Math.round(mins), `Last sync ${ago(mins)} ago`, detail)
}

// ─── failures in the last 24 hours: 0 ok, 1 to 4 amber, 5 or more red ─────────
export const FAILURE_WARN = 1
export const FAILURE_DOWN = 5
export type FailureKind = 'crm_sync_failures' | 'sms_failures' | 'email_failures' | 'slack_failures'
export function failures(kind: FailureKind, parts: Record<string, number | null>): TileResult {
  const read = Object.entries(parts).filter(([, n]) => n !== null) as [string, number][]
  if (!read.length) return tile(kind, 'unknown', null, 'No source could be read')
  const n = read.reduce((s, [, v]) => s + v, 0)
  const by = read.filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(', ')
  const status: Status = n >= FAILURE_DOWN ? 'down' : n >= FAILURE_WARN ? 'warn' : 'ok'
  return tile(kind, status, n, n ? `${n} in 24h: ${by}` : 'None in 24h', { parts })
}

// ─── mailboxes ─────────────────────────────────────────────────────────────────
export function mailboxErrors(f: { boxes: { status: string | null; last_error: string | null }[] }): TileResult {
  if (!f.boxes.length) return tile('mailbox_errors', 'ok', 0, 'No mailboxes connected')
  const bad = f.boxes.filter((b) => b.status !== 'active' || !!b.last_error).length
  if (!bad) return tile('mailbox_errors', 'ok', 0, `${f.boxes.length} connected, none in error`)
  const status: Status = bad === f.boxes.length ? 'down' : 'warn'
  return tile('mailbox_errors', status, bad, `${bad} of ${f.boxes.length} mailboxes in error or disconnected`)
}

// ─── the platform's newest snapshot: red over 90 minutes ─────────────────────
export const PLATFORM_WARN_MIN = 45
export const PLATFORM_DOWN_MIN = 90
export function platformSnapshotAge(f: { latest: string | null; now: number }): TileResult {
  if (!f.latest) return tile('platform_snapshot_age', 'unknown', null, 'The platform has not written a snapshot yet')
  const mins = (f.now - Date.parse(f.latest)) / MIN
  const status: Status = mins > PLATFORM_DOWN_MIN ? 'down' : mins > PLATFORM_WARN_MIN ? 'warn' : 'ok'
  return tile('platform_snapshot_age', status, Math.round(mins), `Newest platform snapshot ${ago(mins)} ago`)
}

// ─── alert on change ─────────────────────────────────────────────────────────
export interface SnapshotRow { source: string; kind: string; status: string; captured_at: string }

/** The tile's previous snapshot, from the HUB's own rows only. */
export function previousHub(rows: SnapshotRow[], kind: string): Status | null {
  const mine = rows.filter((r) => r.source === 'hub' && r.kind === kind)
    .sort((a, b) => (Date.parse(b.captured_at) || 0) - (Date.parse(a.captured_at) || 0))
  const s = mine[0]?.status
  return s === 'ok' || s === 'warn' || s === 'down' || s === 'unknown' ? s : null
}

export interface AlertAction { resolve: boolean; open: 'warn' | 'down' | null; text: boolean }
export const NO_ACTION: AlertAction = { resolve: false, open: null, text: false }

/**
 * Compare a tile with its previous hub snapshot. 'unknown' is no colour: it never opens or resolves anything, and a
 * previous unknown (or none) counts as green. Same colour: nothing. A change: resolve the open alert (if the old colour
 * was amber or red) and open one for the new colour (if amber or red). Only a change INTO red is texted.
 */
export function alertAction(prev: Status | null, cur: Status): AlertAction {
  if (cur === 'unknown') return NO_ACTION
  const was = prev === null || prev === 'unknown' ? 'ok' : prev
  if (was === cur) return NO_ACTION
  return { resolve: was !== 'ok', open: cur === 'ok' ? null : cur, text: cur === 'down' }
}

/** Needs attention first (red, then amber), then unknown, then green; then by label. */
export function attentionOrder<T extends { status: string; kind: string }>(tiles: T[]): T[] {
  const rank: Record<string, number> = { down: 0, warn: 1, unknown: 2, ok: 3 }
  return tiles.slice().sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2)
    || String(TILE_LABEL[a.kind as TileKind] ?? a.kind).localeCompare(String(TILE_LABEL[b.kind as TileKind] ?? b.kind)))
}

export function smsBody(kind: TileKind, reason: string, hubUrl: string): string {
  return `Hub Health: ${TILE_LABEL[kind]} is red. ${reason.slice(0, 120)} ${hubUrl}/health`
}
