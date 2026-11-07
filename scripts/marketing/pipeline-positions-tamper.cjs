#!/usr/bin/env node
// scripts/marketing/pipeline-positions-tamper.cjs
//
// The multi-pipeline rules (hub_229). contact_pipeline_positions is the only source of membership and stage,
// and a change aimed at one pipeline never touches another. Checks, against the real source:
//   P_EXACT    a stage is found by exact name or id in the named pipeline only; nothing is guessed
//   P_ENRICH   positions in an archived pipeline or stage are dropped, and each row names its pipeline
//   P_PLACE    a route placement with an unknown pipeline or stage places nothing; a known one places by stage uuid
//   P_API      the API takes the org from the contact, refuses another org, and the actor is the caller
//   P_ONE      a removal names exactly one pipeline, and touches no other pipeline's row
//
//   loosename  stage names match case-insensitively       {P_EXACT}
//   guess      an unknown stage falls back to the first   {P_PLACE}
//   keeparch   rows in a missing stage are kept            {P_ENRICH}
//   orgopen    the contact's org is not checked            {P_API}
//   actorbody  the actor comes from the request body       {P_API}
//   removeall  a removal drops every pipeline              {P_ONE}
// TAMPER=1 reddens the union.
const fs = require('fs')
const H = require('../agent/lib/harness.cjs')

