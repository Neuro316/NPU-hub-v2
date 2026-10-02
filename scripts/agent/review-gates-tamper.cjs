#!/usr/bin/env node
// scripts/agent/review-gates-tamper.cjs   (decision 3 and the review marker, 2026-10-02)
//
// The real campaign and sequence routes run against an in-memory database that applies the
// filters each query sends and keeps rows between calls, so a save is followed by the state it
// leaves behind.
//   R_ACTIVATE     setting a campaign Active while its sequence has unreviewed AI steps is refused
//                  (409, naming how many and where), and the campaign stays a draft
//   R_FAILCLOSED   if the steps cannot be read, activation is refused (503), never allowed
//   M_DELETE       deleting a step moves each AI step's marker with its content: an unreviewed one
//                  stays unreviewed, a reviewed one keeps its mark, a person's step carries none
//   M_REORDER      the same when two steps swap places
//   M_NOID         the same for a client that sends no step ids (matched by content)
//   M_EDIT         an AI step whose text is edited on its screen counts as reviewed (ruling 14)
//   R_SHIFT_GUARD  after [person, unreviewed AI] becomes [unreviewed AI], the enroll guard still
//                  answers unreviewed (positional markers would leave the AI copy on an unmarked
//                  row and delete the marked one, and the guard would answer clear)
//   C_OK           control: drafts save freely, a new step carries no marker, and once every step
//                  is reviewed the same activation succeeds
//
//   noguard     the activate check is skipped                         {R_ACTIVATE,R_FAILCLOSED}
//   failopen    a failed read counts as zero unreviewed steps         {R_FAILCLOSED}
//   positional  markers stay on the row (the old behaviour)           {M_DELETE,M_REORDER,M_NOID,M_EDIT,R_SHIFT_GUARD}
//   nohash      steps without ids are not matched by content          {M_NOID}
//   editkeeps   an edited AI step stays unreviewed                    {M_EDIT}
// TAMPER=1 reddens the union (7). positional shares M_NOID and M_EDIT with nohash and editkeeps,
// and noguard shares R_FAILCLOSED with failopen (a fail-closed refusal needs the guard to run);
// every one of them pushes its shared case red, so none can cancel another.
const fs = require('fs')
const H = require('./lib/harness.cjs')

