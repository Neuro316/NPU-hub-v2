#!/usr/bin/env node
// scripts/agent/scope-tamper.cjs   (stage gate 3: the cross-tenant assertion for this build's data access)
//
// The real route and library code run against an in-memory database that APPLIES the filters
// each query sends (eq, not, is, and the sequences!inner join), so a missing org filter shows up
// as a row of the other org being changed. The caller is a staff admin of org OA only.
//   X_APPROVE_ROW    approving another org's campaign, form or page: 404 and nothing changes
//   X_APPROVE_STEP   approving another org's sequence step: 404 and nothing changes
//   X_TASK           marking another org's campaign task: 404 and nothing changes
//   X_ORG_SPOOF      naming the other org in the body is refused before anything is read
//   X_PAGES          updating another org's landing page through the pages route: 404, unchanged
//   X_PUBLIC_HIDDEN  /p/<slug> shows nothing for a draft or an archived page
//   X_PUBLIC_FLAG    /p/<slug> shows nothing while the org's pages flag is off
//   X_PUBLIC_FORM    a published page never carries an unpublished form
//   X_ENROLL_GUARD   a sequence with unreviewed AI steps is 'unreviewed'; a failed read is 'unknown'
//   X_ENROLL_WIRED   the legacy enroll route imports and calls the guard (comments stripped)
//   C_OWN            control: the same calls DO change the caller's own org's rows, and a
//                    published page in a flag-on org IS shown
//
//   approveorg  approve stops filtering on org                  {X_APPROVE_ROW}
//   steporg     step approve stops checking the sequence's org  {X_APPROVE_STEP}
//   taskorg     task stops filtering on org                     {X_TASK}
//   pagesorg    the pages route update stops filtering on org   {X_PAGES}
//   pubdraft    the public page stops requiring published       {X_PUBLIC_HIDDEN}
//   pubflag     the public page stops checking the pages flag   {X_PUBLIC_FLAG}
//   pubform     an unpublished form is shown on a page          {X_PUBLIC_FORM}
//   noreview    the guard always answers clear                  {X_ENROLL_GUARD}
//   nocaller    the enroll route stops calling the guard        {X_ENROLL_WIRED}
// TAMPER=1 reddens the union (9).
const fs = require('fs'), path = require('path')
const H = require('./lib/harness.cjs')

