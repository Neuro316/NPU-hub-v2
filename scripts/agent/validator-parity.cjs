#!/usr/bin/env node
// scripts/agent/validator-parity.cjs
//
// Agent ruling 3 moved the checks inline in four routes into src/lib/marketing/validate/,
// so the Campaign Builder agent runs the same code as the screens. This proves the four
// routes still behave exactly as they did: the route as it was at PARITY_BASE (read with
// git show, so the comparison cannot drift) and the route on disk are compiled and run
// side by side against the same stub database, over a matrix of requests, and the
// response (status and body) and every database call each makes must be identical.
//
// TAMPER=<selector> plants one defect in the NEW validator code and the run must redden
// exactly the declared set:
//   message   a campaign error message changes wording          {P_campaigns}
//   delay     step delays are no longer rounded                 {P_sequences}
//   lower     source keys are no longer lower-cased             {P_routes}
//   slug      the form address rule accepts double dashes       {P_forms}
// TAMPER=1 runs all four; the union must be reddened.
// Exit: 0 green or declared set; 1 undeclared red; 2 unknown selector, dead anchor, git
// failure; 3 a tampered run whose red set is not the declaration.
const { execFileSync } = require('child_process')
const fs = require('fs'), path = require('path'), os = require('os'), Module = require('module')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const BASE = process.env.PARITY_BASE || 'd49d00e'
const ROUTES = {
  campaigns: 'app/api/marketing/campaigns/route.ts',
  sequences: 'app/api/marketing/sequences/route.ts',
  routes: 'app/api/marketing/routes/route.ts',
  forms: 'app/api/marketing/forms/route.ts',
}
const LIBS = ['lib/marketing/db-errors.ts', 'lib/marketing/team-member.ts', 'lib/marketing/intake.ts', 'lib/phone.ts',
  'lib/sms-split.ts', 'lib/marketing/render.ts', 'lib/crm-server.ts',
  'lib/marketing/validate/campaign.ts', 'lib/marketing/validate/sequence.ts', 'lib/marketing/validate/route.ts', 'lib/marketing/validate/form.ts']
