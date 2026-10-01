// scripts/agent/lib/harness.cjs
// Shared by the scripts/agent/*-tamper.cjs harnesses: compile REAL source (with planted
// defects) into this run's own temp directory, stub the few packages a pure test must not
// reach, record every database call, and report in the SET convention.
const fs = require('fs'), path = require('path'), os = require('os'), Module = require('module')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..', '..')
const SRC = path.join(ROOT, 'src')

/** Every module under these folders is compiled, so imports between them just work. */
const DIRS = ['lib/agent', 'lib/marketing', 'app/api/marketing/agent']
const EXTRA = ['lib/phone.ts', 'lib/sms-split.ts', 'lib/crm-server.ts']

function listTs(dir) {
  const abs = path.join(SRC, dir)
  if (!fs.existsSync(abs)) return []
  const out = []
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) out.push(...listTs(rel))
    else if (/\.tsx?$/.test(e.name)) out.push(rel)
  }
  return out
}

/**
 * Compiles the source tree with the active tampers applied. tampers: { name: [[file, from, to], ...] }.
 * Exits 2 on an unknown selector or a substitution that matched nothing (a dead tamper).
 */
function compile(tampers, active, prefix) {
  for (const t of active) if (!tampers[t]) { console.error(`unknown selector ${t}`); process.exit(2) }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  const hits = Object.fromEntries(active.map((t) => [t, 0]))
  const files = [...new Set([...DIRS.flatMap(listTs), ...EXTRA])]
  for (const rel of files) {
    let src = fs.readFileSync(path.join(SRC, rel), 'utf8')
    for (const t of active) for (const [file, from, to] of tampers[t]) {
      if (file !== rel) continue
      if (!src.includes(from)) { console.error(`dead anchor: ${t} in ${file}`); process.exit(2) }
      src = src.split(from).join(to); hits[t]++
    }
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.React } }).outputText
    const dest = path.join(out, rel.replace(/\.tsx?$/, '.js'))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, js)
  }
  for (const t of active) {
    const want = tampers[t].length
    if (hits[t] < want) { console.error(`dead anchor: ${t} matched ${hits[t]} of ${want}`); process.exit(2) }
  }
  return out
}

class APIError extends Error { constructor(status) { super(`api ${status}`); this.status = status } }
// the live client can be constructed but every call fails as an unreachable service would,
// so no harness can ever reach the network
const offline = async () => { throw new APIError(undefined) }
const SDK = Object.assign(function Anthropic() { return { messages: { create: offline }, beta: { messages: { create: offline } } } }, {
  APIError, AuthenticationError: class extends APIError {}, PermissionDeniedError: class extends APIError {},
  BadRequestError: class extends APIError {}, NotFoundError: class extends APIError {},
})
SDK.default = SDK

/** Wires '@/...' to the compiled tree and replaces packages with stubs. */
function install(out, extraStubs = {}) {
  const stubs = {
    '@anthropic-ai/sdk': SDK,
    'next/server': { NextResponse: { json: (body, init) => ({ status: (init && init.status) || 200, body }) } },
    '@/lib/api-guard': {
      withStaff: (h) => (req, route) => h(req, global.__ctx, (route && route.params) || {}),
      requireOrg: (ctx, orgId) => (typeof orgId !== 'string' || !ctx.orgIds.includes(orgId)
        ? { status: 403, body: { error: 'You do not have access to that organization.' } } : orgId),
      bad: (msg, extra = {}) => ({ status: 400, body: { error: msg, ...extra } }),
      forbidden: (msg) => ({ status: 403, body: { error: msg } }),
    },
    ...extraStubs,
  }
  const origResolve = Module._resolveFilename
  Module._resolveFilename = function (req, parent, ...rest) {
    if (stubs[req]) return `stub:${req}`
    if (req.startsWith('@/')) req = path.join(out, req.slice(2))
    return origResolve.call(this, req, parent, ...rest)
  }
  const origLoad = Module._load
  Module._load = function (req, parent, ...rest) {
    if (stubs[req]) return stubs[req]
    return origLoad.call(this, req, parent, ...rest)
  }
  return (rel) => require(path.join(out, rel.replace(/\.tsx?$/, '.js')))
}

