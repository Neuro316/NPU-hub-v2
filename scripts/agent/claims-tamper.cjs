#!/usr/bin/env node
// scripts/agent/claims-tamper.cjs
//
// The claims checker every agent-drafted message passes (src/lib/agent/claims.ts),
// and that it agrees with docs/marketing/voice-and-claims-guide.md. Compiles the REAL
// source into this run's own temp directory. No network, no database.
//
// TAMPER=<selector> plants one defect and the run must redden EXACTLY the declared set:
//   emdash      the em dash check is switched off                  {E1,E2}
//   certified   "certified" leaves the banned list                 {B2,G2}
//   noboundary  the treatment pattern loses its word boundary      {B4}
//   stopline    SMS length forgets the opt out line                {L2}
//   program     a wrong program name is accepted                   {P1}
//   version     the checker's guide version drifts from the guide  {G1}
// TAMPER=1 runs every selector at once and must redden the union.
// Exit: 0 green, or the declared set reddened; 1 an undeclared red; 2 unknown selector
// or a dead anchor; 3 a tampered run whose red set is not the declaration.
const fs = require('fs'), path = require('path'), os = require('os'), Module = require('module')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src')
const GUIDE = path.join(ROOT, 'docs', 'marketing', 'voice-and-claims-guide.md')
const MODULES = ['lib/agent/claims.ts', 'lib/marketing/render.ts', 'lib/crm-server.ts', 'lib/phone.ts', 'lib/sms-split.ts']

const TAMPERS = {
  emdash: [['lib/agent/claims.ts', 'if (EM_DASH.test(subject) || EM_DASH.test(i.body))', 'if (false)']],
  certified: [['lib/agent/claims.ts', "  { id: 'certified', pattern: /\\bcertif(?:y|ies|ied|ying|ication|ications|icate|icates)\\b/i, why: 'Training courses never certify anyone.' },\n", '']],
  noboundary: [['lib/agent/claims.ts', '/\\b(?:treat|treats', '/(?:treat|treats']],
  stopline: [['lib/agent/claims.ts', "(i.kind === 'marketing' ? SMS_STOP_LINE.length + 1 : 0)", '0']],
  program: [['lib/agent/claims.ts', 'if (m !== PROGRAM_NAME)', 'if (false)']],
  version: [['lib/agent/claims.ts', "export const GUIDE_VERSION = '2026-10-01.1'", "export const GUIDE_VERSION = '2026-09-30.9'"]],
}
const RED_OF = { emdash: ['E1', 'E2'], certified: ['B2', 'G2'], noboundary: ['B4'], stopline: ['L2'], program: ['P1'], version: ['G1'] }

const sel = process.env.TAMPER || ''
const active = sel === '1' ? Object.keys(TAMPERS) : sel ? sel.split(',') : []
for (const t of active) if (!TAMPERS[t]) { console.error(`unknown selector ${t}`); process.exit(2) }

// compile into THIS run's own directory (never a fixed path: verify may run in parallel)
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-claims-'))
const used = new Set()
for (const rel of MODULES) {
  let src = fs.readFileSync(path.join(SRC, rel), 'utf8')
  for (const t of active) for (const [file, from, to] of TAMPERS[t]) {
    if (file !== rel) continue
    if (!src.includes(from)) { console.error(`dead anchor: ${t} in ${file}`); process.exit(2) }
    src = src.split(from).join(to)
    used.add(t)
  }
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  const dest = path.join(out, rel.replace(/\.ts$/, '.js'))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, js)
}
for (const t of active) if (!used.has(t)) { console.error(`dead anchor: ${t} matched no module`); process.exit(2) }
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, parent, ...rest) {
  if (req.startsWith('@/')) req = path.join(out, req.slice(2))
  return origResolve.call(this, req, parent, ...rest)
}
const C = require(path.join(out, 'lib/agent/claims.js'))

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
const EM_DASH = String.fromCharCode(0x2014)
const ids = (r) => r.issues.map((x) => x.id)
const sms = (body, kind = 'marketing') => C.checkClaims({ channel: 'sms', kind, body })
const email = (subject, body, kind = 'marketing') => C.checkClaims({ channel: 'email', kind, subject, body })