const TAMPERS = {
  message: ['lib/marketing/validate/campaign.ts', "message: 'Give the campaign a name.'", "message: 'Name the campaign.'"],
  delay: ['lib/marketing/validate/sequence.ts', 'Math.max(0, Math.round(Number(s.delay_minutes)))', 'Math.max(0, Number(s.delay_minutes))'],
  lower: ['lib/marketing/validate/route.ts', "raw.trim().toLowerCase()", 'raw.trim()'],
  slug: ['lib/marketing/validate/form.ts', 'export const FORM_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/', 'export const FORM_SLUG = /^[a-z0-9][a-z0-9-]*$/'],
}
const RED_OF = { message: ['P_campaigns'], delay: ['P_sequences'], lower: ['P_routes'], slug: ['P_forms'] }
const sel = process.env.TAMPER || ''
const active = sel === '1' ? Object.keys(TAMPERS) : sel ? sel.split(',') : []
for (const t of active) if (!TAMPERS[t]) { console.error(`unknown selector ${t}`); process.exit(2) }

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-vparity-'))
const compile = (rel, src) => {
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  const dest = path.join(out, rel.replace(/\.ts$/, '.js'))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, js)
}
const used = new Set()
for (const rel of LIBS) {
  let src = fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8')
  for (const t of active) {
    const [file, from, to] = TAMPERS[t]
    if (file !== rel) continue
    if (!src.includes(from)) { console.error(`dead anchor: ${t}`); process.exit(2) }
    src = src.split(from).join(to); used.add(t)
  }
  compile(rel, src)
}
for (const t of active) if (!used.has(t)) { console.error(`dead anchor: ${t} matched no module`); process.exit(2) }
// The campaign and sequence routes changed ON PURPOSE after the extraction (decision 3's activate
// guard, and the review marker following each step: scripts/agent/review-gates-tamper.cjs). This
// harness proves ruling 3 only, so for those two the "new" side is the route as merged with the
// extraction (EXTRACTED), still running today's validators; the other two are read from disk.
const EXTRACTED = process.env.PARITY_EXTRACTED || '9507c74'
const PINNED = new Set(['campaigns', 'sequences'])
for (const [k, rel] of Object.entries(ROUTES)) {
  let now
  if (PINNED.has(k)) {
    try { now = execFileSync('git', ['show', `${EXTRACTED}:src/${rel}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch { console.error(`git show ${EXTRACTED}:src/${rel} failed (is the history fetched?)`); process.exit(2) }
  } else now = fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8')
  compile(rel.replace('route.ts', 'route_new.ts'), now)
  let old
  try { old = execFileSync('git', ['show', `${BASE}:src/${rel}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch { console.error(`git show ${BASE}:src/${rel} failed (is the history fetched?)`); process.exit(2) }
  compile(rel.replace('route.ts', 'route_old.ts'), old)
}

// ── stubs shared by the old and the new route, so only the route code differs ──
const STUBS = {
  'next/server': { NextResponse: { json: (body, init) => ({ status: (init && init.status) || 200, body }) } },
  '@/lib/api-guard': {
    withStaff: (h) => (req, route) => h(req, global.__ctx, (route && route.params) || {}),
    requireOrg: (ctx, orgId) => (typeof orgId !== 'string' || !ctx.orgIds.includes(orgId)
      ? { status: 403, body: { error: 'You do not have access to that organization.' } } : orgId),
    bad: (msg, extra = {}) => ({ status: 400, body: { error: msg, ...extra } }),
    forbidden: (msg) => ({ status: 403, body: { error: msg } }),
  },
}
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, parent, ...rest) {
  if (STUBS[req]) return `stub:${req}`
  if (req.startsWith('@/')) req = path.join(out, req.slice(2))
  return origResolve.call(this, req, parent, ...rest)
}
const origLoad = Module._load
Module._load = function (req, parent, ...rest) {
  if (STUBS[req]) return STUBS[req]
  return origLoad.call(this, req, parent, ...rest)
}

// ── a stub database: a small org, every call recorded ──
const DATA = {
  pipelines: [{ id: 'P1', org_id: 'O1' }, { id: 'P2', org_id: 'O1' }, { id: 'PX', org_id: 'O2' }],
  pipeline_stages: [{ id: 'S1', org_id: 'O1', pipeline_id: 'P1' }, { id: 'S2', org_id: 'O1', pipeline_id: 'P2' }, { id: 'SX', org_id: 'O2', pipeline_id: 'PX' }],
  sequences: [{ id: 'Q1', org_id: 'O1' }],
  campaigns: [{ id: 'K1', org_id: 'O1' }],
  funnel_campaigns: [{ id: 'C1', org_id: 'O1' }, { id: 'CX', org_id: 'O2' }],
  university_assets: [{ id: 'A1', org_id: 'O1' }, { id: 'AX', org_id: 'O2' }],
  form_definitions: [{ id: 'F1', org_id: 'O1', version: 3 }],
  team_members: [{ id: 'T1', org_id: 'O1', user_id: 'U1', is_active: true }],
  sequence_steps: [{ id: 'ST0', sequence_id: 'Q1', step_order: 0 }, { id: 'ST1', sequence_id: 'Q1', step_order: 1 }, { id: 'ST2', sequence_id: 'Q1', step_order: 2 }],
}
function makeDb(log) {
  return {
    from(table) {
      const ops = []
      const b = {}
      for (const m of ['select', 'eq', 'in', 'order', 'insert', 'update', 'upsert', 'delete', 'limit']) {
        b[m] = (...args) => { ops.push([m, args]); return b }
      }
      const run = (mode) => {
        log.push(JSON.stringify([table, ops, mode]))
        const write = ops.find((o) => ['insert', 'update', 'upsert', 'delete'].includes(o[0]))
        if (write) {
          if (write[0] === 'delete') return { error: null }
          const payload = Array.isArray(write[1][0]) ? write[1][0][0] : write[1][0]
          const row = { id: `W-${table}`, ...payload }
          return mode === 'single' ? { data: row, error: null } : { data: [row], error: null }
        }
        let rows = (DATA[table] || []).slice()
        for (const [m, a] of ops) {
          if (m === 'eq') rows = rows.filter((r) => r[a[0]] === a[1])
          if (m === 'in') rows = rows.filter((r) => a[1].includes(r[a[0]]))
        }
        if (mode === 'maybeSingle') return { data: rows[0] || null, error: null }
        if (mode === 'single') return { data: rows[0] || null, error: null }
        return { data: rows, error: null }
      }
      b.maybeSingle = () => ({ then: (res, rej) => Promise.resolve(run('maybeSingle')).then(res, rej) })
      b.single = () => ({ then: (res, rej) => Promise.resolve(run('single')).then(res, rej) })
      b.then = (res, rej) => Promise.resolve(run('many')).then(res, rej)
      return b
    },
  }
}

// ── the request matrix ──
const long = 'x'.repeat(1500)
const MATRIX = {
  campaigns: [
    {}, { org_id: 'O2', name: 'x' }, { org_id: 'O1' }, { org_id: 'O1', name: '   ' }, { org_id: 'O1', name: 'A', status: 'live' },
    { org_id: 'O1', name: 'A', entry_pipeline_id: 'PX' }, { org_id: 'O1', name: 'A', entry_pipeline_id: 'P1', entry_stage_id: 'S2' },
    { org_id: 'O1', name: 'A', entry_pipeline_id: 'P1', entry_stage_id: 'S1', goal_stage_id: 'SX' },
    { org_id: 'O1', name: 'A', sequence_id: 'QX' }, { org_id: 'O1', name: 'A', planning_campaign_id: 'K9' },
    { org_id: 'O1', name: 'A', entry_stage_id: 'S1' }, { org_id: 'O1', name: 'A', entry_stage_id: 'S9' },
    { org_id: 'O1', name: ' Good ', status: 'draft', entry_pipeline_id: 'P1', entry_stage_id: 'S1', goal_stage_id: 'S2', sequence_id: 'Q1', planning_campaign_id: 'K1' },
    { org_id: 'O1', id: 'C1', name: 'Rename', status: 'active', goal: { note: 'x' } }, { org_id: 'O1', name: 'Blank ids', entry_pipeline_id: '', sequence_id: null },
  ],
  sequences: [
    {}, { org_id: 'O1' }, { org_id: 'O1', name: 'S', steps: Array.from({ length: 31 }, () => ({ channel: 'wait' })) },
    { org_id: 'O1', name: 'S', steps: [{ channel: 'fax' }] }, { org_id: 'O1', name: 'S', steps: [{ channel: 'email', body: 'b' }] },
    { org_id: 'O1', name: 'S', steps: [{ channel: 'email', subject: 's' }] }, { org_id: 'O1', name: 'S', steps: [{ channel: 'sms', body: long }] },
    { org_id: 'O1', name: 'S', steps: [{ channel: 'sms', body: 'x'.repeat(1430), kind: 'service' }] },
    { org_id: 'O1', name: 'S', steps: [{ channel: 'sms', body: 'x'.repeat(1430), kind: 'marketing' }] },
    { org_id: 'O1', name: 'S', steps: [{ channel: 'email', step_type: 'deliver_asset', asset_id: 'AX', subject: 's' }] },
    { org_id: 'O1', name: 'S', steps: [{ channel: 'email', step_type: 'deliver_asset', asset_id: 'A1', subject: 'Your guide' }] },
    { org_id: 'O1', name: 'S', campaign_id: 'CX', steps: [] },
    { org_id: 'O1', name: 'S', steps: [{ channel: 'wait', delay_minutes: '90.6' }, { channel: 'email', subject: ' Hi ', body: 'Hello', delay_minutes: -5 }] },
    { org_id: 'O1', id: 'Q1', name: 'Edit', campaign_id: 'C1', steps: [{ channel: 'sms', body: 'Hi', kind: 'service', delay_minutes: 1440.4 }] },
  ],
  routes: [
    {}, { org_id: 'O1', source_key: 'Bad Key' }, { org_id: 'O1', source_key: '  FORM:Webinar ' }, { org_id: 'O1', source_key: 'form:webinar', campaign_id: 'CX' },
    { org_id: 'O1', source_key: 'form:webinar', campaign_id: 'C1' }, { org_id: 'O1', source_key: 'call:missed', campaign_id: 'C1', active: false },
    { org_id: 'O1', source_key: 'tag:vip', campaign_id: 'C1', remove: true },
  ],
  forms: [
    {}, { org_id: 'O1', slug: 'Bad Slug' }, { org_id: 'O1', slug: 'a--b', name: 'x' }, { org_id: 'O1', slug: 'x'.repeat(61), name: 'x' },
    { org_id: 'O1', slug: 'ok' }, { org_id: 'O1', slug: 'ok', name: 'Ok', status: 'published' },
    { org_id: 'O1', slug: 'ok', name: 'Ok', source_key: 'Bad Key!' }, { org_id: 'O1', slug: ' Webinar ', name: ' Webinar ', status: 'weird' },
    { org_id: 'O1', slug: 'guide', name: 'Guide', source_key: ' FORM:Guide ', success_message: ' Thanks ', fields: [{ key: 'email', label: 'Email', type: 'email', required: true, maps_to: 'email' }] },
    { org_id: 'O1', id: 'F1', slug: 'guide', name: 'Guide v2' }, { org_id: 'O1', id: 'F9', slug: 'guide', name: 'Missing' },
  ],
}

async function runOne(file, body) {
  const log = []
  global.__ctx = { userId: 'U1', orgIds: ['O1'], orgRoles: { O1: 'admin' }, isSuperadmin: false, db: makeDb(log) }
  const mod = require(file)
  const res = await mod.POST({ json: async () => JSON.parse(JSON.stringify(body)) }, { params: {} })
  // updated_at is a clock reading; replace it so the two runs compare equal
  const clean = (s) => s.replace(/"updated_at":"[^"]+"/g, '"updated_at":"<now>"')
  return { res: clean(JSON.stringify(res)), log: log.map(clean) }
}

;(async () => {
  const rows = []
  for (const [k, rel] of Object.entries(ROUTES)) {
    const oldF = path.join(out, rel.replace('route.ts', 'route_old.js'))
    const newF = path.join(out, rel.replace('route.ts', 'route_new.js'))
    let diffs = 0, first = null, ok400 = 0, ok200 = 0
    for (const body of MATRIX[k]) {
      const a = await runOne(oldF, body), b = await runOne(newF, body)
      const status = JSON.parse(a.res).status
      if (status === 400) ok400++
      if (status === 200) ok200++
      if (a.res !== b.res || JSON.stringify(a.log) !== JSON.stringify(b.log)) { diffs++; first = first || { body, old: a.res, new: b.res } }
    }
    rows.push({ id: `P_${k}`, ok: diffs === 0, got: diffs ? { diffs, first } : `${MATRIX[k].length} requests identical` })
    // the control: the matrix must reach both a refusal and a success, or "identical" proves little
    rows.push({ id: `C_${k}_covers`, ok: ok400 > 0 && ok200 > 0, got: { refusals: ok400, successes: ok200 } })
  }
  // the control that the validators are really in use: the new routes import them
  const imports = Object.values(ROUTES).every((rel) => /from '@\/lib\/marketing\/validate\//.test(fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8')))
  rows.push({ id: 'C_routes_use_validators', ok: imports, got: imports })

  fs.rmSync(out, { recursive: true, force: true })
  const red = rows.filter((r) => !r.ok).map((r) => r.id).sort()
  for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'RED '} ${r.id}  ${typeof r.got === 'string' ? r.got : JSON.stringify(r.got)}`)
  if (!active.length) {
    console.log(red.length ? `FAIL: ${red.length} red of ${rows.length}` : `PASS: ${rows.length} of ${rows.length} against ${BASE}`)
    process.exit(red.length ? 1 : 0)
  }
  const want = Array.from(new Set(active.flatMap((t) => RED_OF[t]))).sort()
  console.log(`red {${red.join(',')}}, declared {${want.join(',')}}`)
  if (red.length === 0) { console.error('FATAL: a TAMPERED run PASSED.'); process.exit(3) }
  if (JSON.stringify(red) !== JSON.stringify(want)) { console.error('FATAL: tampered red SET does not match the declaration.'); process.exit(3) }
  process.exit(0)
})().catch((e) => { console.error(e); process.exit(2) })
