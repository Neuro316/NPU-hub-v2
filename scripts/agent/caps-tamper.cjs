#!/usr/bin/env node
// scripts/agent/caps-tamper.cjs   (test e)
//
// The step limit, the monthly cap (a reservation the database refuses), the per-session
// message limit, the per-user rate limit, an unpriced model and an unreachable model, each
// through the REAL code with a stub model and a stub database.
//
//   nostep     the per-run tool call limit is ignored             {E_STEP_LIMIT}
//   nocap      a refused reservation does not stop the run         {E_MONTHLY_CAP}
//   session    a full session still accepts messages               {E_SESSION_LIMIT}
//   rate       the rate limit lets an eleventh run through         {E_RATE_LIMIT}
//   cheap      a timed-out call is settled as costing nothing      {E_UNAVAILABLE}
//   rawmicros  the reservation is not whole micro-dollars           {E_MICROS,E_UNAVAILABLE}
//              (an unrounded reservation also breaks E_UNAVAILABLE's release equals reserve; it
//              shares that case with cheap, and both push it red, so they cannot cancel)
// TAMPER=1 reddens the union (6).
const H = require('./lib/harness.cjs')

const TAMPERS = {
  nostep: [
    ['lib/agent/loop.ts', 'if (toolCalls >= i.policy.run_tool_calls) {', 'if (false) {'],
    ['lib/agent/loop.ts', "if (toolCalls >= i.policy.run_tool_calls && !state.finished) { log.push({ stopped: 'step_limit' }); break }", ''],
  ],
  nocap: [['lib/agent/loop.ts', "if (!(r as any)?.ok) { outcome = 'cap_hit'; break }", '']],
  session: [['lib/agent/session.ts', 'if (n >= i.policy.session_messages)', 'if (false)']],
  rate: [['lib/agent/session.ts', 'return (count ?? 0) >= RATE_LIMIT.runs', 'return (count ?? 0) > RATE_LIMIT.runs']],
  rawmicros: [['lib/agent/pricing.ts', "return toMicros((inputChars * CEILING.cacheWrite + maxOutput * CEILING.output) / 1_000_000, 'up')", 'return (inputChars * CEILING.cacheWrite + maxOutput * CEILING.output) / 1_000_000']],
  cheap: [['lib/agent/loop.ts', 'const spent = e instanceof ModelUnavailable ? reserve : 0', 'const spent = 0']],
}
const RED_OF = { nostep: ['E_STEP_LIMIT'], nocap: ['E_MONTHLY_CAP'], session: ['E_SESSION_LIMIT'], rate: ['E_RATE_LIMIT'], cheap: ['E_UNAVAILABLE'], rawmicros: ['E_MICROS', 'E_UNAVAILABLE'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-caps')
const load = H.install(out)
const { runBuilder } = load('lib/agent/loop.ts')
const { useSession, rateLimited } = load('lib/agent/session.ts')
const { DEFAULT_POLICY } = load('lib/agent/config.ts')
const { ModelUnavailable } = load('lib/agent/model.ts')
const { costOf } = load('lib/agent/pricing.ts')

const SETUP = { pipelines: [], stages: [], sources: [], status: {}, assets: [], forms: [], sender_ready: true, page_slugs: [] }
let n = 0
const setCampaign = () => ({ model: 'claude-sonnet-5-5', stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 500 },
  content: [{ type: 'tool_use', id: `tu_${++n}`, name: 'set_campaign', input: { name: `C${n}` } }] })

async function run({ reserveOk = true, client, policy = { ...DEFAULT_POLICY } }) {
  const db = H.stubDb({}, { rpc: (name) => (name === 'agent_reserve' ? { data: { ok: reserveOk, month: '2026-10' }, error: null } : { data: null, error: null }) })
  let calls = 0
  const c = client || { create: async () => { calls++; return setCampaign() } }
  const r = await runBuilder({ db, client: c, org: 'O1', userId: 'U1', sessionId: 'S', policy, setup: SETUP, prompt: 'x' })
  return { r, db, calls: () => calls }
}

;(async () => {
  const rows = []
  const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

  // a model that never calls finish: the run stops at the tool call limit
  const step = await run({ policy: { ...DEFAULT_POLICY, run_tool_calls: 3 } })
  const executed = step.db.calls.filter((c) => c.table === 'agent_runs' && c.ops.some((o) => o[0] === 'update'))
    .map((c) => c.ops.find((o) => o[0] === 'update')[1][0].tool_calls).pop() || []
  check('E_STEP_LIMIT', executed.filter((x) => x.tool).length === 3 && executed.some((x) => x.stopped === 'step_limit'), executed)

  // the database refuses the reservation: the model is never called
  const cap = await run({ reserveOk: false })
  check('E_MONTHLY_CAP', cap.r.outcome === 'cap_hit' && cap.calls() === 0 && /spending limit/.test(cap.r.message), { outcome: cap.r.outcome, calls: cap.calls() })

  // every model call is reserved before and settled after, at the real cost
  const reserves = step.db.calls.filter((c) => c.rpc === 'agent_reserve'), settles = step.db.calls.filter((c) => c.rpc === 'agent_settle')
  const unit = costOf('claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 500 })
  check('E_RESERVE_EACH_CALL', reserves.length === settles.length && reserves.length >= 3
    && settles.every((c) => Math.abs(c.args.p_actual - unit) < 1e-9 && c.args.p_reserved >= unit), { reserves: reserves.length, settles: settles.length })

  // an unreachable model: nothing planned, and the reservation is kept as spent
  const down = await run({ client: { create: async () => { throw new ModelUnavailable('status_529') } } })
  const settle = down.db.calls.find((c) => c.rpc === 'agent_settle')
  check('E_UNAVAILABLE', down.r.outcome === 'model_unavailable' && settle && settle.args.p_actual === settle.args.p_reserved && settle.args.p_actual > 0
    && /could not reach/.test(down.r.message), { outcome: down.r.outcome, settle: settle && settle.args })

  // an unpriced model refuses before anything is written or called
  process.env.AGENT_MODEL = 'claude-unpriced-9'
  const unpriced = await run({})
  delete process.env.AGENT_MODEL
  check('E_UNPRICED', unpriced.r.outcome === 'failed' && unpriced.calls() === 0 && !unpriced.db.calls.some((c) => c.table === 'agent_runs'), unpriced.r)

  // the session message cap
  const full = H.stubDb({ agent_sessions: [{ id: 'S1', org_id: 'O1', user_id: 'U1', mode: 'builder', message_count: DEFAULT_POLICY.session_messages }] })
  const s1 = await useSession(full, { org: 'O1', userId: 'U1', mode: 'builder', surface: 'panel', sessionId: 'S1', policy: { ...DEFAULT_POLICY } })
  const room = H.stubDb({ agent_sessions: [{ id: 'S2', org_id: 'O1', user_id: 'U1', mode: 'builder', message_count: 3 }] })
  const s2 = await useSession(room, { org: 'O1', userId: 'U1', mode: 'builder', surface: 'panel', sessionId: 'S2', policy: { ...DEFAULT_POLICY } })
  check('E_SESSION_LIMIT', !s1.ok && s1.status === 429 && s2.ok, { full: s1, room: s2 })

  // the rate limit: ten runs in the window allowed, the eleventh refused
  const counted = (c) => H.stubDb({}, { table: (t, ops) => (t === 'agent_runs' ? { data: null, count: c, error: null } : undefined) })
  check('E_RATE_LIMIT', (await rateLimited(counted(9), 'U1', 'builder')) === false && (await rateLimited(counted(10), 'U1', 'builder')) === true, null)

  // every amount sent to the database is whole micro-dollars, the precision agent_usage stores,
  // so a release always matches what was reserved and no residue is left counted
  const amounts = []
  for (const x of [down]) for (const c of x.db.calls) if (c.rpc === 'agent_reserve') amounts.push(c.args.p_amount); else if (c.rpc === 'agent_settle') amounts.push(c.args.p_reserved, c.args.p_actual)
  const whole = (v) => Math.abs(v * 1e6 - Math.round(v * 1e6)) < 1e-6
  check('E_MICROS', amounts.length >= 3 && amounts.every(whole), amounts)

  H.report(rows, active, RED_OF, () => require('fs').rmSync(out, { recursive: true, force: true }))
})().catch((e) => { console.error(e); process.exit(2) })
