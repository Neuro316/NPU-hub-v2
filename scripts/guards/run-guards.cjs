#!/usr/bin/env node
// scripts/guards/run-guards.cjs
//
// Five build-failing guards (hardening b). Each guard is a pure function over a "tree"
// (a map of path -> text), so it is first run against FIXTURES that each plant one
// instance of the exact defect it exists to catch, and must report exactly that
// finding, and a clean fixture must report none. Only then is it run on the real repo.
// A guard that cannot find its planted defect fails the build: it would be decoration.
//
//   G1 service-role route without an auth wrapper or a verified secret
//   G2 cron not in vercel.json, unreachable through middleware, or not failing closed
//   G3 environment variable read in src/ but missing from .env.example
//   G4 table created by a Hub migration (hub_211 onward) without RLS enabled
//   G5 Hub migration number (211 onward) colliding with a platform migration number
//
// Code that predates this build is listed in scripts/guards/baseline.json by name, so
// the guards fail on NEW violations. The baseline is a list of known findings, reported
// on every run; it is never a silence. `--write-baseline` regenerates it.
//
// TAMPER=<guard> disables that guard's detection; the self-test must then fail (exit 3).
const fs = require('fs'), path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const BASELINE_FILE = path.join(__dirname, 'baseline.json')
const PLATFORM_SNAPSHOT = path.join(__dirname, 'platform-migrations.txt')
const TAMPER = process.env.TAMPER || ''

