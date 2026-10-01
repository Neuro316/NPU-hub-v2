#!/usr/bin/env node
// scripts/marketing/sequence-created-by-probe.cjs
// REQUIRES_LIVE = 'database'  (reads .env.local; never run in CI, which has no secrets)
//
// Contract test for the 2026-10-01 bug "The sequence could not be created":
// sequences.created_by is FOREIGN KEY (created_by) REFERENCES team_members(id)
// (verified in pg_catalog), and the funnel route used to send the AUTH USER id.
//
// It compiles the REAL route (src/app/api/marketing/sequences/route.ts) and runs it as a
// real staff user against the LIVE database, through a client whose READS are real and
// whose WRITES are captured and never sent. It then checks the row the route would have
// inserted into sequences against live data: created_by must be null or the id of an
// ACTIVE team_members row for that user in that org, which is exactly what the foreign
// key demands. Nothing is written to the database.
//
// TAMPER=authid  puts the pre-fix value (the auth user id) back   {S1}
// The HEAD~1 check is the same run against the pre-fix tree.
// Exit: 0 green or declared set; 1 undeclared red; 2 setup failure / dead anchor; 3 tampered run passed or set mismatch.
const fs = require('fs'), path = require('path'), os = require('os'), Module = require('module')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src')
const STAFF_USER = process.env.PROBE_USER_ID || '22456608-5f7d-495e-af02-7037fea125cc'   // Cameron, NP superadmin
const ORG = process.env.PROBE_ORG_ID || '00000000-0000-0000-0000-000000000001'
const FAKE_SEQ = '00000000-0000-4000-8000-00000000beef'
const RED_OF = { authid: ['S1'] }
const sel = process.env.TAMPER || ''
const active = sel === '1' ? Object.keys(RED_OF) : sel ? sel.split(',') : []
for (const t of active) if (!RED_OF[t]) { console.error(`unknown selector ${t}`); process.exit(2) }

