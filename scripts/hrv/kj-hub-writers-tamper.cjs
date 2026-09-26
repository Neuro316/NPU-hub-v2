// scripts/hrv/kj-hub-writers-tamper.cjs
//
// Proves the hub side of Addendum C §KJ / §KE / §KF (ruled by Cameron 2026-09-26):
//   - the onboarding pipeline no longer writes np_hrv_participant_map (STEP 6 deleted, §KE)
//     and no longer writes np_hrv_sessions.participant_id (STEP 7 disabled, §KJ),
//   - the email-mismatch flag inside the deleted STEP 6 SURVIVED the deletion (§KE),
//   - the xreg-participant-sync cron REFUSES by name (§KF) before touching the database,
//     and its three email-keyed writers are gone,
//   - the */30 schedule is out of vercel.json.
//
// Run:  npm run check:kj            (untampered; must exit 0)
//       TAMPER=<selector> npm run check:kj   one of KNOWN below; must exit 1 with the declared set
//       TAMPER=1 npm run check:kj   every selector; red set must be the union and the count the sum
//
// The two real TypeScript files are compiled with the real compiler and EXECUTED against a fake
// PostgREST chain that records every table touched. The route runs through Next's own NextResponse
// (loadable under Node 24). Tampers perturb the EMITTED JS, so a stale anchor exits 2 rather than
// running green. Modelled on scripts/consent-merge-test.mjs (this repo) and the platform's
// scripts/hrv/identity-resolver-tamper.cjs.
//
// ── WHAT THIS FILE IS, DECLARED. There is no verify runner in this repo yet; kept for the day. ──
const HARNESS = { needs: 'nothing', writes: false }

'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.resolve(__dirname, '..', '..')
const SRC = path.join(REPO, 'src')
const PIPELINE_REL = path.join('lib', 'onboarding-pipeline.ts')
const ROUTE_REL = path.join('app', 'api', 'integrations', 'xreg-participant-sync', 'route.ts')

const RAW = (process.env.TAMPER || '').trim()
const KNOWN = ['dropflag', 'restorewriter', 'enablecron', 'keepschedule']

// ⚠⚠ THE RED SET, DECLARED IN CODE AND TRANSCRIBED FROM THE PLAN BEFORE THE FIRST RUN (§BV).
// A disagreement between this map and a measured run is THE FINDING, not something to overwrite.
// Selectors are disjoint by construction: each perturbs a different artefact (pipeline JS, source
// text, route JS, vercel.json), so TAMPER=1 must measure exactly 1 + 1 + 1 + 1 = 4.
const RED_OF = {
  dropflag:      ['B'],   // the email-mismatch flag stops firing
  restorewriter: ['E'],   // an email-keyed participant_id write is planted in BOTH files
  enablecron:    ['D'],   // DISABLED_BY_RULING_KF flipped: no 503, and the db gets touched
  keepschedule:  ['F'],   // the */30 entry is back in vercel.json
}

let TAMPERS = []
if (RAW === '1') TAMPERS = KNOWN.slice()
else if (RAW) {
  TAMPERS = RAW.split(',').map(s => s.trim()).filter(Boolean)
  const bad = TAMPERS.filter(t => !KNOWN.includes(t))
  // ⚠ An unknown selector EXITS 2 rather than running green: a typo must not masquerade as a pass.
  if (bad.length) { console.error(`FATAL: unknown TAMPER: ${bad.join(', ')}`); process.exit(2) }
}
const TAMPERED = TAMPERS.length > 0

