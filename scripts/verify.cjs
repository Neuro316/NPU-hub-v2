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
  { file: 'scripts/marketing/pure-tamper.cjs', selectors: ['flagson', 'placeholder', 'svixopen', 'redirect', 'nostop', 'onefail', 'unsubreq', 'noescape', 'stopmerged', 'connected', 'optout', 'nocap', '1'] },
  { file: 'scripts/marketing/entry-wiring-tamper.cjs', selectors: ['nocall', 'mergeorder', 'importoptin', 'nosummary', 'hardcoded', 'consent', 'cached', '1'] },
  { file: 'scripts/marketing/flags-off-parity.cjs', selectors: ['outside', 'untouched', '1'] },
  { file: 'scripts/agent/claims-tamper.cjs', selectors: ['emdash', 'certified', 'noboundary', 'stopline', 'program', 'version', '1'] },
  { file: 'scripts/agent/validator-parity.cjs', selectors: ['message', 'delay', 'lower', 'slug', '1'] },
  { file: 'scripts/agent/golden-goals.cjs', selectors: ['noresolve', 'connectedany', 'nosms', 'nosender', 'noconsent', 'noclaims', '1'] },
  { file: 'scripts/agent/adversarial-tamper.cjs', selectors: ['sendtool', 'unknowntool', 'livefield', 'nowrap', 'reqdata', 'formsrc', '1'] },
  { file: 'scripts/agent/contract-tamper.cjs', selectors: ['channel', 'taskkind', 'block', '1'] },
  { file: 'scripts/agent/caps-tamper.cjs', selectors: ['nostep', 'nocap', 'session', 'rate', 'cheap', 'rawmicros', '1'] },
  { file: 'scripts/agent/leak-tamper.cjs', selectors: ['star', 'passthrough', 'noscrub', 'colleak', '1'] },
  { file: 'scripts/agent/flag-off-parity.cjs', selectors: ['noflag', 'nosuper', 'touch', '1'] },
  { file: 'scripts/agent/guide-tamper.cjs', selectors: ['nocite', 'anytarget', 'anyroute', 'noflag', 'nogap', 'leakctx', 'dash', 'writetask', 'policyopen', 'stubprod', 'anytag', 'clickme', '1'] },
  { file: 'scripts/agent/scope-tamper.cjs', selectors: ['approveorg', 'steporg', 'taskorg', 'pagesorg', 'pubdraft', 'pubflag', 'pubform', 'noreview', 'nocaller', '1'] },
  { file: 'scripts/agent/task-notify-tamper.cjs', selectors: ['importsms', 'deep', 'directtask', '1'] },
  { file: 'scripts/agent/review-gates-tamper.cjs', selectors: ['noguard', 'failopen', 'positional', 'nohash', 'editkeeps', '1'] },
  { file: 'scripts/agent/org-keys-tamper.cjs', selectors: ['lookuporg', 'status400', 'enrollseq', 'enrollwho', '1'] },
  { file: 'scripts/agent/shell-panel-tamper.cjs', selectors: ['unmount', 'secondpanel', 'resetkeeps', 'typedq', 'noclear', 'nosidebar', 'keepprev', 'capsflag', 'hidealways', 'launcherpos', 'builderguide', '1'] },
  { file: 'scripts/agent/help-ci.cjs', selectors: ['orphan', 'ghost', 'badref', 'dash', 'banned', 'stale', '1'] },
  { file: 'scripts/click-to-call/c2c-tamper.cjs', selectors: ['wrongorg', 'nophone', 'suppressed', 'dnclist', 'nostaffphone', 'ratelimit', 'flagoff', 'allowlistonly', 'notallowlisted', 'quiethoursblock', 'dialfirst', 'sigcore', 'sigbridge', 'sigstatus', 'staleswitch', 'entryevent', 'inboundroute', 'directionin', 'recording', 'forgedline', 'inactiveline', 'novoice', 'defaultshift', 'storagecrash', 'singleselect', 'rawline', 'eligibleorg', 'unverified', '1'] },
  { file: 'scripts/click-to-call/dialer-hangup-tamper.cjs', selectors: ['nohangup', 'noearly', 'notoken', 'nodestroy', 'nomute', 'nodigits', 'unwired', '1'] },
  { file: 'scripts/click-to-call/parity.cjs', selectors: ['outside', 'untouched', 'webhook', '1'] },
]
let fail = 0
const report = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) fail++ }

const tsc = run(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'])
report(tsc.code === 0, `tsc --noEmit${tsc.code ? `\n${tsc.out.slice(0, 2000)}` : ''}`)

// the agent's bundled copies of the voice guide and the help articles must match their sources
const gen = run(process.execPath, ['scripts/agent/gen-content.cjs', '--check'])
report(gen.code === 0, `generated agent content is current${gen.code ? `\n${gen.out.slice(0, 500)}` : ''}`)

const g = run(process.execPath, ['scripts/guards/run-guards.cjs'])
report(g.code === 0, `guards${g.code ? `\n${g.out.split('\n').filter((l) => /FAIL|NEW|RED/.test(l)).join('\n')}` : ''}`)
for (const t of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']) {
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
