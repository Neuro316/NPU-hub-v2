#!/usr/bin/env node
// scripts/click-to-call/parity.cjs
//
// Proves existing call handling and Conversations behavior are unchanged by the
// click-to-call build (hardening e). Compared against PARITY_BASE, the commit the
// build branched from (main at d49d00e), read with `git show`, so the comparison
// cannot drift as main moves.
//
//   UNTOUCHED  byte-for-byte equal to the base (line endings normalised): every existing
//              voice webhook, the browser call token, the Twilio and org libraries, the
//              notify path, the entry event raiser, the auth wrapper and the middleware.
//   MARKED     equal to the base once the lines between CLICK-TO-CALL-BEGIN and
//              CLICK-TO-CALL-END are removed: the Conversations page (the button beside
//              the name) and the timeline ("Not connected" on a failed call).
//
// With the flag off the only visible change is a disabled phone icon whose tooltip
// says click-to-call is turned off; nothing else on the page or in any call path moves.
//
// SINCE_C2C  byte-for-byte equal to the click-to-call merge (d3be328): the line picker
//            touches only the button, the route and the click-to-call libraries, so the
//            Conversations page, the timeline and both Twilio webhooks must not move.
//
// TAMPER=outside   change one character outside a marked block      {M_conversations}
// TAMPER=untouched change one character of ring-complete             {U_ring-complete}
// TAMPER=webhook   change one character of the bridge webhook        {C_bridge}
// TAMPER=1         all three, union
// Exit: 0 green or declared set; 1 undeclared red; 2 unknown selector / git failure; 3 set mismatch.
const { execFileSync } = require('child_process')
const fs = require('fs'), path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const BASE = process.env.PARITY_BASE || 'd49d00e'
const UNTOUCHED = {
  'inbound-call': 'src/app/api/twilio/inbound-call/route.ts',
  'ring-complete': 'src/app/api/twilio/ring-complete/route.ts',
  'call-status': 'src/app/api/twilio/call-status/route.ts',
  'recording-ready': 'src/app/api/twilio/recording-ready/route.ts',
  'transcription': 'src/app/api/twilio/transcription/route.ts',
  'inbound-sms': 'src/app/api/twilio/inbound-sms/route.ts',
  'voice-token': 'src/app/api/voice/token/route.ts',
  'sms-send': 'src/app/api/sms/send/route.ts',
  'twilio': 'src/lib/twilio.ts',
  'twilio-org': 'src/lib/twilio-org.ts',
  'voice-signature': 'src/lib/twilio-voice-signature.ts',
  'inbound-voice': 'src/lib/inbound-voice.ts',
  'notify-sms': 'src/lib/notify-sms.ts',
  'crm-server': 'src/lib/crm-server.ts',
  'entry-events': 'src/lib/marketing/entry-events.ts',
  'marketing-flags': 'src/lib/marketing/flags.ts',
  'api-guard': 'src/lib/api-guard.ts',
  'middleware': 'src/middleware.ts',
  'supabase-middleware': 'src/lib/supabase-middleware.ts',
  'twilio-comms': 'src/components/crm/twilio-comms.tsx',
}
const C2C_BASE = process.env.C2C_BASE || 'd3be328'
const SINCE_C2C = {
  'conversations': 'src/app/(dashboard)/crm/conversations/page.tsx',
  'timeline': 'src/components/crm/comms-timeline.tsx',
  'bridge': 'src/app/api/twilio/click-to-call/bridge/route.ts',
  'status': 'src/app/api/twilio/click-to-call/status/route.ts',
  'webhook': 'src/lib/click-to-call/webhook.ts',
  'verify': 'src/lib/click-to-call/verify.ts',
  'signature': 'src/lib/click-to-call/signature.ts',
}
const MARKED = {
  'conversations': 'src/app/(dashboard)/crm/conversations/page.tsx',
  'timeline': 'src/components/crm/comms-timeline.tsx',
}
const RED_OF = { outside: ['M_conversations'], untouched: ['U_ring-complete'], webhook: ['C_bridge'] }
const sel = process.env.TAMPER || ''
const active = sel === '1' ? Object.keys(RED_OF) : sel ? sel.split(',') : []
for (const t of active) if (!RED_OF[t]) { console.error(`unknown selector ${t}`); process.exit(2) }

const norm = (s) => s.replace(/\r\n/g, '\n')
const base = (f, ref = BASE) => {
  try { return norm(execFileSync('git', ['show', `${ref}:${f}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) }
  catch (e) { console.error(`git show ${ref}:${f} failed (is the history fetched?)`); process.exit(2) }
}
const work = (f) => norm(fs.readFileSync(path.join(ROOT, f), 'utf8'))
const stripMarked = (s) => {
  const out = []; let inside = false; let blocks = 0
  for (const line of s.split('\n')) {
    if (line.includes('CLICK-TO-CALL-BEGIN')) { inside = true; blocks++; continue }
    if (line.includes('CLICK-TO-CALL-END')) { inside = false; continue }
    if (!inside) out.push(line)
  }
  return { text: out.join('\n'), blocks, unclosed: inside }
}
const swap = (s, from, to) => { if (!s.includes(from)) { console.error(`dead anchor: ${from}`); process.exit(2) } return s.replace(from, to) }

const rows = []
for (const [k, f] of Object.entries(UNTOUCHED)) {
  let now = work(f)
  if (active.includes('untouched') && k === 'ring-complete') now = swap(now, "row.direction !== 'inbound'", "row.direction !== 'inbounds'")
  const same = now === base(f)
  rows.push({ id: `U_${k}`, ok: same, got: same ? 'identical' : 'differs from base' })
}
for (const [k, f] of Object.entries(MARKED)) {
  let now = work(f)
  if (active.includes('outside') && k === 'conversations') now = swap(now, '.limit(100)', '.limit(101)')
  const s = stripMarked(now)
  const same = s.text === base(f)
  rows.push({ id: `M_${k}`, ok: same && s.blocks > 0 && !s.unclosed, got: `${s.blocks} marked block(s)${s.unclosed ? ', unclosed' : ''}, ${same ? 'identical outside them' : 'differs outside them'}` })
}
for (const [k, f] of Object.entries(SINCE_C2C)) {
  let now = work(f)
  if (active.includes('webhook') && k === 'bridge') now = swap(now, "searchParams.get('step')", "searchParams.get('stepx')")
  const same = now === base(f, C2C_BASE)
  rows.push({ id: `C_${k}`, ok: same, got: same ? `identical to ${C2C_BASE}` : `differs from ${C2C_BASE}` })
}

const red = rows.filter((r) => !r.ok).map((r) => r.id).sort()
for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'RED '} ${r.id}  ${r.got}`)
if (!active.length) {
  console.log(red.length ? `FAIL: ${red.length} red of ${rows.length}` : `PASS: ${rows.length} of ${rows.length}`)
  process.exit(red.length ? 1 : 0)
}
const want = Array.from(new Set(active.flatMap((t) => RED_OF[t]))).sort()
console.log(`red {${red.join(',')}}, declared {${want.join(',')}}`)
if (red.length === 0) { console.error('FATAL: a TAMPERED run PASSED.'); process.exit(3) }
if (JSON.stringify(red) !== JSON.stringify(want)) { console.error('FATAL: tampered red SET does not match the declaration.'); process.exit(3) }
process.exit(0)