// ── a fake PostgREST chain that RECORDS every table touched ────────────────────────────────────
// Returns "nothing exists yet" to every read so the pipeline walks its create branches, and hands
// back an id to every .single() so an insert looks like it landed.
function makeDb() {
  const touched = []   // [{ table, ops: [...] }]
  const db = {
    touched,
    from(table) {
      const rec = { table, ops: [] }
      touched.push(rec)
      let single = false, maybe = false
      const api = {}
      for (const m of ['select', 'eq', 'ilike', 'in', 'is', 'not', 'order', 'limit',
                       'update', 'insert', 'upsert', 'delete']) {
        api[m] = (...args) => { rec.ops.push(m); if (m === 'update' || m === 'upsert' || m === 'insert') rec.payload = args[0]; return api }
      }
      api.single = () => { rec.ops.push('single'); single = true; return api }
      api.maybeSingle = () => { rec.ops.push('maybeSingle'); maybe = true; return api }
      api.then = (res, rej) => {
        const data = maybe ? null : single ? { id: `fake-${table}` } : []
        return Promise.resolve({ data, error: null }).then(res, rej)
      }
      return api
    },
    auth: {
      admin: {
        inviteUserByEmail: async () => ({ data: { user: { id: 'fake-profile' } }, error: null }),
        createUser:        async () => ({ data: { user: { id: 'fake-profile' } }, error: null }),
        listUsers:         async () => ({ data: { users: [] }, error: null }),
        generateLink:      async () => ({ data: { properties: { action_link: 'https://x/magic' } }, error: null }),
      },
    },
  }
  return db
}

