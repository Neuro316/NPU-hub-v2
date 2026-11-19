#!/usr/bin/env node
// scripts/health/hub-health-tamper.cjs   (Running List q23: Hub Health, the Hub half of Platform Health)
//
// Runs the REAL capture (src/lib/health/run.ts and rules.ts) against an in-memory database (filters, counts, order,
// inserts, updates, and the one-open-alert-per-(source, kind) rule of pf_313) and a stubbed GitHub. Every tile is
// checked in a GREEN world (ok) and in its own RED world (red, or amber where amber is the tile's worst colour).
//
// Tile checks, from intent:
//   T_CI        a failed CI run on main is red
//   T_DEPLOY    a failed production deployment is red
//   T_PRS       an open PR with a failed check is amber, naming it
//   T_PARITY    a ledger migration that is not in the repo is red (the both-ways comparison)
//   T_GUARDS    a guard with a new finding is red; the known pf_211 to pf_213 prefix collision alone is amber
//   T_XREG      an active xRegulation sync last run 7 hours ago is red
//   T_CRM       5 failed job runs in 24 hours is red
//   T_SMS       5 failed outbound texts in 24 hours is red
//   T_EMAIL     5 failed campaign emails in 24 hours is red
//   T_SLACK     5 failed Slack lead-alert posts in 24 hours is red
//   T_MAILBOX   every mailbox connection in error is red
//   T_PLATFORM  a newest platform snapshot 100 minutes old is red
// Alert checks:
//   A_SAME      the same colour twice opens nothing, resolves nothing and texts nothing the second time
//   A_CHANGE    amber to red opens one red alert and queues one text when notifications are live; in preview the
//               text is held (recorded on the alert) and nothing is queued
//   A_CLEAR     red to green resolves the open alert (resolved_at set, never deleted), opens nothing, texts nothing
//   A_PLATFORM  a newer platform snapshot of the same kind is never compared with the hub tile (green to red against
//               the hub's own green resolves nothing, where the platform's amber would)
//
//   ciok        any conclusion but cancelled counts as passing       {T_CI}
//   deploywarn  a failed deployment is only amber                    {T_DEPLOY}
//   prsgreen    no check conclusion counts as red                    {T_PRS}
//   oneway      ledger rows missing from the repo are ignored        {T_PARITY}
//   guardsok    new guard findings are ignored                       {T_GUARDS}
//   xregslow    the red line for xRegulation moves to 600 hours      {T_XREG}
//   crmok       the job count reads successful runs                  {T_CRM}
//   smsmiss     only undelivered texts are counted                   {T_SMS}
//   emailmiss   campaign emails count bounces instead of failures    {T_EMAIL}
//   slackmiss   Slack counts skipped posts instead of failed ones    {T_SLACK}
//   mailwarn    all mailboxes in error is only amber                 {T_MAILBOX}
//   platslow    the platform red line moves to 900 minutes           {T_PLATFORM}
//   realert     the same colour re-alerts                            {A_SAME}
//   changequiet a change into red is never texted                    {A_CHANGE}
//   noclear     a change to green never resolves                     {A_CLEAR}
//   platcompare the previous snapshot may be the platform's          {A_PLATFORM}
// TAMPER=1 reddens the sum (16).
const H = require('../agent/lib/harness.cjs')

