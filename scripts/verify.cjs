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
  return { code: r.status, signal: r.signal, error: r.error ? String(r.error.message || r.error) : null, out: `${r.stdout || ''}${r.stderr || ''}` }
}
/** Why a child failed, always non-empty: exit code, signal (a kill, e.g. out of memory, sets status to null), and spawn error. */
const why = (r) => `exit code ${r.code === null ? 'none' : r.code}, signal ${r.signal || 'none'}${r.error ? `, spawn error ${r.error}` : ''}`
const HARNESSES = [
  { file: 'scripts/marketing/pure-tamper.cjs', selectors: ['flagson', 'placeholder', 'svixopen', 'redirect', 'nostop', 'onefail', 'unsubreq', 'noescape', 'stopmerged', 'connected', 'optout', 'nocap', '1'] },
  { file: 'scripts/marketing/entry-wiring-tamper.cjs', selectors: ['nocall', 'mergeorder', 'importoptin', 'nosummary', 'hardcoded', 'consent', 'cached', '1'] },
  { file: 'scripts/marketing/smart-list-tamper.cjs', selectors: ['emptyall', 'missingyes', 'unknownyes', 'anyall', 'nonepass', 'activity', 'consent', 'nocheck', '1'] },
  { file: 'scripts/marketing/activity-log-tamper.cjs', selectors: ['rawcols', 'refraw', 'actorraw', 'readold', 'orderold', 'keepbody', '1'] },
  { file: 'scripts/marketing/lead-device-tamper.cjs', selectors: ['testwrites', 'notest', 'noreplay', 'truthy', 'optout', 'noresult', 'secretopen', 'anypreview', 'sameorigin', 'connect', 'nonce', 'hotall', 'factsall', 'logname', 'overwrite', 'nofill', 'nocas', 'nosuppress', 'checkopen', 'nonote', 'noother', 'noidentity', 'retrytest', 'noclaim', 'purgesoon', '1'] },
  { file: 'scripts/marketing/pipeline-positions-tamper.cjs', selectors: ['loosename', 'guess', 'keeparch', 'orgopen', 'actorbody', 'removeall', 'nowarn', 'payfail', 'mirrorloop', 'mirrorall', 'nosignedup', 'viewopts', 'idcols', '1'] },
  { file: 'scripts/marketing/lead-origin-tamper.cjs', selectors: ['anyhost', 'hubhost', 'anypath', 'looseorg', 'keepcook', 'noapi', '1'] },
  { file: 'scripts/marketing/form-placement-tamper.cjs', selectors: ['noplace', 'existing', 'anyoutcome', 'fallback', '1'] },
  { file: 'scripts/marketing/lead-capture-tamper.cjs', selectors: ['anyorigin', 'nohoneypot', 'anysource', 'looseemail', 'loosephone', 'blankwins', 'rawlike', '1'] },
  { file: 'scripts/marketing/speed-to-lead-tamper.cjs', selectors: ['quietoff', 'urgentall', 'noescape', 'truthy', 'resend', 'logname', 'widen', 'noexit', 'placelive', '1'] },
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
  { file: 'scripts/click-to-call/parity.cjs', selectors: ['outside', 'untouched', 'webhook', '1'] },
  { file: 'scripts/org-settings/credentials-tamper.cjs', selectors: ['dropfield', 'noredact', 'rawread', 'bodyurl', '1'] },
  { file: 'scripts/settings/browser-writes-tamper.cjs', selectors: ['plantorg', 'plantteam', 'clientimport', 'weak', '1'] },
  { file: 'scripts/notify/notify-tamper.cjs', selectors: ['early', 'normaltext', 'holdurgent', 'twice', 'noowner', 'subject', 'sendpreview', 'allmail', 'closedbadge', '1'] },
  { file: 'scripts/notify/q34-tamper.cjs', selectors: ['appcount', 'stuckanyorg', 'cronback', 'noemail', '1'] },
  { file: 'scripts/resources/resource-tamper.cjs', selectors: ['retiredgo', 'wrongcontact', 'sends', 'openread', 'storeip', 'rawtime', '1'] },
  { file: 'scripts/mail/mail-search-tamper.cjs', selectors: ['otherowner', 'storesbody', 'bodyinlist', 'nosecretcheck', 'logsterms', 'hidesbroken', 'norate', '1'] },
  { file: 'scripts/mail/mail-token-tamper.cjs', selectors: ['vaultblip', 'transientbroken', 'grantignored', 'skiperror', 'wrongreason', 'emptytoken', '1'] },
  { file: 'scripts/marketing/test-drive-tamper.cjs', selectors: ['exitfortest', 'delayfortest', 'realskip', 'skipgate', 'norecord', 'hideended', '1'] },
  { file: 'scripts/marketing/gate-cap-tamper.cjs', selectors: ['capall', 'livetoo', 'anyone', 'otherchange', 'badrollback', '1'] },
  { file: 'scripts/crm/contact-fixes-tamper.cjs', selectors: ['olderwins', 'rawquery', 'oldcounts', 'countprivate', 'noswitch', 'ignoreid', '1'] },
  { file: 'scripts/comms/comms-tamper.cjs', selectors: ['privateopen', 'body', 'browserread', 'lifecycleall', 'nomerged', 'noalt', '1'] },
  { file: 'scripts/lifecycle/lifecycle-tamper.cjs', selectors: ['liveany', 'leadnostage', 'tagover', 'phasemix', 'backward', 'coachbuys', 'closeall', 'early', 'idle4', 'dryapply', '1'] },
]
let fail = 0
const report = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) fail++ }

// a 4 GB heap for the type check wherever verify runs (CI and local): tsc has died silently in CI (Running List q28)
const tsc = run(process.execPath, ['--max-old-space-size=4096', path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'])
// a non-zero exit OR a kill (status null, e.g. out of memory) fails, and always says which, so a silent death is visible
report(tsc.code === 0, `tsc --noEmit${tsc.code !== 0 ? ` (${why(tsc)})\n${tsc.out.slice(0, 2000) || '(no output)'}` : ''}`)

// the agent's bundled copies of the voice guide and the help articles must match their sources
const gen = run(process.execPath, ['scripts/agent/gen-content.cjs', '--check'])
report(gen.code === 0, `generated agent content is current${gen.code ? `\n${gen.out.slice(0, 500)}` : ''}`)

// the Growth Dashboard's pure rules (targets both ways, product lines, coaching load, work back)
const mc = run(process.execPath, ['scripts/metrics/metrics-check.cjs'])
report(mc.code === 0, `metrics-check${mc.code ? `\n${mc.out.split('\n').filter((l) => /FAIL|Error/.test(l)).join('\n').slice(0, 1500)}` : ''}`)

const g = run(process.execPath, ['scripts/guards/run-guards.cjs'])
report(g.code === 0, `guards${g.code ? `\n${g.out.split('\n').filter((l) => /FAIL|NEW|RED/.test(l)).join('\n')}` : ''}`)
for (const t of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']) {
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
