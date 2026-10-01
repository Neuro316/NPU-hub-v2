#!/usr/bin/env node
// scripts/agent/live-smoke.cjs   (test a, live half: NOT in CI, NOT in verify)
//
// One tiny goal for the Campaign Builder and one question for the Hub Guide, against the REAL
// Anthropic API, through the real loops. The database is an in-memory stub, so nothing is
// written anywhere; the only effect is API spend, which it reports. Needs ANTHROPIC_API_KEY
// (read from the environment or .env.local). Run it by hand after changing a model, a prompt
// or the SDK:   node scripts/agent/live-smoke.cjs
const REQUIRES_LIVE = 'api'
const fs = require('fs'), path = require('path')
const H = require('./lib/harness.cjs')

if (!process.env.ANTHROPIC_API_KEY) {
  const env = path.join(H.ROOT, '.env.local')
  if (fs.existsSync(env)) for (const l of fs.readFileSync(env, 'utf8').split(/\r?\n/)) {
    const m = /^\s*ANTHROPIC_API_KEY\s*=\s*"?([^"\s]+)"?\s*$/.exec(l); if (m) process.env.ANTHROPIC_API_KEY = m[1]
  }
}
if (!process.env.ANTHROPIC_API_KEY) { console.error(`${REQUIRES_LIVE}: ANTHROPIC_API_KEY is not set; nothing was run`); process.exit(2) }

const out = H.compile({}, [], 'hub-live')
const load = H.install(out, { '@anthropic-ai/sdk': require('@anthropic-ai/sdk') })
const { liveClient } = load('lib/agent/model.ts')
const { runBuilder } = load('lib/agent/loop.ts')
const { runGuide } = load('lib/agent/guide.ts')
const { DEFAULT_POLICY, modelFor } = load('lib/agent/config.ts')

const db = () => H.stubDb({}, { rpc: (n) => (n === 'agent_reserve' ? { data: { ok: true, month: 'smoke' }, error: null } : { data: null, error: null }) })
const SETUP = {
  pipelines: [{ id: 'P1', name: 'Leads' }], stages: [{ id: 's1', pipeline_id: 'P1', name: 'New lead', position: 0 }, { id: 's2', pipeline_id: 'P1', name: 'Booked', position: 1 }],
  sources: [], status: { form: { connected: true, why: '' }, booking: { connected: false, why: 'not connected yet' } },
  assets: [{ id: 'A1', title: 'HRV starter guide', description: 'A short guide' }], forms: [], sender_ready: true, page_slugs: [],
}

;(async () => {
  let ok = true
  const t0 = Date.now()
  const b = await runBuilder({ db: db(), client: liveClient(), org: 'O1', userId: 'U1', sessionId: 'S', policy: { ...DEFAULT_POLICY }, setup: SETUP,
    prompt: 'Give away the HRV starter guide to people who join the Leads pipeline, then send one follow up email two days later.' })
  const steps = b.plan?.sequence?.steps ?? []
  console.log(`builder  model=${modelFor('builder')} outcome=${b.outcome} steps=${steps.length} tasks=${b.plan?.tasks?.length ?? 0} cost=$${(b.costUsd ?? 0).toFixed(4)} ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(`         ${String(b.message ?? '').slice(0, 200)}`)
  if (b.outcome !== 'planned' || steps.length < 1) ok = false

  const t1 = Date.now()
  const g = await runGuide({ db: db(), client: liveClient(), org: 'O1', userId: 'U1', sessionId: 'S', policy: { ...DEFAULT_POLICY },
    question: 'How do I test a campaign before it goes live?', route: '/campaigns', helpId: 'campaigns' })
  console.log(`guide    model=${modelFor('guide')} outcome=${g.outcome} cited=${(g.answer?.cited ?? []).join(',')} steps=${g.answer?.steps?.length ?? 0} cost=$${g.costUsd.toFixed(4)} ${((Date.now() - t1) / 1000).toFixed(1)}s`)
  console.log(`         ${String(g.message).slice(0, 200)}`)
  if (g.outcome !== 'answered') ok = false

  fs.rmSync(out, { recursive: true, force: true })
  console.log(ok ? 'LIVE SMOKE PASSED' : 'LIVE SMOKE FAILED')
  process.exit(ok ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(2) })