const R = 'lib/health/rules.ts', RUN = 'lib/health/run.ts'
const TAMPERS = {
  ciok: [[R, "if (f.run.conclusion === 'success')", "if (f.run.conclusion !== 'cancelled')"]],
  deploywarn: [[R, "if (state === 'failure' || state === 'error') return tile('prod_deploy', 'down'", "if (state === 'failure' || state === 'error') return tile('prod_deploy', 'warn'"]],
  prsgreen: [[RUN, "const RED_CHECK = ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']", 'const RED_CHECK: string[] = []']],
  oneway: [[R, "if (notInRepo.length) return tile('migration_parity', 'down'", "if (false as boolean) return tile('migration_parity', 'down'"]],
  guardsok: [[R, 'const failing = f.guards.filter((g) => !g.ok || g.new > 0).map((g) => g.id)', 'const failing = f.guards.filter(() => false).map((g) => g.id)']],
  xregslow: [[R, "if (mins > 6 * 60) return tile('xreg_sync_age', 'down'", "if (mins > 600 * 60) return tile('xreg_sync_age', 'down'"]],
  crmok: [[RUN, ".select('id', head).eq('ok', false)", ".select('id', head).eq('ok', true)"]],
  smsmiss: [[RUN, ".in('status', ['failed', 'undelivered'])", ".in('status', ['undelivered'])"]],
  emailmiss: [[RUN, ".eq('channel', 'email').eq('status', 'failed')", ".eq('channel', 'email').eq('status', 'bounced')"]],
  slackmiss: [[RUN, ".eq('push_status', 'failed')", ".eq('push_status', 'skipped')"]],
  mailwarn: [[R, "const status: Status = bad === f.boxes.length ? 'down' : 'warn'", "const status: Status = 'warn'"]],
  platslow: [[R, 'export const PLATFORM_DOWN_MIN = 90', 'export const PLATFORM_DOWN_MIN = 900']],
  realert: [[R, '  if (was === cur) return NO_ACTION\n', '']],
  changequiet: [[R, "return { resolve: was !== 'ok', open: cur === 'ok' ? null : cur, text: cur === 'down' }", "return { resolve: was !== 'ok', open: cur === 'ok' ? null : cur, text: false }"]],
  noclear: [[R, "return { resolve: was !== 'ok', open:", "return { resolve: cur !== 'ok' && was !== 'ok', open:"]],
  platcompare: [[R, "rows.filter((r) => r.source === 'hub' && r.kind === kind)", 'rows.filter((r) => r.kind === kind)'],
    [RUN, ".select('source, kind, status, captured_at')\n    .eq('source', 'hub').in('kind'", ".select('source, kind, status, captured_at')\n    .in('kind'"]],
}
const RED_OF = {
  ciok: ['T_CI'], deploywarn: ['T_DEPLOY'], prsgreen: ['T_PRS'], oneway: ['T_PARITY'], guardsok: ['T_GUARDS'], xregslow: ['T_XREG'],
  crmok: ['T_CRM'], smsmiss: ['T_SMS'], emailmiss: ['T_EMAIL'], slackmiss: ['T_SLACK'], mailwarn: ['T_MAILBOX'], platslow: ['T_PLATFORM'],
  realert: ['A_SAME'], changequiet: ['A_CHANGE'], noclear: ['A_CLEAR'], platcompare: ['A_PLATFORM'],
}
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-health')
const load = H.install(out)
const run = load(RUN)

const NOW = Date.parse('2026-11-19T18:00:00Z')
const ago = (min) => new Date(NOW - min * 60_000).toISOString()
const REPO = ['202_crm_messages_recovered_at', 'hub_211_marketing_engine', 'hub_243_test_contact_cap_exempt', '205_acct_audit_log']
const LEDGER = ['202_crm_messages_recovered_at', 'hub_211_marketing_engine', 'hub_243_test_contact_cap_exempt']
const GUARDS_OK = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].map((id) => ({ id, ok: true, new: 0, known: 0 }))

// ── the world: tables, ledger, GitHub and repo facts; each RED world changes one thing ──
function green() {
  return {
    tables: {
      np_hrv_sync_state: [{ is_active: true, last_sync_at: ago(10), sync_interval_minutes: 30, last_error_at: null }],
      job_runs: [], crm_messages: [], hub_sms_outbox: [], message_sends: [], stage_email_sends: [], hub_lead_alerts: [],
      hub_mail_connections: [{ status: 'active', last_error: null }, { status: 'active', last_error: null }],
      platform_health_snapshots: [{ id: 'p0', source: 'platform', kind: 'k28_overall', status: 'ok', captured_at: ago(20) }],
      platform_alerts: [], hub_sms_outbox_inserts: [],
    },
    ledger: LEDGER.slice(),
    repo: { hubMigrations: REPO.slice(), guards: GUARDS_OK.map((g) => ({ ...g })), prefixOverlap: [] },
    gh: { ci: 'success', deploy: 'success', prChecks: { 7: ['success'] } },
  }
}
const n = (k, row) => Array.from({ length: k }, (_, i) => ({ id: `r${i}`, ...row }))
const RED = {
  T_CI: (w) => { w.gh.ci = 'failure' },
  T_DEPLOY: (w) => { w.gh.deploy = 'failure' },
  T_PRS: (w) => { w.gh.prChecks[8] = ['success', 'failure'] },
  T_PARITY: (w) => { w.ledger.push('hub_299_applied_from_a_branch') },
  T_GUARDS: (w) => { w.repo.guards[4] = { id: 'G5', ok: false, new: 1, known: 0 } },
  T_XREG: (w) => { w.tables.np_hrv_sync_state[0].last_sync_at = ago(7 * 60) },
  T_CRM: (w) => { w.tables.job_runs = n(5, { job: 'booking-sync', ok: false, started_at: ago(60) }) },
  T_SMS: (w) => { w.tables.crm_messages = n(5, { direction: 'outbound', status: 'failed', created_at: ago(60) }) },
  T_EMAIL: (w) => { w.tables.message_sends = n(5, { channel: 'email', status: 'failed', claimed_at: ago(60) }) },
  T_SLACK: (w) => { w.tables.hub_lead_alerts = n(5, { push_status: 'failed', created_at: ago(60) }) },
  T_MAILBOX: (w) => { w.tables.hub_mail_connections.forEach((b) => { b.last_error = 'invalid_grant' }) },
  T_PLATFORM: (w) => { w.tables.platform_health_snapshots[0].captured_at = ago(100) },
}
const KIND = { T_CI: 'ci_main', T_DEPLOY: 'prod_deploy', T_PRS: 'open_prs_red', T_PARITY: 'migration_parity', T_GUARDS: 'guards', T_XREG: 'xreg_sync_age',
  T_CRM: 'crm_sync_failures', T_SMS: 'sms_failures', T_EMAIL: 'email_failures', T_SLACK: 'slack_failures', T_MAILBOX: 'mailbox_errors', T_PLATFORM: 'platform_snapshot_age' }
