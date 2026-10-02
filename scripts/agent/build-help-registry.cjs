#!/usr/bin/env node
// scripts/agent/build-help-registry.cjs   (npm run agent:registry)
//
// The Hub Guide may only point at routes and controls that exist (ruling 18). This builds
// the registry it checks against, from the code itself:
//   routes    every page under src/app/(dashboard) (route groups dropped, dynamic segments
//             left out), plus every href in src/lib/nav-config.ts
//   help_ids  every literal data-help-id="..." attribute in src, and every helpId('...') marker
//   screens   every data-help-screen="..." value: the screen id the Guide panel sends (ruling 19)
// and writes src/lib/agent/help-registry.json. `--check` exits 1 when that file is stale, so a
// renamed control or a removed page cannot ship while the registry still lists it.
const fs = require('fs'), path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src')
const OUT = path.join(SRC, 'lib', 'agent', 'help-registry.json')

function walk(dir, fn) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, fn) } else fn(p)
  }
}

function build() {
  const routes = new Set()
  const dash = path.join(SRC, 'app', '(dashboard)')
  walk(dash, (p) => {
    if (!/[\\/]page\.tsx$/.test(p)) return
    const segs = path.relative(dash, path.dirname(p)).split(path.sep).filter(Boolean).filter((s) => !/^\(.*\)$/.test(s))
    if (segs.some((s) => s.startsWith('['))) return
    routes.add('/' + segs.join('/'))
  })
  const nav = fs.readFileSync(path.join(SRC, 'lib', 'nav-config.ts'), 'utf8')
  for (const m of nav.matchAll(/href:\s*'([^']+)'/g)) routes.add(m[1].split('?')[0])

  const ids = new Set()
  const screens = new Set()
  walk(SRC, (p) => {
    if (!/\.tsx?$/.test(p)) return
    const s = fs.readFileSync(p, 'utf8')
    for (const m of s.matchAll(/data-help-id=["']([a-z0-9][a-z0-9.-]*)["']/g)) ids.add(m[1])
    for (const m of s.matchAll(/helpId\(['"]([a-z0-9][a-z0-9.-]*)['"]\)/g)) ids.add(m[1])
    for (const m of s.matchAll(/data-help-screen=["']([a-z0-9][a-z0-9.-]*)["']/g)) screens.add(m[1])
  })
  return JSON.stringify({ routes: [...routes].sort(), help_ids: [...ids].sort(), screens: [...screens].sort() }, null, 1) + '\n'
}

const body = build()
const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : null
if (process.argv.includes('--check')) {
  if (cur !== body) { console.error('stale: src/lib/agent/help-registry.json (run node scripts/agent/build-help-registry.cjs)'); process.exit(1) }
  console.log('help registry is current'); process.exit(0)
}
if (cur !== body) { fs.writeFileSync(OUT, body); console.log('wrote src/lib/agent/help-registry.json') } else console.log('help registry is current')