const TAMPERS = {
  approveorg: [['app/api/marketing/agent/route.ts', ".update({ ai_reviewed_at: now }).eq('id', id).eq('org_id', org).not('ai_run_id', 'is', null)", ".update({ ai_reviewed_at: now }).eq('id', id).not('ai_run_id', 'is', null)"]],
  steporg: [['app/api/marketing/agent/route.ts', ".eq('id', id).eq('sequences.org_id', org).maybeSingle()", ".eq('id', id).maybeSingle()"]],
  taskorg: [['app/api/marketing/agent/route.ts', ".eq('id', typeof b.id === 'string' ? b.id : '').eq('org_id', org).select('id')", ".eq('id', typeof b.id === 'string' ? b.id : '').select('id')"]],
  pagesorg: [
    ['app/api/marketing/pages/route.ts', ".select('version, status, published_at').eq('id', b.id).eq('org_id', org).maybeSingle()", ".select('version, status, published_at').eq('id', b.id).maybeSingle()"],
    ['app/api/marketing/pages/route.ts', ".eq('id', b.id).eq('org_id', org).select('*')", ".eq('id', b.id).select('*')"],
  ],
  pubdraft: [['lib/marketing/public-page.ts', ".eq('slug', slug).eq('status', 'published').limit(2)", ".eq('slug', slug).limit(2)"]],
  pubflag: [['lib/marketing/public-page.ts', 'if (!(await getFlags(db, page.org_id)).pages) return null', '']],
  pubform: [['lib/marketing/public-page.ts', "if (f && (f as any).status === 'published') form =", 'if (f) form =']],
  noreview: [['lib/marketing/ai-review.ts', "return (data?.length ?? 0) > 0 ? 'unreviewed' : 'clear'", "return 'clear'"]],
  nocaller: [],
}
const RED_OF = { approveorg: ['X_APPROVE_ROW'], steporg: ['X_APPROVE_STEP'], taskorg: ['X_TASK'], pagesorg: ['X_PAGES'], pubdraft: ['X_PUBLIC_HIDDEN'],
  pubflag: ['X_PUBLIC_FLAG'], pubform: ['X_PUBLIC_FORM'], noreview: ['X_ENROLL_GUARD'], nocaller: ['X_ENROLL_WIRED'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-scope')
const load = H.install(out)
const { POST: AGENT } = load('app/api/marketing/agent/route.ts')
const { POST: PAGES } = load('app/api/marketing/pages/route.ts')
const { loadPublicPage } = load('lib/marketing/public-page.ts')
const { aiReviewState } = load('lib/marketing/ai-review.ts')

const BLOCKS = [{ type: 'heading', text: 'Hello', level: 1 }, { type: 'form' }]
const fresh = () => ({
  funnel_campaigns: [{ id: 'CA', org_id: 'OA', ai_run_id: 'R', ai_reviewed_at: null }, { id: 'CB', org_id: 'OB', ai_run_id: 'R', ai_reviewed_at: null }],
  form_definitions: [
    { id: 'FA', org_id: 'OA', ai_run_id: 'R', ai_reviewed_at: null, slug: 'fa', status: 'published', fields: [], consents: [] },
    { id: 'FB', org_id: 'OB', ai_run_id: 'R', ai_reviewed_at: null, slug: 'fb', status: 'published', fields: [], consents: [] },
    { id: 'FD', org_id: 'OA', ai_run_id: null, ai_reviewed_at: null, slug: 'fd', status: 'draft', fields: [], consents: [] },
  ],
  page_definitions: [
    { id: 'PA', org_id: 'OA', ai_run_id: 'R', ai_reviewed_at: null, slug: 'pa', title: 'A', status: 'published', blocks: BLOCKS, form_definition_id: 'FA', version: 1 },
    { id: 'PB', org_id: 'OB', ai_run_id: 'R', ai_reviewed_at: null, slug: 'pb', title: 'B', status: 'published', blocks: BLOCKS, form_definition_id: 'FB', version: 1 },
    { id: 'PD', org_id: 'OA', ai_run_id: null, ai_reviewed_at: null, slug: 'pd', title: 'D', status: 'draft', blocks: BLOCKS, form_definition_id: 'FA', version: 1 },
    { id: 'PX', org_id: 'OA', ai_run_id: null, ai_reviewed_at: null, slug: 'px', title: 'X', status: 'archived', blocks: BLOCKS, form_definition_id: 'FA', version: 1 },
    { id: 'PF', org_id: 'OA', ai_run_id: null, ai_reviewed_at: null, slug: 'pf', title: 'F', status: 'published', blocks: BLOCKS, form_definition_id: 'FD', version: 1 },
  ],
  sequences: [{ id: 'SA', org_id: 'OA' }, { id: 'SB', org_id: 'OB' }],
  sequence_steps: [{ id: 'STA', sequence_id: 'SA', ai_run_id: 'R', ai_reviewed_at: null }, { id: 'STB', sequence_id: 'SB', ai_run_id: 'R', ai_reviewed_at: null }],
  campaign_tasks: [{ id: 'TA', org_id: 'OA', status: 'open' }, { id: 'TB', org_id: 'OB', status: 'open' }],
  org_settings: [
    { org_id: 'OA', setting_key: 'hub_marketing_flags', setting_value: { pages: 'on' } },
    { org_id: 'OB', setting_key: 'hub_marketing_flags', setting_value: {} },
  ],
})

/** An in-memory table store that applies the filters a query sends. */
function memDb(D) {
  const val = (table, row, col) => {
    if (!col.includes('.')) return row[col]
    const [rel, c] = col.split('.')
    if (table === 'sequence_steps' && rel === 'sequences') return (D.sequences.find((s) => s.id === row.sequence_id) || {})[c]
    return undefined
  }
  const match = (table, row, ops) => ops.every(([m, a]) =>
    m === 'eq' ? val(table, row, a[0]) === a[1]
      : m === 'is' ? (val(table, row, a[0]) ?? null) === a[1]
        : m === 'not' ? !(a[1] === 'is' ? (val(table, row, a[0]) ?? null) === a[2] : val(table, row, a[0]) === a[2])
          : true)
  return H.stubDb({}, {
    rpc: () => ({ data: null, error: null }),
    table: (table, ops, mode) => {
      const rows = D[table] || (D[table] = [])
      const up = ops.find((o) => o[0] === 'update'), ins = ops.find((o) => o[0] === 'insert'), ups = ops.find((o) => o[0] === 'upsert')
      if (ins || ups) { const r = { id: `NEW-${table}`, ...(ins || ups)[1][0] }; rows.push(r); return mode === 'many' ? { data: [r], error: null } : { data: r, error: null } }
      const hit = rows.filter((r) => match(table, r, ops))
      if (up) { for (const r of hit) Object.assign(r, up[1][0]); return { data: hit.map((r) => ({ ...r })), error: null } }
      const lim = ops.find((o) => o[0] === 'limit')
      const list = lim ? hit.slice(0, lim[1][0]) : hit
      return mode === 'many' ? { data: list.map((r) => ({ ...r })), error: null } : { data: list[0] ? { ...list[0] } : null, error: null }
    },
  })
}

const asA = (D) => { const db = memDb(D); global.__ctx = { userId: 'U1', orgIds: ['OA'], orgRoles: { OA: 'admin' }, isSuperadmin: false, db }; return db }
const post = (fn, body) => fn({ json: async () => body }, { params: {} })
const snap = (D) => JSON.stringify(D)

;(async () => {
  const rows = []
  const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

  // approve: campaign, form, page (one predicate in the route) and step (its own join)
  // each case gets its own database, so a defect one case catches cannot spill into the next
  const isolated = async (calls) => {
    const D = fresh(); asA(D)
    const before = snap(D)
    const statuses = []
    for (const body of calls) statuses.push((await post(AGENT, body)).status)
    return { statuses, unchanged: snap(D) === before }
  }
  {
    const row = await isolated([['campaign', 'CB'], ['form', 'FB'], ['page', 'PB']].map(([kind, id]) => ({ action: 'approve', org_id: 'OA', kind, id })))
    check('X_APPROVE_ROW', row.statuses.every((s) => s === 404) && row.unchanged, row)
    const step = await isolated([{ action: 'approve', org_id: 'OA', kind: 'step', id: 'STB' }])
    check('X_APPROVE_STEP', step.statuses[0] === 404 && step.unchanged, step)
    const task = await isolated([{ action: 'task', org_id: 'OA', id: 'TB', status: 'done' }])
    check('X_TASK', task.statuses[0] === 404 && task.unchanged, task)
    const spoof = await isolated([{ action: 'approve', org_id: 'OB', kind: 'campaign', id: 'CB' }])
    check('X_ORG_SPOOF', spoof.statuses[0] === 403 && spoof.unchanged, spoof)

    // control: the same calls on org A's own rows succeed and change exactly them
    const D = fresh(); asA(D)
    const own = []
    for (const [kind, id] of [['campaign', 'CA'], ['form', 'FA'], ['page', 'PA'], ['step', 'STA']]) own.push((await post(AGENT, { action: 'approve', org_id: 'OA', kind, id })).status)
    own.push((await post(AGENT, { action: 'task', org_id: 'OA', id: 'TA', status: 'done' })).status)
    const ownChanged = D.funnel_campaigns[0].ai_reviewed_at && D.form_definitions[0].ai_reviewed_at && D.page_definitions[0].ai_reviewed_at
      && D.sequence_steps[0].ai_reviewed_at && D.campaign_tasks[0].status === 'done'
    const otherUntouched = !D.funnel_campaigns[1].ai_reviewed_at && !D.sequence_steps[1].ai_reviewed_at && D.campaign_tasks[1].status === 'open'
    var controlApprove = own.every((s) => s === 200) && ownChanged && otherUntouched
  }
  // the pages route
  {
    const D = fresh(); asA(D)
    const before = snap(D)
    const r = await post(PAGES, { org_id: 'OA', id: 'PB', slug: 'pb', title: 'Taken over', status: 'draft', blocks: [{ type: 'heading', text: 'x', level: 1 }] })
    check('X_PAGES', r.status === 404 && snap(D) === before, r.status)
    const mine = await post(PAGES, { org_id: 'OA', id: 'PD', slug: 'pd', title: 'Renamed', status: 'draft', blocks: [{ type: 'heading', text: 'x', level: 1 }] })
    var controlPages = mine.status === 200 && D.page_definitions.find((p) => p.id === 'PD').title === 'Renamed'
  }
  // the public page
  {
    const D = fresh(); const db = memDb(D)
    const draft = await loadPublicPage(db, 'pd'), archived = await loadPublicPage(db, 'px')
    check('X_PUBLIC_HIDDEN', draft === null && archived === null, { draft: !!draft, archived: !!archived })
    const flagOff = await loadPublicPage(db, 'pb')
    check('X_PUBLIC_FLAG', flagOff === null, !!flagOff)
    const unpublishedForm = await loadPublicPage(db, 'pf')
    check('X_PUBLIC_FORM', unpublishedForm === null, unpublishedForm)
    const shown = await loadPublicPage(db, 'pa')
    var controlPublic = !!shown && shown.title === 'A' && shown.form && shown.form.slug === 'fa'
  }
  // the enroll guard, and that the legacy route actually calls it
  {
    const D = fresh()
    const unreviewed = await aiReviewState(memDb(D), 'SA')
    D.sequence_steps[0].ai_reviewed_at = '2026-10-01T00:00:00Z'
    const clear = await aiReviewState(memDb(D), 'SA')
    const failing = H.stubDb({}, { table: () => ({ data: null, error: { code: 'XX000' } }) })
    const unknown = await aiReviewState(failing, 'SA')
    check('X_ENROLL_GUARD', unreviewed === 'unreviewed' && clear === 'clear' && unknown === 'unknown', { unreviewed, clear, unknown })
    let src = fs.readFileSync(path.join(H.SRC, 'app', 'api', 'sequences', 'enroll', 'route.ts'), 'utf8')
    if (active.includes('nocaller')) src = src.replace('const review = await aiReviewState(', 'const review = await Promise.resolve(')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const wired = /import\s*\{[^}]*\baiReviewState\b[^}]*\}\s*from\s*['"]@\/lib\/marketing\/ai-review['"]/.test(code) && /\baiReviewState\s*\(/.test(code)
      && /review === 'unreviewed'/.test(code) && /review === 'unknown'/.test(code)
    check('X_ENROLL_WIRED', wired, null)
  }
  check('C_OWN', controlApprove && controlPages && controlPublic, { controlApprove, controlPages, controlPublic })

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})().catch((e) => { console.error(e); process.exit(2) })
