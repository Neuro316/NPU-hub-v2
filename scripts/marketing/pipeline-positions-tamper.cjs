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
//   P_PAY      a failed placement on a payment path is logged, returned as a warning, noted on the contact card, and
//              never thrown (accounting payments and enrolment, Stripe auto-tagger)
//   P_MIRROR   hub_229 mirrors to the legacy columns only for the pipeline contacts.pipeline_id names (or an empty
//              one), and the mirror and the translation trigger each skip the other's write
//   P_SIGNED   NeuroReport's 'Signed up' is the Enrolled pipeline's first stage, by key, in the sync and the trigger
//
//   loosename  stage names match case-insensitively       {P_EXACT}
//   guess      an unknown stage falls back to the first   {P_PLACE}
//   keeparch   rows in a missing stage are kept            {P_ENRICH}
//   orgopen    the contact's org is not checked            {P_API}
//   actorbody  the actor comes from the request body       {P_API}
//   removeall  a removal drops every pipeline              {P_ONE}
//   nowarn     the payment warning is dropped              {P_PAY}
//   payfail    a placement error is rethrown               {P_PAY}
//   mirrorloop translation ignores the mirror's guard      {P_MIRROR}
//   mirrorall  the mirror writes for any pipeline          {P_MIRROR}
//   nosignedup the sync places at the name 'Signed up'     {P_SIGNED}
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
// Source-level checks on files the harness does not compile (an API route outside its folders, and the SQL).
const PAY = 'src/app/api/accounting/payments/route.ts', SQL = 'supabase/migrations/hub_229_pipeline_positions.sql'
const SYNC = 'src/app/api/integrations/neuroreport/sync/route.ts'
const STATIC = {
  nowarn: [[PAY, "            warnings.push(`Payment saved, but the CRM stage move failed: ${reason}`)\n", '']],
  payfail: [[PAY, "            reason = String(e?.message || 'unknown').slice(0, 60)\n", '            throw e\n']],
  mirrorloop: [[SQL, "  if coalesce(current_setting('app.hub_legacy_mirroring', true), '') = 'on' then return null; end if;\n", '']],
  mirrorall: [[SQL, "         and (nullif(c.pipeline_id, '') is null or c.pipeline_id = v_key)\n", '']],
  nosignedup: [[SYNC, "?.stages.find(s => s.key === NEW_CONTACT_STAGE_KEY)", "?.stages.find(s => s.name === 'Signed up')"]],
}
const RED_OF = { loosename: ['P_EXACT'], guess: ['P_PLACE'], keeparch: ['P_ENRICH'], orgopen: ['P_API'], actorbody: ['P_API'], removeall: ['P_ONE'],
  nowarn: ['P_PAY'], payfail: ['P_PAY'], mirrorloop: ['P_MIRROR'], mirrorall: ['P_MIRROR'], nosignedup: ['P_SIGNED'] }
const active = H.selectors({ ...TAMPERS, ...STATIC })
const read = (rel) => {
  let src = fs.readFileSync(require('path').join(H.ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
  for (const t of active) for (const [file, from, to] of STATIC[t] ?? []) {
    if (file !== rel) continue
    if (!src.includes(from)) { console.error(`dead anchor: ${t} in ${file}`); process.exit(2) }
    src = src.split(from).join(to)
  }
  return src
}
const fnBody = (sql, name) => { const i = sql.indexOf(`create function public.${name}(`); return i < 0 ? '' : sql.slice(i, sql.indexOf('$function$;', i)) }
const out = H.compile(TAMPERS, active.filter((t) => TAMPERS[t]), 'hub-positions')
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

  // P_PAY: every payment-path placement failure is logged, surfaced, noted, and swallowed
  const pay = read(PAY)
  const payBlock = pay.slice(pay.indexOf('let reason: string | null = null'), pay.indexOf('await notePlacementFailure(admin, auth.targetOrgId'))
  const enrol = read('src/lib/accounting-auth.ts'), tagger = read('src/lib/stripe-auto-tagger.ts')
  const taggerBlock = tagger.slice(tagger.indexOf('const failures: string[] = []'), tagger.indexOf("notePlacementFailure(supabase, orgId, contact.id, 'Stripe enrolment'"))
  check('P_PAY', payBlock.length > 0 && payBlock.includes('warnings.push(') && payBlock.includes('console.error(') && !/\bthrow\b/.test(payBlock)
    && enrol.includes("notePlacementFailure(admin as any, targetOrgId, contact.id, 'accounting enrolment', reason)") && enrol.includes('warning: `Contact')
    && taggerBlock.length > 0 && !/\bthrow\b/.test(taggerBlock) && taggerBlock.includes('failures.push('), { pay: payBlock.length, tagger: taggerBlock.length })

  // P_MIRROR: the mirror is scoped to the legacy-named pipeline and the two triggers cannot feed each other
  const sql = read(SQL)
  const mirror = fnBody(sql, 'hub_pipeline_legacy_mirror'), translate = fnBody(sql, 'hub_contacts_legacy_pipeline_write'), changed = fnBody(sql, 'hub_positions_changed')
  check('P_MIRROR', mirror.includes("if coalesce(current_setting('app.hub_legacy_translating', true), '') = 'on' then return; end if;")
    && mirror.includes("set_config('app.hub_legacy_mirroring', 'on', true)") && mirror.includes("and (nullif(c.pipeline_id, '') is null or c.pipeline_id = v_key)")
    && mirror.includes('where c.id = p_contact and c.merged_into_id is null and c.pipeline_id = v_key;')
    && translate.includes("if coalesce(current_setting('app.hub_legacy_mirroring', true), '') = 'on' then return null; end if;")
    && translate.includes("set_config('app.hub_legacy_translating', 'on', true)")
    && changed.includes('perform public.hub_pipeline_legacy_mirror(new.contact_id, new.pipeline_id, new.stage_id);')
    && changed.includes('perform public.hub_pipeline_legacy_mirror(old.contact_id, old.pipeline_id, null);'), { mirror: mirror.length, translate: translate.length })

  // P_SIGNED: one named mapping, by the stage's key, in both places
  const sync = read(SYNC)
  check('P_SIGNED', sync.includes("const NEW_CONTACT_STAGE_KEY = 'stage-1772022700334'") && sync.includes('?.stages.find(s => s.key === NEW_CONTACT_STAGE_KEY)')
    && !/['"]Signed up['"]/.test(sync.replace(/\/\/.*$/gm, ''))
    && translate.includes("new.pipeline_id = 'pipeline-1771530511407' and new.pipeline_stage = 'Signed up'") && translate.includes("s.legacy_key = 'stage-1772022700334'"), 'signed up')

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})().catch((e) => { console.error(e); process.exit(2) })