// ── G1 ───────────────────────────────────────────────────────────────────────
// Reviewed public service-role routes, each with its own check (ruling 14).
const G1_REVIEWED_PUBLIC = {
  'src/app/api/intake/route.ts': 'published form + intake flag + honeypot + rate limit',
  'src/app/a/[token]/route.ts': 'hashed single-purpose expiring token, redirect to the University only',
}
// verifyTwilioWebhook: the click-to-call webhooks (always enforced, fail closed). That it
// runs before the first database call is proved by scripts/click-to-call/c2c-tamper.cjs.
const G1_WRAPPERS = /\bwithStaff\s*\(|\bcronAuthorized\s*\(|\bverifySvix\s*\(|\bverifyUnsubscribeToken\s*\(|\bverifyTwilioWebhook\s*\(/
function g1(tree) {
  const out = []
  for (const [f, src] of Object.entries(tree)) {
    if (!/^src\/app\/.*\/route\.tsx?$/.test(f)) continue
    if (!/createAdminSupabase\s*\(|SUPABASE_SERVICE_ROLE_KEY/.test(src)) continue
    if (TAMPER !== 'G1' && G1_WRAPPERS.test(src)) continue
    if (G1_REVIEWED_PUBLIC[f]) continue
    out.push(f)
  }
  return out.sort()
}

// ── G2 ───────────────────────────────────────────────────────────────────────
function middlewareReach(tree) {
  const mw = tree['src/middleware.ts'] || ''
  const neg = /\(\?!([^)]*)\)/.exec(mw)
  const excluded = neg ? neg[1].split('|').filter((x) => /^api\//.test(x)).map((x) => '/' + x.replace(/\$$/, '')) : []
  const sm = tree['src/lib/supabase-middleware.ts'] || ''
  const publicPrefixes = Array.from(sm.matchAll(/pathname\.startsWith\('([^']+)'\)/g)).map((m) => m[1])
  return (p) => excluded.some((x) => p === x || p.startsWith(x + '/')) || publicPrefixes.some((x) => p.startsWith(x))
}
const FAIL_CLOSED = /\bcronAuthorized\s*\(|if\s*\(\s*!secret\s*\|\|\s*!secret\.trim\(\)\s*\)/
function g2(tree) {
  const out = []
  let crons = []
  try { crons = JSON.parse(tree['vercel.json'] || '{}').crons || [] } catch { out.push('vercel.json: not valid JSON') }
  const reach = middlewareReach(tree)
  const paths = new Set(crons.map((c) => c.path))
  for (const p of paths) {
    const f = `src/app${p}/route.ts`
    if (!tree[f]) { out.push(`${p}: no route file`); continue }
    if (TAMPER !== 'G2' && !reach(p)) out.push(`${p}: unreachable, middleware redirects a cookieless cron to /login`)
    if (TAMPER !== 'G2' && !FAIL_CLOSED.test(tree[f])) out.push(`${p}: does not fail closed when CRON_SECRET is unset`)
  }
  for (const f of Object.keys(tree)) {
    const m = /^src\/app(\/api\/cron\/[^/]+)\/route\.ts$/.exec(f)
    if (m && !paths.has(m[1]) && TAMPER !== 'G2') out.push(`${m[1]}: cron route not scheduled in vercel.json`)
  }
  return out.sort()
}

// ── G3 ───────────────────────────────────────────────────────────────────────
function g3(tree) {
  const listed = new Set(Array.from((tree['.env.example'] || '').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)).map((m) => m[1]))
  const ignore = new Set(['NODE_ENV', 'NEXT_RUNTIME'])
  const used = new Map()
  for (const [f, src] of Object.entries(tree)) {
    if (!/^src\/.*\.(ts|tsx)$/.test(f)) continue
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) if (!used.has(m[1])) used.set(m[1], f)
  }
  const out = []
  for (const [name, f] of used) if (!ignore.has(name) && (TAMPER === 'G3' ? false : !listed.has(name))) out.push(`${name} (read in ${f})`)
  return out.sort()
}

// ── G4 ───────────────────────────────────────────────────────────────────────
const stripSqlComments = (s) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
function g4(tree) {
  const out = []
  for (const [f, raw] of Object.entries(tree)) {
    const m = /^supabase\/migrations\/(?:hub_)?(\d{3})_[^/]+\.sql$/.exec(f)
    if (!m || Number(m[1]) < 211) continue
    const src = stripSqlComments(raw)
    const created = Array.from(src.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)).map((x) => x[1].toLowerCase())
    const enabled = new Set(Array.from(src.matchAll(/alter\s+table\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+enable\s+row\s+level\s+security/gi)).map((x) => x[1].toLowerCase()))
    // the loop form: foreach t in array array['a','b'] loop ... enable row level security
    for (const loop of src.matchAll(/array\s*\[([^\]]*)\]\s*loop([\s\S]*?)end\s+loop/gi)) {
      if (/enable\s+row\s+level\s+security/i.test(loop[2])) for (const n of loop[1].matchAll(/'([a-z_][a-z0-9_]*)'/g)) enabled.add(n[1])
    }
    for (const t of created) if (TAMPER === 'G4' ? false : !enabled.has(t)) out.push(`${f}: table ${t} has no RLS`)
  }
  return out.sort()
}

// ── G5 ───────────────────────────────────────────────────────────────────────
function g5(tree) {
  const hub = Object.keys(tree).map((f) => /^supabase\/migrations\/(?:hub_)?(\d{3})_/.exec(f)).filter(Boolean).map((m) => Number(m[1]))
  const platform = (tree['__platform__'] || '').split(/\r?\n/).map((l) => /^(?:pf_)?(\d{3})_/.exec(l.trim())).filter(Boolean).map((m) => Number(m[1]))
  const plat = new Set(platform)
  const out = []
  const seen = new Map()
  for (const n of hub) {
    if (n < 211) continue
    if (TAMPER !== 'G5' && plat.has(n)) out.push(`hub migration ${n} collides with platform migration ${n}`)
    if (TAMPER !== 'G5' && seen.has(n)) out.push(`hub migration ${n} is numbered twice`)
    seen.set(n, true)
  }
  return out.sort()
}

const GUARDS = { G1: g1, G2: g2, G3: g3, G4: g4, G5: g5 }

// ── self-test: one planted defect per guard, and a clean tree ────────────────
const CLEAN = {
  'src/middleware.ts': "matcher: ['/((?!_next/static|api/cron|api/notify/sms$).*)']",
  'src/lib/supabase-middleware.ts': "pathname.startsWith('/api/webhooks') ||",
  'vercel.json': JSON.stringify({ crons: [{ path: '/api/cron/good', schedule: '* * * * *' }] }),
  'src/app/api/cron/good/route.ts': "import { cronAuthorized } from '@/lib/cron-auth'\nif (!cronAuthorized(req, 'x')) {}\nconst db = createAdminSupabase()",
  'src/app/api/staff/route.ts': 'export const GET = withStaff(async () => { createAdminSupabase() })',
  '.env.example': 'CRON_SECRET=\nRESEND_API_KEY=\n',
  'src/lib/x.ts': 'process.env.RESEND_API_KEY; process.env.CRON_SECRET',
  'supabase/migrations/hub_211_x.sql': "create table public.a (id int);\nalter table public.a enable row level security;\ndo $$ begin foreach t in array array['b'] loop execute format('alter table public.%I enable row level security', t); end loop; end $$;\ncreate table public.b (id int);",
  '__platform__': 'pf_201_x.sql\npf_202_y.sql\n',
}
const PLANTED = {
  G1: [{ 'src/app/api/leak/route.ts': 'export async function GET() { const db = createAdminSupabase() }' }, ['src/app/api/leak/route.ts']],
  G2: [{ 'vercel.json': JSON.stringify({ crons: [{ path: '/api/cron/good', schedule: '* * * * *' }, { path: '/api/stats/rollup', schedule: '* * * * *' }] }),
         'src/app/api/stats/rollup/route.ts': "if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {}" },
       ['/api/stats/rollup: does not fail closed when CRON_SECRET is unset', '/api/stats/rollup: unreachable, middleware redirects a cookieless cron to /login']],
  G3: [{ 'src/lib/y.ts': 'process.env.SECRET_NOBODY_LISTED' }, ['SECRET_NOBODY_LISTED (read in src/lib/y.ts)']],
  G4: [{ 'supabase/migrations/hub_212_y.sql': 'create table public.open_table (id int);' }, ['supabase/migrations/hub_212_y.sql: table open_table has no RLS']],
  G5: [{ 'supabase/migrations/hub_202_z.sql': '', 'supabase/migrations/hub_213_z.sql': '', '__platform__': 'pf_202_y.sql\npf_213_q.sql\n' }, ['hub migration 213 collides with platform migration 213']],
}
let selfFail = 0
for (const [g, fn] of Object.entries(GUARDS)) {
  const clean = fn(CLEAN)
  const [patch, want] = PLANTED[g]
  const got = fn({ ...CLEAN, ...patch })
  const ok = clean.length === 0 && JSON.stringify(got) === JSON.stringify([...want].sort())
  console.log(`${ok ? 'ok  ' : 'RED '} self-test ${g}: clean=${clean.length} planted=${JSON.stringify(got)}`)
  if (!ok) selfFail++
}
if (selfFail) {
  console.error(`FATAL: ${selfFail} guard(s) cannot find the defect they exist to catch.`)
  process.exit(TAMPER ? 3 : 1)
}
if (TAMPER) { console.error('FATAL: a TAMPERED guard still passed its self-test.'); process.exit(3) }

// ── the real repository ─────────────────────────────────────────────────────
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', '.vercel'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc); else acc.push(p)
  }
  return acc
}
const tree = {}
for (const p of [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'supabase', 'migrations'))]) {
  if (/\.(ts|tsx|sql)$/.test(p)) tree[path.relative(ROOT, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8')
}
for (const f of ['vercel.json', '.env.example']) tree[f] = fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), 'utf8') : ''
let platform = fs.existsSync(PLATFORM_SNAPSHOT) ? fs.readFileSync(PLATFORM_SNAPSHOT, 'utf8') : ''
const sibling = path.resolve(ROOT, '..', 'npu-platform-v2', 'supabase', 'migrations')
if (fs.existsSync(sibling)) platform += '\n' + fs.readdirSync(sibling).join('\n')
tree['__platform__'] = platform

const results = Object.fromEntries(Object.entries(GUARDS).map(([g, fn]) => [g, fn(tree)]))
if (process.argv.includes('--write-baseline')) {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(results, null, 2) + '\n')
  console.log(`baseline written: ${Object.entries(results).map(([g, r]) => `${g}=${r.length}`).join(' ')}`)
  process.exit(0)
}
const baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {}
let fail = 0
for (const [g, found] of Object.entries(results)) {
  const known = new Set(baseline[g] || [])
  const fresh = found.filter((x) => !known.has(x))
  const known_now = found.filter((x) => known.has(x))
  console.log(`${fresh.length ? 'FAIL' : 'ok  '} ${g}: ${fresh.length} new, ${known_now.length} known (baseline)`)
  for (const x of fresh) console.log(`       NEW   ${x}`)
  for (const x of known_now) console.log(`       known ${x}`)
  fail += fresh.length
}
console.log(fail ? `FAIL: ${fail} new finding(s)` : 'PASS: no new findings')
process.exit(fail ? 1 : 0)