/**
 * A recording database. handlers.table(table, ops, mode) and handlers.rpc(name, args) return
 * { data, error, count }; anything not handled reads from `data` and writes succeed.
 */
function stubDb(data = {}, handlers = {}) {
  const calls = []
  const db = {
    calls,
    rpc(name, args) {
      calls.push({ rpc: name, args })
      const r = handlers.rpc ? handlers.rpc(name, args) : undefined
      return Promise.resolve(r ?? { data: null, error: null })
    },
    from(table) {
      const ops = []
      const b = {}
      for (const m of ['select', 'eq', 'neq', 'is', 'in', 'gte', 'order', 'insert', 'update', 'upsert', 'delete', 'limit']) {
        b[m] = (...args) => { ops.push([m, args]); return b }
      }
      const run = (mode) => {
        calls.push({ table, ops, mode })
        const h = handlers.table ? handlers.table(table, ops, mode) : undefined
        if (h) return h
        const write = ops.find((o) => ['insert', 'update', 'upsert', 'delete'].includes(o[0]))
        if (write) {
          if (write[0] === 'delete') return { error: null }
          const payload = Array.isArray(write[1][0]) ? write[1][0][0] : write[1][0]
          const row = { id: `W-${table}`, ...payload }
          return mode === 'single' || mode === 'maybeSingle' ? { data: row, error: null } : { data: [row], error: null }
        }
        let rows = (data[table] || []).slice()
        for (const [m, a] of ops) {
          if (m === 'eq') rows = rows.filter((r) => r[a[0]] === a[1])
          if (m === 'neq') rows = rows.filter((r) => r[a[0]] !== a[1])
          if (m === 'is') rows = rows.filter((r) => (r[a[0]] ?? null) === a[1])
        }
        const sel = ops.find((o) => o[0] === 'select')
        if (sel && sel[1][1] && sel[1][1].head) return { data: null, count: rows.length, error: null }
        if (mode === 'maybeSingle' || mode === 'single') return { data: rows[0] || null, error: null }
        return { data: rows, error: null }
      }
      b.maybeSingle = () => ({ then: (res, rej) => Promise.resolve(run('maybeSingle')).then(res, rej) })
      b.single = () => ({ then: (res, rej) => Promise.resolve(run('single')).then(res, rej) })
      b.then = (res, rej) => Promise.resolve(run('many')).then(res, rej)
      return b
    },
  }
  return db
}

/** Prints the rows and exits under the SET convention used by every harness here. */
function report(rows, active, RED_OF, cleanup) {
  if (cleanup) cleanup()
  const red = rows.filter((r) => !r.ok).map((r) => r.id).sort()
  for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'RED '} ${r.id}${r.ok ? '' : `  got ${JSON.stringify(r.got)}`}`)
  if (!active.length) {
    console.log(red.length ? `FAIL: ${red.length} red of ${rows.length}` : `PASS: ${rows.length} of ${rows.length}`)
    process.exit(red.length ? 1 : 0)
  }
  const want = Array.from(new Set(active.flatMap((t) => RED_OF[t]))).sort()
  console.log(`red {${red.join(',')}}, declared {${want.join(',')}}`)
  if (red.length === 0) { console.error('FATAL: a TAMPERED run PASSED.'); process.exit(3) }
  if (JSON.stringify(red) !== JSON.stringify(want)) { console.error('FATAL: tampered red SET does not match the declaration.'); process.exit(3) }
  process.exit(0)
}

function selectors(TAMPERS) {
  const sel = process.env.TAMPER || ''
  return sel === '1' ? Object.keys(TAMPERS) : sel ? sel.split(',') : []
}

module.exports = { ROOT, SRC, compile, install, stubDb, report, selectors }
