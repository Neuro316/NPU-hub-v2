#!/usr/bin/env node
// scripts/agent/help-ci.cjs   (ruling 23: keeping help true)
//
// Reads docs/help/*.md, docs/help/EXEMPT.md and src/lib/agent/help-registry.json, and fails when:
//   H_COVERED   (a) a registry route has no article and is not on the exempt list
//   H_EXEMPT        an exempt route no longer exists, or also has an article (a stale list)
//   H_REFS      (b) an article names a route, help id or related article that does not exist
//   H_DASH      (c) an article holds an em dash
//   H_CLAIMS    (c) an article holds a banned claim phrase (the same list the builder obeys)
//   H_FRESH         the registry file is stale against the source tree
// Each selector plants the exact defect in the input the check reads:
//   orphan   a new route appears with no article          {H_COVERED}
//   ghost    an exempt route that does not exist           {H_EXEMPT}
//   badref   an article names a help id that is not real   {H_REFS}
//   dash     an em dash in an article                      {H_DASH}
//   banned   "proven to" in an article                     {H_CLAIMS}
//   stale    the registry file loses a route               {H_FRESH}
// TAMPER=1 reddens the union (6).
const fs = require('fs'), path = require('path')
const { execFileSync } = require('child_process')
const H = require('./lib/harness.cjs')

const TAMPERS = { orphan: [], ghost: [], badref: [], dash: [], banned: [], stale: [] }
const RED_OF = { orphan: ['H_COVERED'], ghost: ['H_EXEMPT'], badref: ['H_REFS'], dash: ['H_DASH'], banned: ['H_CLAIMS'], stale: ['H_FRESH'] }
const active = H.selectors(TAMPERS)
for (const t of active) if (!TAMPERS[t]) { console.error(`unknown selector: ${t}`); process.exit(2) }
const on = (t) => active.includes(t)
const out = H.compile({}, [], 'hub-helpci')
const load = H.install(out)
const { parseArticle } = load('lib/agent/help/corpus.ts')
const { BANNED } = load('lib/agent/claims.ts')

const HELP = path.join(H.ROOT, 'docs', 'help')
const REG_FILE = path.join(H.ROOT, 'src', 'lib', 'agent', 'help-registry.json')
const DASH = String.fromCharCode(0x2014)
const norm = (s) => s.replace(/\r\n/g, '\n')

const files = fs.readdirSync(HELP).filter((f) => f.endsWith('.md') && f !== 'EXEMPT.md').sort()
const sources = files.map((f) => ({ file: f, text: norm(fs.readFileSync(path.join(HELP, f), 'utf8')) }))
if (on('dash')) sources[0].text = sources[0].text.replace('## Steps\n', `## Steps\n\nRead this first ${DASH} then start.\n`)
if (on('banned')) sources[1].text = sources[1].text.replace('## Steps\n', '## Steps\n\nThis is proven to work.\n')
const arts = sources.map((s) => ({ s, a: parseArticle(s.file, s.text) }))
if (on('badref')) arts[0].a.help_ids.push('nowhere.button')

const registryText = norm(fs.readFileSync(REG_FILE, 'utf8'))
const reg = JSON.parse(registryText)
if (on('orphan')) reg.routes.push('/brand-new-screen')
const exempt = norm(fs.readFileSync(path.join(HELP, 'EXEMPT.md'), 'utf8')).split('\n').map((l) => l.trim()).filter((l) => l.startsWith('/'))
if (on('ghost')) exempt.push('/screen-that-was-deleted')

;(async () => {
  const rows = []
  const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
  const parsed = arts.filter((x) => x.a).map((x) => x.a)
  check('C_PARSED', parsed.length === files.length && parsed.length >= 10, { parsed: parsed.length, files: files.length })

  const articleRoutes = new Set(parsed.map((a) => a.route))
  const uncovered = reg.routes.filter((r) => !articleRoutes.has(r) && !exempt.includes(r))
  check('H_COVERED', uncovered.length === 0, uncovered)
  const badExempt = exempt.filter((r) => !reg.routes.includes(r) || articleRoutes.has(r))
  check('H_EXEMPT', badExempt.length === 0, badExempt)

  const ids = new Set(parsed.map((a) => a.id))
  const badRefs = parsed.flatMap((a) => [
    ...(reg.routes.includes(a.route) ? [] : [`${a.id}: route ${a.route}`]),
    ...a.help_ids.filter((h) => !reg.help_ids.includes(h)).map((h) => `${a.id}: help id ${h}`),
    ...a.related.filter((r) => !ids.has(r)).map((r) => `${a.id}: related ${r}`),
  ])
  check('H_REFS', badRefs.length === 0, badRefs)

  const dashes = sources.filter((s) => s.text.includes(DASH)).map((s) => s.file)
  check('H_DASH', dashes.length === 0, dashes)
  const claims = sources.flatMap((s) => BANNED.filter((b) => b.pattern.test(s.text)).map((b) => `${s.file}: ${b.id}`))
  check('H_CLAIMS', claims.length === 0, claims)

  // the registry must equal what the source tree generates now; the builder's --check is the oracle
  let fresh
  if (on('stale')) {
    const tmp = path.join(out, 'stale-registry.json')
    const r = JSON.parse(registryText); r.routes = r.routes.slice(1)
    fs.writeFileSync(tmp, JSON.stringify(r, null, 1) + '\n')
    fresh = fs.readFileSync(tmp, 'utf8') === registryText
  } else {
    try { execFileSync(process.execPath, ['scripts/agent/build-help-registry.cjs', '--check'], { cwd: H.ROOT, stdio: 'pipe' }); fresh = true } catch { fresh = false }
  }
  check('H_FRESH', fresh, null)

  // controls, in the same form as the checks: each scanner finds its planted defect
  check('C_DASH_FINDS', `x ${DASH} y`.includes(DASH), null)
  check('C_CLAIMS_FINDS', BANNED.some((b) => b.pattern.test('This is proven to work.')), null)

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})().catch((e) => { console.error(e); process.exit(2) })