const TAMPERS = {
  noguard: [['app/api/marketing/campaigns/route.ts', "if (row.status === 'active') {", 'if (false) {']],
  failopen: [['lib/marketing/ai-review.ts', '  if (error) return null\n  return data?.length ?? 0', '  if (error) return 0\n  return data?.length ?? 0']],
  positional: [['app/api/marketing/sequences/route.ts', 'const full = { ...r, ...markers[i] }', 'const full = { ...r }']],
  nohash: [['lib/marketing/step-markers.ts', '    if (e) { used.add(e.id); source[i] = e }', '']],
  editkeeps: [['lib/marketing/step-markers.ts', 'return { ai_run_id: s.ai_run_id, ai_reviewed_at: s.ai_reviewed_at ?? now }', 'return { ai_run_id: s.ai_run_id, ai_reviewed_at: s.ai_reviewed_at }']],
}
const RED_OF = { noguard: ['R_ACTIVATE', 'R_FAILCLOSED'], failopen: ['R_FAILCLOSED'], positional: ['M_DELETE', 'M_REORDER', 'M_NOID', 'M_EDIT', 'R_SHIFT_GUARD'],
  nohash: ['M_NOID'], editkeeps: ['M_EDIT'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-review')
const load = H.install(out)
const { POST: CAMPAIGNS } = load('app/api/marketing/campaigns/route.ts')
const { POST: SEQUENCES } = load('app/api/marketing/sequences/route.ts')
const { aiReviewState } = load('lib/marketing/ai-review.ts')

const T = '2026-10-01T10:00:00Z'
const email = (subject, body) => ({ channel: 'email', kind: 'marketing', delay_minutes: 0, subject, body, step_type: 'message', asset_id: null })
const HUMAN = email('Welcome', 'Hi {{first_name}}, welcome.')
const AI_U = email('Your guide', 'Hi {{first_name}}, here is the guide.')
const AI_R = email('One idea', 'Hi {{first_name}}, one idea from the guide.')

function memDb(D, opts = {}) {
  let n = 0
  const val = (table, row, col) => {
    if (!col.includes('.')) return row[col]
    const [rel, c] = col.split('.')
    if (table === 'sequence_steps' && rel === 'sequences') return ((D.sequences || []).find((s) => s.id === row.sequence_id) || {})[c]
  }
  const match = (table, row, ops) => ops.every(([m, a]) =>
    m === 'eq' ? val(table, row, a[0]) === a[1] : m === 'is' ? (val(table, row, a[0]) ?? null) === a[1]
      : m === 'in' ? a[1].includes(val(table, row, a[0])) : m === 'not' ? (val(table, row, a[0]) ?? null) !== a[2] : true)
  return H.stubDb({}, {
    rpc: () => ({ data: null, error: null }),
    table: (table, ops, mode) => {
      if (opts.failSteps && table === 'sequence_steps' && ops.some((o) => o[0] === 'not')) return { data: null, error: { code: 'XX000' } }
      const rows = D[table] || (D[table] = [])
      const ins = ops.find((o) => o[0] === 'insert'), up = ops.find((o) => o[0] === 'update'), del = ops.find((o) => o[0] === 'delete')
      if (ins) { const r = { id: `${table}-new-${++n}`, ...ins[1][0] }; rows.push(r); return mode === 'many' ? { data: [{ ...r }], error: null } : { data: { ...r }, error: null } }
      const hit = rows.filter((r) => match(table, r, ops))
      if (del) { D[table] = rows.filter((r) => !hit.includes(r)); return { data: null, error: null } }
      if (up) { for (const r of hit) Object.assign(r, up[1][0]); return { data: hit.map((r) => ({ ...r })), error: null } }
      return mode === 'many' ? { data: hit.map((r) => ({ ...r })), error: null } : { data: hit[0] ? { ...hit[0] } : null, error: null }
    },
  })
}
const world = (steps) => ({
  funnel_campaigns: [{ id: 'C', org_id: 'O', name: 'Draft', status: 'draft', sequence_id: 'S' }],
  sequences: [{ id: 'S', org_id: 'O', name: 'Draft steps', campaign_id: 'C' }],
  sequence_steps: steps.map((s, i) => ({ id: `row${i}`, sequence_id: 'S', step_order: i, ...s.c, ai_run_id: s.ai ? 'RUN' : null, ai_reviewed_at: s.rev ?? null })),
  university_assets: [],
})
const as = (D, opts) => { global.__ctx = { userId: 'U', orgIds: ['O'], orgRoles: { O: 'admin' }, isSuperadmin: false, db: memDb(D, opts) }; return global.__ctx.db }
const post = (fn, body) => fn({ json: async () => body }, { params: {} })
const activate = (D, opts) => { as(D, opts); return post(CAMPAIGNS, { org_id: 'O', id: 'C', name: 'Draft', status: 'active', sequence_id: 'S' }) }
const saveSteps = (D, steps) => { as(D); return post(SEQUENCES, { org_id: 'O', id: 'S', name: 'Draft steps', campaign_id: 'C', steps }) }
// the marker on whichever row now holds each piece of content, in order
const markers = (D) => D.sequence_steps.filter((r) => r.sequence_id === 'S').sort((a, b) => a.step_order - b.step_order)
  .map((r) => `${r.subject}:${r.ai_run_id ? (r.ai_reviewed_at ? 'reviewed' : 'UNREVIEWED') : 'none'}`)

;(async () => {
  const rows = []
  const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
  const three = () => world([{ c: HUMAN }, { c: AI_U, ai: true }, { c: AI_R, ai: true, rev: T }])

  // activation
  {
    const D = three(); const r = await activate(D)
    check('R_ACTIVATE', r.status === 409 && /^1 step was drafted/.test(r.body.error) && /Approve/.test(r.body.error) && r.body.unreviewed_steps === 1
      && D.funnel_campaigns[0].status === 'draft', { status: r.status, error: r.body.error, now: D.funnel_campaigns[0].status })
    const F = three(); const f = await activate(F, { failSteps: true })
    check('R_FAILCLOSED', f.status === 503 && F.funnel_campaigns[0].status === 'draft', { status: f.status, now: F.funnel_campaigns[0].status })
  }
  // markers through the real save path
  {
    const D = three()
    await saveSteps(D, [{ id: 'row1', ...AI_U }, { id: 'row2', ...AI_R }])
    check('M_DELETE', JSON.stringify(markers(D)) === JSON.stringify(['Your guide:UNREVIEWED', 'One idea:reviewed']), markers(D))
    const R = three()
    await saveSteps(R, [{ id: 'row2', ...AI_R }, { id: 'row1', ...AI_U }, { id: 'row0', ...HUMAN }])
    check('M_REORDER', JSON.stringify(markers(R)) === JSON.stringify(['One idea:reviewed', 'Your guide:UNREVIEWED', 'Welcome:none']), markers(R))
    const N = three()
    await saveSteps(N, [{ ...AI_U }, { ...AI_R }])
    check('M_NOID', JSON.stringify(markers(N)) === JSON.stringify(['Your guide:UNREVIEWED', 'One idea:reviewed']), markers(N))
    const E = three()
    await saveSteps(E, [{ id: 'row0', ...HUMAN }, { id: 'row1', ...AI_U, body: 'Hi {{first_name}}, here is the guide you asked for.' }, { id: 'row2', ...AI_R }])
    check('M_EDIT', JSON.stringify(markers(E)) === JSON.stringify(['Welcome:none', 'Your guide:reviewed', 'One idea:reviewed']), markers(E))
  }
  // the shift that positional markers would let through
  {
    const D = world([{ c: HUMAN }, { c: AI_U, ai: true }])
    await saveSteps(D, [{ id: 'row1', ...AI_U }])
    const guard = await aiReviewState(memDb(D), 'S')
    check('R_SHIFT_GUARD', guard === 'unreviewed' && JSON.stringify(markers(D)) === JSON.stringify(['Your guide:UNREVIEWED']), { guard, markers: markers(D) })
  }
  // control: drafts save, a new step has no marker, and full review lets activation through
  {
    const D = three()
    as(D); const draft = await post(CAMPAIGNS, { org_id: 'O', id: 'C', name: 'Draft', status: 'draft', sequence_id: 'S' })
    await saveSteps(D, [{ id: 'row0', ...HUMAN }, { id: 'row1', ...AI_U }, { id: 'row2', ...AI_R }, { ...email('Brand new', 'Hi {{first_name}}, a new note.') }])
    const fresh = markers(D)[3]
    for (const r of D.sequence_steps) if (r.ai_run_id) r.ai_reviewed_at = T
    const ok = await activate(D)
    check('C_OK', draft.status === 200 && fresh === 'Brand new:none' && ok.status === 200 && D.funnel_campaigns[0].status === 'active', { draft: draft.status, fresh, ok: ok.status })
  }

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})().catch((e) => { console.error(e); process.exit(2) })
