// node scripts/resources/plan-check.mjs
// Checks the Send resources pure rules (src/lib/resources/plan.ts): the 20 MB split
// (largest attached file moves to a link while the total is over) and the email text.
import { splitFiles, emailBodies, ATTACH_LIMIT_BYTES } from '../../src/lib/resources/plan.ts'

const MB = 1024 * 1024
const f = (id, mb) => ({ id, name: id, size_bytes: Math.round(mb * MB) })
const cases = [
  ['all small files attach', [f('a', 1), f('b', 2)], ['a', 'b'], []],
  ['exactly 20 MB attaches', [f('a', 10), f('b', 10)], ['a', 'b'], []],
  ['just over moves the largest', [f('a', 10), f('b', 10.5)], ['a'], ['b']],
  ['several large: largest first until under', [f('a', 15), f('b', 12), f('c', 9)], ['c'], ['a', 'b']],
  ['a single 45 MB file is linked', [f('a', 45)], [], ['a']],
  ['ties: the later file moves', [f('a', 15), f('b', 15)], ['a'], ['b']],
  ['order is kept in both lists', [f('x', 1), f('y', 25), f('z', 2)], ['x', 'z'], ['y']],
  ['empty list', [], [], []],
]
let fail = 0
for (const [name, files, wantA, wantL] of cases) {
  const got = splitFiles(files)
  const a = got.attached.map(x => x.id).join(','), l = got.linked.map(x => x.id).join(',')
  const total = got.attached.reduce((n, x) => n + x.size_bytes, 0)
  if (a !== wantA.join(',') || l !== wantL.join(',') || total > ATTACH_LIMIT_BYTES) {
    fail++; console.log(`FAIL ${name}: want ${wantA}|${wantL} got ${a}|${l}`)
  }
}
const exp = new Date('2026-11-10T15:00:00Z')
const plain = emailBodies('Hello <there>', [], exp)
if (plain.text !== 'Hello <there>\n' || !plain.html.includes('Hello &lt;there&gt;')) { fail++; console.log('FAIL plain body') }
const pre = emailBodies('Hi', [{ name: 'Big guide' }], exp)
if (!pre.text.includes('Big guide: [download link]') || !pre.text.includes('November 10, 2026') || !pre.text.includes('One file was')) { fail++; console.log('FAIL preview links') }
const real = emailBodies('Hi', [{ name: 'A & B', url: 'https://x/y?token=1&b=2' }, { name: 'C', url: 'https://x/c' }], exp)
if (!real.html.includes('href="https://x/y?token=1&amp;b=2"') || !real.html.includes('A &amp; B') || !real.text.includes('Some files were')) { fail++; console.log('FAIL real links') }
const total = cases.length + 3
console.log(fail ? `plan-check FAIL ${fail}/${total}` : `plan-check PASS ${total}/${total}`)
process.exit(fail ? 1 : 0)
