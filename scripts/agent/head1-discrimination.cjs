#!/usr/bin/env node
// scripts/agent/head1-discrimination.cjs   (test h: every agent harness fails when the work is reverted)
//
// Checks out REF (default HEAD~1, which after the merge is main without this build) into a
// temporary git worktree, copies in the CURRENT harnesses, and runs each one untampered against
// that older tree. Every one must fail. A harness that passes there is not testing this build.
// Packages resolve from this checkout through NODE_PATH, so the worktree needs no node_modules
// and nothing is linked into it (removing the worktree cannot reach this repo's files).
//
// It reports HOW each failed, because the two kinds mean different things:
//   red    the harness ran and its assertions failed: it discriminates on behaviour
//   absent the harness could not load the code it tests, because that code did not exist yet
// Both are failures; "absent" is the expected result for a module this build created.
//
//   REF=<commit> node scripts/agent/head1-discrimination.cjs
const fs = require('fs'), path = require('path'), os = require('os')
const { execFileSync, spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const REF = process.env.REF || 'HEAD~1'
const HARNESSES = ['claims-tamper', 'validator-parity', 'golden-goals', 'adversarial-tamper', 'contract-tamper', 'caps-tamper',
  'leak-tamper', 'flag-off-parity', 'guide-tamper', 'help-ci'].map((n) => `scripts/agent/${n}.cjs`)

const git = (args, cwd = ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const sha = git(['rev-parse', REF])
const head = git(['rev-parse', 'HEAD'])
if (sha === head) { console.error(`REF ${REF} is HEAD itself; nothing would be reverted`); process.exit(2) }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-head1-'))
fs.rmSync(dir, { recursive: true, force: true })
git(['worktree', 'add', '--detach', dir, sha])
let fail = 0
try {
  // the harnesses under test are today's; the code they test is REF's
  fs.cpSync(path.join(ROOT, 'scripts', 'agent'), path.join(dir, 'scripts', 'agent'), { recursive: true })
  const env = { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules'), TAMPER: '' }
  console.log(`REF ${REF} = ${sha.slice(0, 7)}; HEAD = ${head.slice(0, 7)}`)
  // control: the same copied harnesses pass against HEAD's tree, so a failure below is about REF
  for (const h of HARNESSES) {
    const here = spawnSync(process.execPath, [h], { cwd: ROOT, env, encoding: 'utf8' })
    const r = spawnSync(process.execPath, [h], { cwd: dir, env, encoding: 'utf8' })
    const out = `${r.stdout || ''}${r.stderr || ''}`
    const kind = r.status === 0 ? 'PASSED' : /^RED /m.test(out) ? 'red' : 'absent'
    const reds = (out.match(/^RED\s+(\S+)/gm) || []).map((l) => l.split(/\s+/)[1])
    const ok = here.status === 0 && r.status !== 0
    if (!ok) fail++
    const why = kind === 'red' ? `red {${reds.join(',')}}` : kind === 'absent' ? `absent: ${(out.match(/(Cannot find module|ENOENT|dead anchor)[^\n]*/) || ['exit ' + r.status])[0].slice(0, 110)}` : 'PASSED AGAINST THE OLD TREE'
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${path.basename(h)}  HEAD exit ${here.status}, ${REF} exit ${r.status}  ${why}`)
  }
} finally {
  git(['worktree', 'remove', '--force', dir])
}
console.log(fail ? `\nhead1 discrimination FAILED: ${fail}` : `\nhead1 discrimination PASSED: all ${HARNESSES.length} pass on HEAD and fail on ${REF}`)
process.exit(fail ? 1 : 0)