// ── credentials from .env.local, never printed ──
const envFile = path.join(ROOT, '.env.local')
if (!fs.existsSync(envFile)) { console.error('needs .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(2) }
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const real = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ── compile the real route and what it imports, into this run's own directory ──
// under node_modules/.cache so bare imports (next/server, @supabase) resolve; a fresh dir per run
fs.mkdirSync(path.join(ROOT, 'node_modules', '.cache'), { recursive: true })
const out = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.cache', 'hub-seqprobe-'))
const MODULES = ['app/api/marketing/sequences/route.ts', 'lib/sms-split.ts', 'lib/marketing/render.ts', 'lib/crm-server.ts',
  'lib/marketing/team-member.ts', 'lib/marketing/db-errors.ts']
for (const rel of MODULES) {
  const file = path.join(SRC, rel)
  if (!fs.existsSync(file)) continue   // the pre-fix tree has no team-member.ts or db-errors.ts
  let src = fs.readFileSync(file, 'utf8')
  if (rel.endsWith('sequences/route.ts') && active.includes('authid')) {
    const a = 'created_by: createdBy,'
    if (!src.includes(a)) { console.error('dead anchor: authid'); process.exit(2) }
    src = src.replace(a, 'created_by: ctx.userId,')
  }
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  const dest = path.join(out, rel.replace(/\.ts$/, '.js'))
  fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, js)
}
// the auth wrapper is replaced by the staff context it would have produced for this user
fs.mkdirSync(path.join(out, 'lib'), { recursive: true })
fs.writeFileSync(path.join(out, 'lib', 'api-guard.js'), `
const { NextResponse } = require('next/server')
exports.withStaff = (h) => (req, route) => h(req, globalThis.__probeCtx, (route && route.params) || {})
exports.requireOrg = (ctx, o) => (typeof o === 'string' && ctx.orgIds.includes(o) ? o : NextResponse.json({ error: 'forbidden' }, { status: 403 }))
exports.bad = (m) => NextResponse.json({ error: m }, { status: 400 })
exports.forbidden = (m) => NextResponse.json({ error: m }, { status: 403 })
`)
const resolve0 = Module._resolveFilename
Module._resolveFilename = function (req, parent, ...rest) {
  if (req.startsWith('@/')) req = path.join(out, req.slice(2))
  return resolve0.call(this, req, parent, ...rest)
}

// ── a client whose reads are real and whose writes are captured ──
const writes = []
function fakeChain(table, op, row) {
  let single = false
  const result = () => {
    if (op === 'insert' && table === 'sequences') return { data: single ? { id: FAKE_SEQ } : [{ id: FAKE_SEQ }], error: null }
    if (op === 'delete') return { data: null, error: null }
    return { data: single ? { id: 'captured' } : [{ id: 'captured' }], error: null }
  }
  const c = {}
  for (const m of ['eq', 'in', 'select', 'order', 'limit', 'is', 'not']) c[m] = () => c
  c.single = () => { single = true; return c }
  c.maybeSingle = () => { single = true; return c }
  c.then = (ok, bad) => Promise.resolve(result()).then(ok, bad)
  writes.push({ table, op, row })
  return c
}
const db = {
  from(table) {
    return {
      select: (...a) => real.from(table).select(...a),
      insert: (row) => fakeChain(table, 'insert', row),
      update: (row) => fakeChain(table, 'update', row),
      upsert: (row) => fakeChain(table, 'upsert', row),
      delete: () => fakeChain(table, 'delete', null),
    }
  },
  rpc: (...a) => real.rpc(...a),
}

;(async () => {
  const rows = []
  const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
  try {
    const { data: camp } = await real.from('funnel_campaigns').select('id').eq('org_id', ORG).limit(1)
    globalThis.__probeCtx = { userId: STAFF_USER, orgIds: [ORG], orgRoles: { [ORG]: 'super_admin' }, isSuperadmin: true, db }
    const route = require(path.join(out, 'app/api/marketing/sequences/route.js'))
    const body = { org_id: ORG, name: 'Contract probe steps', campaign_id: camp?.[0]?.id ?? null,
      steps: [{ channel: 'email', delay_minutes: 0, subject: 'Hello', body: 'Hi {{first_name}}', kind: 'marketing', step_type: 'message' },
              { channel: 'sms', delay_minutes: 60, body: 'A reminder from {{org_name}}', kind: 'service', step_type: 'message' }] }
    const res = await route.POST({ json: async () => body }, { params: {} })
    const json = await res.json()
    check('R0', res.status === 200 && json.sequence_id === FAKE_SEQ && json.steps === 2, { status: res.status, json })

    const seqInsert = writes.find((w) => w.table === 'sequences' && w.op === 'insert')
    const cb = seqInsert?.row?.created_by ?? null
    // ── THE FOREIGN KEY, evaluated against live data ──
    let fkOk = cb === null
    if (cb !== null) {
      const { data: tm } = await real.from('team_members').select('id, org_id, user_id, is_active').eq('id', cb).maybeSingle()
      fkOk = !!tm && tm.org_id === ORG && tm.user_id === STAFF_USER && tm.is_active === true
    }
    check('S1', !!seqInsert && fkOk, { created_by: cb, is_auth_user_id: cb === STAFF_USER })
    const steps = writes.filter((w) => w.table === 'sequence_steps' && w.op === 'insert')
    check('S2', steps.length === 2 && steps.every((w) => w.row.sequence_id === FAKE_SEQ), steps.length)
    // control: the auth user id must itself FAIL this foreign key, or S1 proves nothing
    const { data: ctl } = await real.from('team_members').select('id').eq('id', STAFF_USER).maybeSingle()
    check('C1', !ctl, 'the auth user id is not a team_members id')
  } catch (e) {
    rows.push({ id: 'CRASH', ok: false, got: `${e?.name}: ${e?.message}` })
  } finally { fs.rmSync(out, { recursive: true, force: true }) }

  const red = rows.filter((r) => !r.ok).map((r) => r.id).sort()
  for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'RED '} ${r.id}  ${JSON.stringify(r.got)}`)
  console.log(`captured writes (never sent): ${writes.map((w) => `${w.op} ${w.table}`).join(', ')}`)
  if (!active.length) { console.log(red.length ? `FAIL: ${red.length} red` : `PASS: ${rows.length} of ${rows.length}`); process.exitCode = red.length ? 1 : 0; return }
  const want = Array.from(new Set(active.flatMap((t) => RED_OF[t]))).sort()
  console.log(`red {${red.join(',')}}, declared {${want.join(',')}}`)
  if (!red.length) { console.error('FATAL: a TAMPERED run PASSED.'); process.exitCode = 3; return }
  if (JSON.stringify(red) !== JSON.stringify(want)) { console.error('FATAL: tampered red SET does not match the declaration.'); process.exitCode = 3; return }
  process.exitCode = 0
})()