// em dash, as a character and as an HTML entity
const e1 = sms(`Hi {{first_name}}, the guide is ready ${EM_DASH} open it when you have a minute.`)
check('E1', ids(e1).includes('em_dash'), ids(e1))
const e2 = email('Your guide', '<p>Here it is &mdash; enjoy.</p>')
check('E2', ids(e2).includes('em_dash'), ids(e2))

// banned phrases
check('B1', ids(sms('Fewer meltdowns this week.')).includes('meltdown'), ids(sms('Fewer meltdowns this week.')))
check('B2', ids(email('You are certified', '<p>Well done.</p>')).includes('certified'), ids(email('You are certified', '<p>Well done.</p>')))
check('B3', ids(sms('This treatment helps.')).includes('treatment'), ids(sms('This treatment helps.')))
// the control: realistic clean copy containing near misses must raise NOTHING
const clean = email('Your HRV guide is here',
  '<p>Hi {{first_name}}, thank you for asking for the guide. It is a healthy, secure place to start, and it reads well on a quiet retreat weekend. '
  + 'Your HRV is a mirror of your state, and the Consistent Performance Protocol trains capacity at a fixed time each day. '
  + 'By the end of this week, name three moments you noticed your reactions shift.</p>')
check('B4', clean.ok && clean.issues.length === 0, ids(clean))
check('M1', ids(sms('You could stop taking your medication.')).includes('medical_advice'), ids(sms('You could stop taking your medication.')))
check('H1', ids(sms('Watch your HRV score climb.')).includes('hrv_score'), ids(sms('Watch your HRV score climb.')))
check('O1', ids(sms('Results guaranteed.')).includes('guarantee') && ids(sms('This will fix your sleep.')).includes('will_outcome'), [ids(sms('Results guaranteed.')), ids(sms('This will fix your sleep.'))])

// program name
const p1 = sms('Join the Consistent Performance Program today.')
check('P1', ids(p1).includes('program_name'), ids(p1))
check('P2', !ids(sms('Join the Consistent Performance Protocol today.')).includes('program_name'), ids(sms('Join the Consistent Performance Protocol today.')))

// SMS length: a body that fits only when the opt out line is NOT counted
const room = C.SMS_MAX - C.SMS_MERGE_ALLOWANCE
const body = 'a'.repeat(room - 5)
check('L1', !ids(sms('Short and clear.')).includes('sms_length'), ids(sms('Short and clear.')))
check('L2', ids(sms(body, 'marketing')).includes('sms_length') && !ids(sms(body, 'service')).includes('sms_length'),
  [ids(sms(body, 'marketing')), ids(sms(body, 'service'))])

// subjects
check('S1', ids(email('', '<p>Hello.</p>')).includes('subject_missing'), ids(email('', '<p>Hello.</p>')))
check('S2', ids(email('x'.repeat(C.SUBJECT_MAX + 1), '<p>Hello.</p>')).includes('subject_length') && !ids(email('x'.repeat(C.SUBJECT_MAX), '<p>Hello.</p>')).includes('subject_length'), null)

// the guide and the checker agree
const guide = fs.readFileSync(GUIDE, 'utf8')
const gv = (guide.match(/\*\*Version: ([^*]+)\*\*/) || [])[1]
check('G1', gv === C.GUIDE_VERSION, { guide: gv, checker: C.GUIDE_VERSION })
const guideIds = Array.from(guide.matchAll(/^\| `([a-z_]+)` \|/gm)).map((m) => m[1]).sort()
const codeIds = C.BANNED.map((b) => b.id).sort()
check('G2', JSON.stringify(guideIds) === JSON.stringify(codeIds), { guide: guideIds, checker: codeIds })
check('G3', !guide.includes(EM_DASH), 'an em dash in the guide')
// the checker's own source: a file tool once turned its unicode escape into the literal character
check('G4', !fs.readFileSync(path.join(SRC, 'lib/agent/claims.ts'), 'utf8').includes(EM_DASH), 'an em dash in claims.ts')

fs.rmSync(out, { recursive: true, force: true })
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
