#!/usr/bin/env node
// scripts/marketing/flags-off-parity.cjs
//
// Proves the existing send paths are unchanged by the marketing build (hardening f).
// Compared against PARITY_BASE, the commit the build branched from (main at 3492d97),
// read with `git show`, so the comparison cannot drift as main moves.
//
//   UNTOUCHED  byte-for-byte equal to the base (line endings normalised): the stage
//              email route, the sms-outbox cron and its two libraries, sequence enroll.
//   MARKED     equal to the base once the lines between HUB-MARKETING-BEGIN and
//              HUB-MARKETING-END are removed: every change to these files is inside a
//              marked block, and nothing outside one moved.
//
// What the marked blocks do with every flag off: process-step skips enrollments that
// carry a campaign_enrollment_id (none can exist while the engine flag is off, because
// enroll() refuses), and inbound-sms additionally records STOP and START in the consent
// ledger, after its existing writes, logging and never throwing on error.
//
// TAMPER=outside   change one character outside a marked block      {M_process-step}
// TAMPER=untouched change one character of the stage email route     {U_stage-emails}
// TAMPER=1         both, union of the two
// Exit: 0 green or declared set; 1 undeclared red; 2 unknown selector / git failure; 3 set mismatch.
const { execFileSync } = require('child_process')
const fs = require('fs'), path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const BASE = process.env.PARITY_BASE || '3492d97'
const UNTOUCHED = {
  'stage-emails': 'src/app/api/crm/stage-emails/route.ts',
  'sms-outbox-cron': 'src/app/api/cron/sms-outbox/route.ts',
  'notify-sms': 'src/lib/notify-sms.ts',
  'sms-outbox-lib': 'src/lib/sms-outbox.ts',
  'sequence-enroll': 'src/app/api/sequences/enroll/route.ts',
}
const MARKED = {
  'process-step': 'src/app/api/sequences/process-step/route.ts',
  'inbound-sms': 'src/app/api/twilio/inbound-sms/route.ts',
}
const RED_OF = { outside: ['M_process-step'], untouched: ['U_stage-emails'] }
const sel = process.env.TAMPER || ''
const active = sel === '1' ? Object.keys(RED_OF) : sel ? sel.split(',') : []
for (const t of active) if (!RED_OF[t]) { console.error(`unknown selector ${t}`); process.exit(2) }

const norm = (s) => s.replace(/\r\n/g, '\n')
const base = (f) => {
  try { return norm(execFileSync('git', ['show', `${BASE}:${f}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) }
  catch (e) { console.error(`git show ${BASE}:${f} failed (is the history fetched?)`); process.exit(2) }
}
const work = (f) => norm(fs.readFileSync(path.join(ROOT, f), 'utf8'))
const stripMarked = (s) => {
  const out = []; let inside = false; let blocks = 0
  for (const line of s.split('\n')) {
    if (line.includes('HUB-MARKETING-BEGIN')) { inside = true; blocks++; continue }
    if (line.includes('HUB-MARKETING-END')) { inside = false; continue }
    if (!inside) out.push(line)
  }
  return { text: out.join('\n'), blocks, unclosed: inside }
}

const rows = []
for (const [k, f] of Object.entries(UNTOUCHED)) {
  let now = work(f)
  if (active.includes('untouched') && k === 'stage-emails') now = now.replace('STALE_CLAIM_MINUTES = 15', 'STALE_CLAIM_MINUTES = 16')
  rows.push({ id: `U_${k}`, ok: now === base(f), got: now === base(f) ? 'identical' : 'differs from base' })
}
for (const [k, f] of Object.entries(MARKED)) {
  let now = work(f)
  if (active.includes('outside') && k === 'process-step') now = now.replace(".limit(50);", ".limit(51);")
  const s = stripMarked(now)
  const same = s.text === base(f)
  rows.push({ id: `M_${k}`, ok: same && s.blocks > 0 && !s.unclosed, got: `${same ? 'identical outside marked blocks' : 'differs outside marked blocks'}, blocks=${s.blocks}` })
}
// control: the comparison must be able to see a difference at all
const control = stripMarked(work(MARKED['inbound-sms'])).text !== work(MARKED['inbound-sms'])
rows.push({ id: 'C_markers_present', ok: control, got: control ? 'marked lines exist and are removed' : 'nothing marked' })

const red = rows.filter((r) => !r.ok).map((r) => r.id).sort()
for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'RED '} ${r.id}  ${r.got}`)
if (!active.length) { console.log(red.length ? `FAIL: ${red.length} red` : `PASS: ${rows.length} of ${rows.length} against ${BASE}`); process.exit(red.length ? 1 : 0) }
const want = Array.from(new Set(active.flatMap((t) => RED_OF[t]))).sort()
console.log(`red {${red.join(',')}}, declared {${want.join(',')}}`)
if (!red.length) { console.error('FATAL: a TAMPERED run PASSED.'); process.exit(3) }
if (JSON.stringify(red) !== JSON.stringify(want)) { console.error('FATAL: tampered red SET does not match the declaration.'); process.exit(3) }
process.exit(0)
