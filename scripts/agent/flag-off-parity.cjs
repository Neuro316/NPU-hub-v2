#!/usr/bin/env node
// scripts/agent/flag-off-parity.cjs   (test i)
//
// With agent_enabled off, existing behaviour is unchanged:
//   U_*  the existing send, intake, campaign and enrollment paths are byte-identical to the
//        commit this build branched from (PARITY_BASE, read with git show). The four routes
//        whose checks moved into shared validators are proven separately, request by request,
//        by scripts/agent/validator-parity.cjs.
//   R_*  the agent route itself does nothing while its flag is off or for a non-superadmin:
//        a refusal, and no read or write of any agent table, no model call, no build.
//   C_*  the control: with the flag on and a superadmin, the same route DOES reach the model
//        and record a run, so the refusals above are the flag and the role, not a dead route.
//
//   noflag   the route stops checking agent_enabled          {R_BUILD_FLAG_OFF,R_FLAG_OFF}
//   nosuper  the route stops checking superadmin             {R_NOT_SUPERADMIN}
//   touch    one byte of the intake route changes            {U_intake-route}
// TAMPER=1 reddens the union (4, equal to the sum).
const { execFileSync } = require('child_process')
const fs = require('fs'), path = require('path')
const H = require('./lib/harness.cjs')

const BASE = process.env.PARITY_BASE || 'd49d00e'
const UNTOUCHED = {
  'intake-route': 'src/app/api/intake/route.ts', 'intake-lib': 'src/lib/marketing/intake.ts', engine: 'src/lib/marketing/engine.ts',
  'campaign-steps': 'src/app/api/cron/campaign-steps/route.ts', 'process-step': 'src/app/api/sequences/process-step/route.ts',
  'entry-events': 'src/lib/marketing/entry-events.ts', render: 'src/lib/marketing/render.ts', 'test-enroll': 'src/app/api/marketing/test-enroll/route.ts',
  'go-live': 'src/app/api/marketing/campaigns/live/route.ts', policy: 'src/lib/marketing/policy.ts', 'resend-webhook': 'src/app/api/webhooks/resend/route.ts',
  unsubscribe: 'src/app/api/email/unsubscribe/route.ts',
}
const TAMPERS = {
  noflag: [['app/api/marketing/agent/route.ts', "    if (!flags.agent_enabled) return forbidden('The Campaign Builder is switched off for this organization.')\n", '']],
  nosuper: [['app/api/marketing/agent/route.ts', "    if (!ctx.isSuperadmin) return forbidden('Only a platform superadmin can use the Campaign Builder.')\n", '']],
  touch: [],
}
const RED_OF = { noflag: ['R_BUILD_FLAG_OFF', 'R_FLAG_OFF'], nosuper: ['R_NOT_SUPERADMIN'], touch: ['U_intake-route'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active.filter((t) => t !== 'touch'), 'hub-flagoff')
const load = H.install(out)
const { POST } = load('app/api/marketing/agent/route.ts')

const norm = (s) => s.replace(/\r\n/g, '\n')
// The Lead Device Kit added the external intake to this route on purpose, so it is compared with that commit.
const INTAKE_BASE = process.env.INTAKE_BASE || 'f018c92'
// The multi-pipeline build (hub_229) moved these files' pipeline reads and writes to contact_pipeline_positions
// on purpose, so each is compared with that commit instead of its earlier pin.
const MULTI_PIPELINE_BASE = process.env.MULTI_PIPELINE_BASE || '10e9a8b'
const MULTI_PIPELINE_FILES = new Set(['src/lib/marketing/engine.ts', 'src/app/api/sequences/process-step/route.ts', 'src/lib/marketing/render.ts'])
const base = (f) => {
  const ref = MULTI_PIPELINE_FILES.has(f) ? MULTI_PIPELINE_BASE : f === 'src/app/api/intake/route.ts' ? INTAKE_BASE : BASE
  try { return norm(execFileSync('git', ['show', `${ref}:${f}`], { cwd: H.ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) }
  catch { console.error(`git show ${ref}:${f} failed (is the history fetched?)`); process.exit(2) }
}

async function call(body, { superadmin = true, flagOn = false } = {}) {
  const db = H.stubDb({
    org_settings: flagOn ? [{ org_id: 'O1', setting_key: 'hub_marketing_flags', setting_value: { agent_enabled: 'on' } }] : [],
  }, { rpc: (n) => (n === 'agent_reserve' ? { data: { ok: true, month: 'm' }, error: null } : n === 'entry_source_status' ? { data: {}, error: null } : { data: null, error: null }) })
  global.__ctx = { userId: 'U1', orgIds: ['O1'], orgRoles: { O1: 'super_admin' }, isSuperadmin: superadmin, db }
  const res = await POST({ json: async () => body }, { params: {} })
  return { res, db }
}
const agentTouched = (db) => db.calls.some((c) => (c.table && c.table.startsWith('agent_')) || (c.rpc && c.rpc.startsWith('agent_')))

;(async () => {
  const rows = []
  const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
  for (const [k, f] of Object.entries(UNTOUCHED)) {
    let now = norm(fs.readFileSync(path.join(H.ROOT, f), 'utf8'))
    if (active.includes('touch') && k === 'intake-route') now = now.replace('export', 'export ')
    check(`U_${k}`, now === base(f), now === base(f) ? 'identical' : 'differs from base')
  }

  const plan = { action: 'plan', org_id: 'O1', prompt: 'Give away the guide.' }
  const off = await call(plan, { flagOn: false })
  check('R_FLAG_OFF', off.res.status === 403 && /switched off/.test(off.res.body.error) && !agentTouched(off.db), { status: off.res.status, calls: off.db.calls.length })
  const offBuild = await call({ action: 'build', org_id: 'O1', run_id: 'R1' }, { flagOn: false })
  check('R_BUILD_FLAG_OFF', offBuild.res.status === 403 && !offBuild.db.calls.some((c) => c.rpc === 'agent_build'), offBuild.res)
  const notSuper = await call(plan, { superadmin: false, flagOn: true })
  check('R_NOT_SUPERADMIN', notSuper.res.status === 403 && /superadmin/.test(notSuper.res.body.error) && notSuper.db.calls.length === 0, notSuper.res)

  process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
  const on = await call(plan, { flagOn: true })
  delete process.env.ANTHROPIC_API_KEY
  check('C_ON_REACHES_MODEL', on.res.status === 503 && on.res.body.outcome === 'model_unavailable'
    && on.db.calls.some((c) => c.table === 'agent_runs' && c.ops.some((o) => o[0] === 'insert')), { status: on.res.status, body: on.res.body })

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})().catch((e) => { console.error(e); process.exit(2) })