const WORST = { T_PRS: 'warn' }

function memDb(w) {
  const T = w.tables
  const cmp = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return Number.isNaN(x) || Number.isNaN(y) ? String(a).localeCompare(String(b)) : x - y }
  let seq = 0
  return {
    rpc: async (name) => (name === 'hub_migration_ledger' ? { data: w.ledger.slice(), error: null } : { data: null, error: { code: 'PGRST202' } }),
    from(table) {
      const ops = []
      const b = {}
      for (const m of ['select', 'eq', 'neq', 'is', 'in', 'gte', 'order', 'limit', 'insert', 'update']) b[m] = (...a) => { ops.push([m, a]); return b }
      const filt = (rows) => {
        for (const [m, a] of ops) {
          if (m === 'eq') rows = rows.filter((r) => r[a[0]] === a[1])
          if (m === 'neq') rows = rows.filter((r) => r[a[0]] !== a[1])
          if (m === 'is') rows = rows.filter((r) => (r[a[0]] ?? null) === a[1])
          if (m === 'in') rows = rows.filter((r) => a[1].includes(r[a[0]]))
          if (m === 'gte') rows = rows.filter((r) => r[a[0]] != null && cmp(r[a[0]], a[1]) >= 0)
        }
        return rows
      }
      const exec = () => {
        T[table] = T[table] || []
        const ins = ops.find((o) => o[0] === 'insert'), upd = ops.find((o) => o[0] === 'update')
        if (ins) {
          const list = Array.isArray(ins[1][0]) ? ins[1][0] : [ins[1][0]]
          for (const r of list) {
            if (table === 'platform_alerts' && T.platform_alerts.some((x) => x.source === r.source && x.kind === r.kind && x.resolved_at == null)) return { data: null, error: { code: '23505' } }
          }
          for (const r of list) T[table].push({ id: `${table}-${++seq}`, resolved_at: null, ...r })
          return { data: list, error: null }
        }
        if (upd) {
          const rows = filt(T[table])
          for (const r of rows) Object.assign(r, upd[1][0])
          return { data: rows, error: null }
        }
        let rows = filt(T[table].slice())
        const ord = ops.find((o) => o[0] === 'order')
        if (ord) rows.sort((x, y) => (ord[1][1]?.ascending === false ? -1 : 1) * cmp(x[ord[1][0]], y[ord[1][0]]))
        const lim = ops.find((o) => o[0] === 'limit')
        if (lim) rows = rows.slice(0, lim[1][0])
        const sel = ops.find((o) => o[0] === 'select')
        if (sel && sel[1][1] && sel[1][1].head) return { data: null, count: rows.length, error: null }
        return { data: rows, error: null }
      }
      b.maybeSingle = () => ({ then: (res, rej) => Promise.resolve(exec()).then((r) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })).then(res, rej) })
      b.then = (res, rej) => Promise.resolve(exec()).then(res, rej)
      return b
    },
  }
}

function github(w) {
  return async (path) => {
    if (path.startsWith('/actions/runs')) return { status: 200, data: { workflow_runs: [{ conclusion: w.gh.ci, head_sha: 'abcdef1234567', updated_at: ago(30) }] } }
    if (path.startsWith('/deployments?')) return { status: 200, data: [{ id: 1, sha: 'abcdef1234567', created_at: ago(40) }] }
    if (path.startsWith('/deployments/1/statuses')) return { status: 200, data: [{ state: w.gh.deploy }] }
    if (path.startsWith('/pulls')) return { status: 200, data: Object.keys(w.gh.prChecks).map((k) => ({ number: Number(k), head: { sha: `sha${k}` } })) }
    const m = /^\/commits\/sha(\d+)\/check-runs/.exec(path)
    if (m) return { status: 200, data: { check_runs: (w.gh.prChecks[m[1]] ?? []).map((c) => ({ conclusion: c })) } }
    return { status: 404, data: null }
  }
}