const P = 'lib/pipelines/positions.ts', R = 'app/api/crm/pipeline-positions/route.ts'
const TAMPERS = {
  loosename: [[P, 'p.stages.find((s) => s.name === stage)', 'p.stages.find((s) => s.name.toLowerCase() === String(stage).toLowerCase())']],
  guess: [[P, "  if (!stage) return { placed: false, reason: 'stage_unknown' }\n", '  if (!stage) return placeContact(db, contactId, findPipeline(list, pipeline)!.stages[0].id, onlyForward, source)\n']],
  keeparch: [[P, '    if (!p || !s) continue\n', "    if (!p || !s) { if (p) out.push({ ...r, pipeline_key: p.key, pipeline_name: p.name, stage_name: '' } as any); continue }\n"]],
  orgopen: [[R, '  return requireOrg(ctx, (data as any).org_id)', '  return (data as any).org_id']],
  actorbody: [[R, 'await setStage(ctx.db, contactId, stageId, ctx.userId,', 'await setStage(ctx.db, contactId, stageId, body?.actor ?? null,']],
  removeall: [[P, '{ p_contact: contactId, p_pipeline: pipelineId, p_actor: actor, p_source: source }', '{ p_contact: contactId, p_pipeline: null, p_actor: actor, p_source: source }']],
}
const RED_OF = { loosename: ['P_EXACT'], guess: ['P_PLACE'], keeparch: ['P_ENRICH'], orgopen: ['P_API'], actorbody: ['P_API'], removeall: ['P_ONE'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-positions')
const load = H.install(out)
const { enrichPositions, resolveStage, findPipeline, placeByName } = load(P)
const route = load(R)

const stage = (id, name, position, won = false) => ({ id, key: id, name, position, color: null, is_closed_won: won, is_closed_lost: false })
const PIPES = [
  { id: 'pA', key: 'default', name: 'Sales', position: 0, stages: [stage('sA1', 'New Lead', 0), stage('sA2', 'Won', 1, true)] },
  { id: 'pB', key: 'pipeline-2', name: 'Enrolled', position: 1, stages: [stage('sB1', 'New Lead', 0)] },
]
const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

;(async () => {
  check('P_EXACT', resolveStage(PIPES, 'default', 'New Lead')?.id === 'sA1' && resolveStage(PIPES, 'pB', 'New Lead')?.id === 'sB1'
    && resolveStage(PIPES, 'default', 'new lead') === null && resolveStage(PIPES, 'default', 'sA2')?.id === 'sA2'
    && resolveStage(PIPES, 'nope', 'New Lead') === null && resolveStage(PIPES, 'default', 'sB1') === null
    && findPipeline(PIPES, 'pipeline-2')?.id === 'pB' && findPipeline(PIPES, null) === null, 'stage lookups')

  const enriched = enrichPositions([
    { contact_id: 'c1', pipeline_id: 'pB', stage_id: 'sB1', moved_at: 't', source: 'x' },
    { contact_id: 'c1', pipeline_id: 'pA', stage_id: 'sA2', moved_at: 't', source: 'x' },
    { contact_id: 'c1', pipeline_id: 'pA', stage_id: 'gone', moved_at: 't', source: 'x' },
    { contact_id: 'c2', pipeline_id: 'archived', stage_id: 'sZ', moved_at: 't', source: 'x' },
  ], PIPES)
  check('P_ENRICH', enriched.length === 2 && enriched[0].pipeline_id === 'pA' && enriched[0].pipeline_key === 'default' && enriched[0].stage_name === 'Won'
    && enriched[0].is_closed_won === true && enriched[1].pipeline_name === 'Enrolled', enriched.map((e) => `${e.pipeline_id}:${e.stage_id}`))

  const rpcDb = () => H.stubDb({}, { rpc: (name, args) => ({ data: { placed: true, stage_id: args.p_stage }, error: null }) })
  const d1 = rpcDb(), d2 = rpcDb(), d3 = rpcDb()
  const unknownPipe = await placeByName(d1, 'o1', 'c1', 'missing', 'New Lead', true, 'booking', PIPES)
  const unknownStage = await placeByName(d2, 'o1', 'c1', 'default', 'Qualified', true, 'booking', PIPES)
  const known = await placeByName(d3, 'o1', 'c1', 'pipeline-2', 'New Lead', false, 'booking', PIPES)
  const placed = d3.calls.find((c) => c.rpc === 'hub_pipeline_place')
  check('P_PLACE', unknownPipe.placed === false && unknownPipe.reason === 'pipeline_unknown' && d1.calls.length === 0
    && unknownStage.placed === false && unknownStage.reason === 'stage_unknown' && d2.calls.length === 0
    && known.placed === true && placed && placed.args.p_stage === 'sB1' && placed.args.p_only_forward === false,
    { unknownPipe, unknownStage, placed: placed && placed.args })

  const C1 = '11111111-1111-1111-1111-111111111111', C2 = '22222222-2222-2222-2222-222222222222'
  const STAGE = '33333333-3333-3333-3333-333333333333', PIPE = '44444444-4444-4444-4444-444444444444'
  const ctxFor = (db) => ({ userId: 'u1', orgIds: ['o1'], orgRoles: { o1: 'admin' }, isSuperadmin: false, db })
  const apiDb = () => H.stubDb({ contacts: [{ id: C1, org_id: 'o1' }, { id: C2, org_id: 'o2' }], pipelines: [], pipeline_stages: [], contact_pipeline_positions: [] },
    { rpc: () => ({ data: true, error: null }) })
  const req = (body) => ({ json: async () => body, nextUrl: { searchParams: new URLSearchParams() } })
  const own = apiDb(); global.__ctx = ctxFor(own)
  const ok = await route.POST(req({ contact_id: C1, stage_id: STAGE, actor: 'forged' }), {})
  const setCall = own.calls.find((c) => c.rpc === 'hub_pipeline_set_stage')
  const other = apiDb(); global.__ctx = ctxFor(other)
  const refused = await route.POST(req({ contact_id: C2, stage_id: STAGE }), {})
  const otherDel = apiDb(); global.__ctx = ctxFor(otherDel)
  const refusedDel = await route.DELETE(req({ contact_id: C2, pipeline_id: PIPE }), {})
  check('P_API', ok.status === 200 && setCall && setCall.args.p_actor === 'u1' && setCall.args.p_stage === STAGE
    && refused.status === 403 && !other.calls.some((c) => c.rpc) && refusedDel.status === 403 && !otherDel.calls.some((c) => c.rpc),
    { ok: ok.status, actor: setCall && setCall.args.p_actor, refused: refused.status, refusedDel: refusedDel.status })

  const del = apiDb(); global.__ctx = ctxFor(del)
  await route.DELETE(req({ contact_id: C1, pipeline_id: PIPE }), {})
  const rm = del.calls.filter((c) => c.rpc === 'hub_pipeline_remove')
  check('P_ONE', rm.length === 1 && rm[0].args.p_pipeline === PIPE && rm[0].args.p_actor === 'u1'
    && !del.calls.some((c) => c.ops && c.ops.some((o) => ['update', 'delete', 'insert', 'upsert'].includes(o[0]))), rm.map((c) => c.args))

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})().catch((e) => { console.error(e); process.exit(2) })