// ── compile the REAL modules, then perturb the EMITTED JS ──────────────────────────────────────
function compile() {
  const cacheRoot = path.join(REPO, 'node_modules', '.cache')
  fs.mkdirSync(cacheRoot, { recursive: true })
  const dir = fs.mkdtempSync(path.join(cacheRoot, 'kjhub-'))
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} })

  const cfg = path.join(dir, 'tsconfig.harness.json')
  fs.writeFileSync(cfg, JSON.stringify({
    compilerOptions: {
      outDir: dir, rootDir: SRC, module: 'commonjs', target: 'es2019',
      moduleResolution: 'node', esModuleInterop: true, skipLibCheck: true, strict: true,
      baseUrl: REPO, paths: { '@/*': ['./src/*'] },
      types: ['node'], typeRoots: [path.join(REPO, 'node_modules', '@types')],
    },
    files: [path.join(SRC, PIPELINE_REL), path.join(SRC, ROUTE_REL)],
  }))
  execFileSync('npx', ['tsc', '-p', cfg], { cwd: REPO, stdio: 'pipe', shell: process.platform === 'win32' })

  const pipelineJs = path.join(dir, PIPELINE_REL.replace(/\.ts$/, '.js'))
  const routeJs = path.join(dir, ROUTE_REL.replace(/\.ts$/, '.js'))

  // tsc does NOT rewrite `paths` aliases in emitted JS. Point '@/…' at the emitted tree.
  for (const f of [pipelineJs, routeJs]) {
    const before = fs.readFileSync(f, 'utf8')
    const after = before.replace(/require\("@\//g, `require("${dir.replace(/\\/g, '/')}/`)
    fs.writeFileSync(f, after)
  }

  const subject = [
    ['dropflag',   pipelineJs, /requiresManualIntervention = true/g, 'requiresManualIntervention = false'],
    ['enablecron', routeJs,    /const DISABLED_BY_RULING_KF = true/g, 'const DISABLED_BY_RULING_KF = false'],
  ]
  for (const [name, file, re, rep] of subject) {
    if (!TAMPERS.includes(name)) continue
    const before = fs.readFileSync(file, 'utf8')
    const after = before.replace(re, rep)
    // ⚠ A substitution that matched NOTHING is a dead tamper. Exit 2, never run on.
    if (after === before) {
      console.error(`FATAL: TAMPER=${name} matched nothing -- the anchor is stale.`)
      process.exit(2)
    }
    fs.writeFileSync(file, after)
  }
  return { pipelineJs, routeJs }
}

// Stand in for @supabase/supabase-js so the ROUTE's own createClient() hands back the recorder.
// Installed in require.cache before the route is loaded; the pipeline is given the db directly.
let routeDb = null
function installSupabaseStub() {
  const resolved = require.resolve('@supabase/supabase-js')
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true,
    exports: { createClient: () => routeDb },
  }
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

let red = 0
const rows = []
const check = (id, label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) red++
  rows.push({ id, ok, label, a: JSON.stringify(actual), e: JSON.stringify(expected) })
}

async function main() {
  installSupabaseStub()
  const { pipelineJs, routeJs } = compile()
  const { runOnboardingPipeline } = require(pipelineJs)
  const { GET } = require(routeJs)

  const base = {
    email: 'person@example.com', firstName: 'Test', lastName: 'Person',
    track: 'enrolled', source: 'admin', sendInviteEmail: false,
  }

  // ── A. the pipeline touches NEITHER identity table. Control A0: it DOES touch the tables it
  //    still owns, so the recorder is proven to see writes when they happen.
  {
    const db = makeDb()
    await runOnboardingPipeline({ ...base, xregEmail: 'other@vendor.example' }, db)
    const tables = Array.from(new Set(db.touched.map(t => t.table))).sort()
    check('A', '⚠ pipeline run: no np_hrv_sessions, no np_hrv_participant_map', {
      sessions: tables.includes('np_hrv_sessions'),
      map:      tables.includes('np_hrv_participant_map'),
    }, { sessions: false, map: false })
    check('A0', 'CONTROL: the same run touched contacts, profiles and np_onboarding_log', {
      contacts: tables.includes('contacts'), profiles: tables.includes('profiles'),
      log: tables.includes('np_onboarding_log'),
    }, { contacts: true, profiles: true, log: true })
  }

  // ── B. §KE: the email-mismatch flag SURVIVED the STEP 6 deletion. Control B0: equal emails,
  //    no flag -- so B is not green because the flag is stuck on.
  {
    const r = await runOnboardingPipeline({ ...base, xregEmail: 'Other@Vendor.example' }, makeDb())
    const step = r.steps.find(s => s.step === 'xreg_map' && s.action === 'email_mismatch_flagged')
    check('B', '⚠ xReg email ≠ enrollment email -> requiresManualIntervention, reason names both', {
      flag: r.requiresManualIntervention,
      namesBoth: /Other@Vendor\.example/.test(r.manualInterventionReason || '')
              && /person@example\.com/.test(r.manualInterventionReason || ''),
      stepPresent: !!step,
    }, { flag: true, namesBoth: true, stepPresent: true })

    const r0 = await runOnboardingPipeline({ ...base, xregEmail: 'PERSON@example.com' }, makeDb())
    check('B0', 'CONTROL: equal emails (case-insensitive) -> no flag, no step', {
      flag: r0.requiresManualIntervention,
      stepPresent: r0.steps.some(s => s.action === 'email_mismatch_flagged'),
    }, { flag: false, stepPresent: false })
  }

  // ── C. §KJ: STEP 7 records its refusal when there is a profile, and says nothing when there is
  //    not (the original was gated on profileId; the refusal keeps that gate).
  {
    const withProfile = await runOnboardingPipeline({ ...base }, makeDb())
    const without = await runOnboardingPipeline({ ...base, createAccount: false }, makeDb())
    const pick = (r) => r.steps.filter(s => s.step === 'xreg_sessions_backlink').map(s => s.action)
    check('C', 'STEP 7 pushes disabled_by_ruling with a profile; nothing without one', {
      withProfile: pick(withProfile), without: pick(without),
      noteNamesKJ: /§KJ/.test((withProfile.steps.find(s => s.step === 'xreg_sessions_backlink') || {}).note || ''),
    }, { withProfile: ['disabled_by_ruling'], without: [], noteNamesKJ: true })
  }

  // ── D. §KF: the cron REFUSES by name, with the right bearer, BEFORE touching the database.
  //    Control D0: the wrong bearer is still a 401 -- auth precedes the refusal, so the route
  //    cannot be used to learn anything without the secret.
  {
    process.env.CRON_SECRET = 'harness-secret'
    const req = (bearer) => ({
      headers: { get: (k) => k.toLowerCase() === 'authorization' ? bearer : null },
      nextUrl: { searchParams: new URLSearchParams('') },
    })
    routeDb = makeDb()
    const res = await GET(req('Bearer harness-secret'))
    const body = await res.json()
    check('D', '⚠ authorised GET -> 503, reason disabled_by_ruling_KF, zero tables touched', {
      status: res.status, reason: body.reason, citesKF: /§KF/.test(body.detail || ''),
      touched: routeDb.touched.map(t => t.table),
    }, { status: 503, reason: 'disabled_by_ruling_KF', citesKF: true, touched: [] })

    routeDb = makeDb()
    const res0 = await GET(req('Bearer wrong'))
    check('D0', 'CONTROL: wrong bearer -> 401 and zero tables touched', {
      status: res0.status, touched: routeDb.touched.map(t => t.table),
    }, { status: 401, touched: [] })
  }

  // ── E. the email-keyed participant_id writers are GONE from both files, asserted per file as
  //    the absence of the WRITE SHAPE in comment-stripped source (the platform's case G).
  {
    const writesParticipantId = (rel) => {
      let code = stripComments(fs.readFileSync(path.join(SRC, rel), 'utf8'))
      if (TAMPERS.includes('restorewriter')) {
        // plant the exact defect this asserts the absence of
        code += "\nawait db.from('np_hrv_sessions').update({ participant_id: pid }).eq('xreg_user_email', em)\n"
      }
      return /update\(\s*\{\s*participant_id/.test(code)
    }
    check('E', '⚠ no participant_id write survives in EITHER file, asserted per file', {
      pipeline: writesParticipantId(PIPELINE_REL),
      route:    writesParticipantId(ROUTE_REL),
    }, { pipeline: false, route: false })
  }

  // ── F. the */30 schedule is out of vercel.json.
  {
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'vercel.json'), 'utf8'))
    const crons = Array.isArray(cfg.crons) ? cfg.crons.slice() : []
    if (TAMPERS.includes('keepschedule')) {
      crons.push({ path: '/api/integrations/xreg-participant-sync', schedule: '*/30 * * * *' })
    }
    check('F', 'vercel.json carries no xreg-participant-sync schedule', {
      scheduled: crons.some(c => /xreg-participant-sync/.test(c.path || '')),
      // control: the sibling cron is still there, so the file was actually read
      siblingPresent: crons.some(c => /process-pending-participants/.test(c.path || '')),
    }, { scheduled: false, siblingPresent: true })
  }

  // ── report ───────────────────────────────────────────────────────────────────────────────────
  for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'RED '} ${r.id.padEnd(3)} ${r.label}`)
  for (const r of rows) if (!r.ok) console.log(`      ${r.id}: got ${r.a}\n      ${r.id}: want ${r.e}`)

  const got = rows.filter(r => !r.ok).map(r => r.id).sort()
  const want = Array.from(new Set([].concat.apply([], TAMPERS.map(t => RED_OF[t])))).sort()
  console.log(`\n${TAMPERED ? `TAMPER=${TAMPERS.join(',')}` : 'untampered'}  red {${got.join(',')}}, declared {${want.join(',')}}`)

  if (!TAMPERED) {
    if (red > 0) { console.error('FAIL'); process.exit(1) }
    console.log('PASS'); return
  }
  // ⚠ A TAMPERED RUN THAT PASSED MEANS THE TAMPER IS DEAD.
  if (red === 0) { console.error('FATAL: a TAMPERED run PASSED. The tamper is dead.'); process.exit(3) }
  // ⚠ AND THE SET, NOT THE COUNT. Under a standing red elsewhere, `red > 0` cannot tell a live
  // selector from a dead one. The declaration is what discriminates.
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error('FATAL: the tampered red SET does not match the declaration.')
    process.exit(3)
  }
  console.log('tampered as declared')
  process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