// a later capture: the platform has written again in the meantime, so only the planted tile changes
const deps = (w, mode = 'live', now = NOW) => {
  if (now > NOW) w.tables.platform_health_snapshots.push({ id: `p-${now}`, source: 'platform', kind: 'k28_overall', status: 'ok', captured_at: new Date(now - 5 * 60_000).toISOString() })
  return depsAt(w, mode, now)
}
const depsAt = (w, mode, now) => ({ db: memDb(w), now, github: github(w), repo: w.repo, alertUserId: 'owner', mode: async () => mode, hubUrl: 'https://hub.example' })
const statusOf = (tiles, kind) => tiles.find((t) => t.kind === kind)?.status

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

;(async () => {
  // ── tiles ──
  const base = await run.collectTiles(deps(green()))
  for (const [id, plant] of Object.entries(RED)) {
    const w = green(); plant(w)
    const tiles = await run.collectTiles(deps(w))
    const want = WORST[id] ?? 'down'
    let ok = statusOf(base, KIND[id]) === 'ok' && statusOf(tiles, KIND[id]) === want
    if (id === 'T_PRS') ok = ok && /#8/.test(tiles.find((t) => t.kind === 'open_prs_red').reason)
    if (id === 'T_GUARDS') {
      const a = green(); a.repo.prefixOverlap = ['211', '212', '213', '214']
      ok = ok && statusOf(await run.collectTiles(deps(a)), 'guards') === 'warn'
    }
    check(id, ok, { green: statusOf(base, KIND[id]), red: statusOf(tiles, KIND[id]), want })
  }

  // ── alerts: the sms tile drives them, through 'undelivered' texts (2 = amber, 6 = red) ──
  const texts = (w, k) => { w.tables.crm_messages = n(k, { direction: 'outbound', status: 'undelivered', created_at: ago(30) }) }
  const outbox = (w) => w.tables.hub_sms_outbox.filter((r) => r.source === 'hub-health:sms_failures')
  {
    const w = green(); texts(w, 6)
    await run.runHubHealth({ ...deps(w), db: memDb(w) })
    const before = outbox(w).length
    const second = await run.runHubHealth({ ...deps(w, 'live', NOW + 30 * 60_000), db: memDb(w) })
    check('A_SAME', second.opened.length === 0 && second.resolved.length === 0 && outbox(w).length === before && w.tables.platform_alerts.length === 1, second)
  }
  {
    const w = green(); texts(w, 2)
    await run.runHubHealth({ ...deps(w), db: memDb(w) })
    texts(w, 6)
    const r2 = await run.runHubHealth({ ...deps(w, 'live', NOW + 30 * 60_000), db: memDb(w) })
    const p = green(); texts(p, 2)
    await run.runHubHealth({ ...deps(p, 'preview'), db: memDb(p) })
    texts(p, 6)
    const p2 = await run.runHubHealth({ ...deps(p, 'preview', NOW + 30 * 60_000), db: memDb(p) })
    const heldRow = p.tables.platform_alerts.find((a) => a.severity === 'down')
    check('A_CHANGE', JSON.stringify(r2.opened) === '["sms_failures"]' && r2.texts.sms_failures === 'queued' && outbox(w).length === 1
      && w.tables.platform_alerts.filter((a) => a.severity === 'down').length === 1
      && p2.texts.sms_failures === 'held_mode_preview' && outbox(p).length === 0 && heldRow?.detail?.text === 'held_mode_preview', { r2, p2 })
  }
  {
    const w = green(); texts(w, 6)
    await run.runHubHealth({ ...deps(w), db: memDb(w) })
    const sent = outbox(w).length
    texts(w, 0)
    const r2 = await run.runHubHealth({ ...deps(w, 'live', NOW + 30 * 60_000), db: memDb(w) })
    const a = w.tables.platform_alerts
    check('A_CLEAR', JSON.stringify(r2.resolved) === '["sms_failures"]' && r2.opened.length === 0 && a.length === 1 && a[0].resolved_at && outbox(w).length === sent, { r2, alerts: a })
  }
  {
    // the hub tile was green last time; the platform wrote amber for the same kind since. Going red now must open
    // a red alert against the HUB's green and resolve nothing (compared with the platform's amber it would resolve)
    const w = green(); texts(w, 6)
    w.tables.platform_health_snapshots.push({ id: 'h1', source: 'hub', kind: 'sms_failures', status: 'ok', captured_at: ago(30) })
    w.tables.platform_health_snapshots.push({ id: 'p1', source: 'platform', kind: 'sms_failures', status: 'warn', captured_at: ago(5) })
    const r = await run.runHubHealth({ ...deps(w), db: memDb(w) })
    check('A_PLATFORM', JSON.stringify(r.opened) === '["sms_failures"]' && r.resolved.length === 0, r)
  }

  H.report(rows, active, RED_OF)
})().catch((e) => { console.error(e); process.exit(2) })
