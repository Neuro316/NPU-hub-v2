#!/usr/bin/env node
// scripts/verify.cjs  (npm run verify; also what .github/workflows/verify.yml runs)
//
// Runs the type check, the guards and every pure harness, untampered and with each
// tamper selector. A run passes only when:
//   untampered      exits 0
//   each selector   exits 0 AND printed its "red {...}, declared {...}" line (a crash
//                   also exits non-zero or prints nothing; the line is what proves the
//                   harness reached its own report)
//   guard tampers   exit 3 (the guard's self-test caught that it was disabled)
// Needs no secrets and no network. About 30 seconds, most of it the type check.
const { spawnSync } = require('child_process')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')

const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', shell: false })
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}
const HARNESSES = [
  { file: 'scripts/marketing/pure-tamper.cjs', selectors: ['flagson', 'placeholder', 'svixopen', 'redirect', 'nostop', 'onefail', 'unsubreq', 'noescape', 'stopmerged', 'connected', 'optout', '1'] },
  { file: 'scripts/marketing/flags-off-parity.cjs', selectors: ['outside', 'untouched', '1'] },
]
let fail = 0
const report = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) fail++ }

const tsc = run(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'])
report(tsc.code === 0, `tsc --noEmit${tsc.code ? `\n${tsc.out.slice(0, 2000)}` : ''}`)

const g = run(process.execPath, ['scripts/guards/run-guards.cjs'])
report(g.code === 0, `guards${g.code ? `\n${g.out.split('\n').filter((l) => /FAIL|NEW|RED/.test(l)).join('\n')}` : ''}`)
for (const t of ['G1', 'G2', 'G3', 'G4', 'G5']) {
  const r = run(process.execPath, ['scripts/guards/run-guards.cjs'], { TAMPER: t })
  report(r.code === 3, `guards TAMPER=${t} must exit 3 (got ${r.code})`)
}
for (const h of HARNESSES) {
  const u = run(process.execPath, [h.file])
  report(u.code === 0, `${h.file} untampered${u.code ? ` exit ${u.code}\n${u.out.slice(-1500)}` : ''}`)
  for (const s of h.selectors) {
    const r = run(process.execPath, [h.file], { TAMPER: s })
    const line = (r.out.match(/red \{[^}]*\}, declared \{[^}]*\}/) || [])[0]
    report(r.code === 0 && !!line, `${h.file} TAMPER=${s} ${line ?? `NO RED-SET LINE, exit ${r.code}`}`)
  }
}
console.log(fail ? `\nverify FAILED: ${fail}` : '\nverify PASSED')
process.exit(fail ? 1 : 0)
