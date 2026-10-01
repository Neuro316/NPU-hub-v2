#!/usr/bin/env node
// scripts/click-to-call/c2c-tamper.cjs
//
// Hardening for click-to-call (docs/plans/hub-click-to-call-rulings.md). Compiles the
// REAL source with TypeScript's transpiler into this run's own temp directory and
// requires it; the route files are read as text for the static checks. No network,
// no database, no secrets. About 2 seconds.
//
//   A  route contract: the gate (decide) for wrong org, no contact phone, suppressed,
//      do-not-contact, no staff phone, rate limit, flag off, allowlist-only mode,
//      non-allowlisted refused, quiet hours warn but allow, and the route's order:
//      refuse before dialing, log before dialing, the body carries only the id.
//   S  signatures: the core check and verifyTwilioWebhook refuse a missing, wrong or
//      re-aimed signature; both webhooks verify before their first database call.
//   U  UI: switching the open conversation changes the dial target, and a late
//      preflight for the old thread is dropped.
//   E  no entry events: nothing raises one, nothing points Twilio at inbound-call or
//      ring-complete, the row is outbound, contacts are never written.
//   N  no recording anywhere in the new code or its TwiML.
//
// TAMPER=<selector> plants one defect; the run must redden EXACTLY the declared set:
//   wrongorg       the gate stops checking the caller's orgs              {A1}
//   nophone        a contact without a phone passes                        {A2}
//   suppressed     a suppressed number passes                              {A3}
//   dnclist        a do-not-contact list hit passes                        {A5}
//   nostaffphone   a caller without a profile phone passes                 {A6}
//   ratelimit      the 10 minute window is not enforced                    {A7}
//   flagoff        the enabled flag is ignored                             {A8}
//   allowlistonly  test mode refuses even allowlisted contacts             {A9}
//   notallowlisted test mode lets anyone through                           {A10}
//   quiethoursblock quiet hours block instead of warn                      {A11}
//   dialfirst      the route dials before it refuses                       {A15}
//   sigcore        the core check accepts any signature                    {S2,S5,V2,V4}
//   sigbridge      the bridge webhook stops refusing a bad signature       {S6}
//   sigstatus      the status webhook stops refusing a bad signature       {S7}
//   staleswitch    a late preflight for the old thread is accepted         {U1}
//   entryevent     the status webhook raises an entry event                {E1}
//   inboundroute   the bridge URL points at inbound-call                   {E2}
//   directionin    the call row is written as inbound                      {E3}
//   recording      the dial TwiML records                                  {N1}
// TAMPER=1 runs every selector at once and must redden the union.
// BASE=<git ref> reads every file from that ref; against the commit before this build
// (BASE=HEAD~1 on the feature commit) every case must be red.
// Exit: 0 green or exactly the declared set; 1 undeclared red; 2 unknown selector or dead
// anchor; 3 a tampered run whose red set is not the declaration.
const fs = require('fs'), path = require('path'), os = require('os'), Module = require('module')
const { execFileSync } = require('child_process')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const MODULES = ['src/lib/click-to-call/logic.ts', 'src/lib/click-to-call/signature.ts', 'src/lib/click-to-call/ui-logic.ts',
  'src/lib/click-to-call/verify.ts', 'src/lib/phone.ts']
const FILES = {
  route: 'src/app/api/comms/click-to-call/route.ts',
  bridge: 'src/app/api/twilio/click-to-call/bridge/route.ts',
  status: 'src/app/api/twilio/click-to-call/status/route.ts',
  server: 'src/lib/click-to-call/server.ts',
  webhook: 'src/lib/click-to-call/webhook.ts',
  button: 'src/components/crm/click-to-call-button.tsx',
}
const L = 'src/lib/click-to-call/logic.ts'
const TAMPERS = {
  wrongorg: [[L, 'if (!f.conversation || !f.callerOrgIds.includes(f.conversation.org_id)) {', 'if (!f.conversation) {']],
  nophone: [[L, "if (!contactPhone) return no('no_contact_phone'", "if (false) return no('no_contact_phone'"]],
  suppressed: [[L, "if (f.suppressed) return no(", "if (false) return no("]],
  dnclist: [[L, 'if (f.contact.do_not_contact || f.dncListHit) return', 'if (f.contact.do_not_contact) return']],
  nostaffphone: [[L, "if (!staffPhone) return no(", "if (false) return no("]],
  ratelimit: [[L, 'if (win.length >= RATE.perWindow) {', 'if (false) {']],
  flagoff: [[L, "if (!f.flags.enabled) return no(", "if (false) return no("]],
  allowlistonly: [[L, '  const rl = rateLimitProblem(f.attempts, f.now)', "  if (!f.flags.live) return no('flag_off', 403, 'Test mode refuses everyone.')\n  const rl = rateLimitProblem(f.attempts, f.now)"]],
  notallowlisted: [[L, "    return no('not_allowlisted', 403,", "    if (false) return no('not_allowlisted', 403,"]],
  quiethoursblock: [[L, '  if (rl) return no(', "  if (summary.quiet?.outside) return no('rate_limited', 403, 'quiet hours')\n  if (rl) return no("]],
  dialfirst: [[FILES.route, '  if (!d.ok) {', '  void createOrgTwilioClient(g.config!).calls.create({} as any)\n  if (!d.ok) {']],
  sigcore: [['src/lib/click-to-call/signature.ts', 'return validateRequest(authToken, signature, url, params)', 'return true']],
  sigbridge: [[FILES.bridge, "if (!verified) return new NextResponse('Forbidden', { status: 403 })", '']],
  sigstatus: [[FILES.status, "if (!verified) return new NextResponse('Forbidden', { status: 403 })", '']],
  staleswitch: [['src/lib/click-to-call/ui-logic.ts', '  if (state.forId !== forId) return state\n', '']],
  entryevent: [[FILES.status, "  const status = params.CallStatus || ''", "  await raiseEntryEvent(db, {} as any)\n  const status = params.CallStatus || ''"]],
  inboundroute: [[L, '/api/twilio/click-to-call/bridge?log=${id}`', '/api/twilio/inbound-call?log=${id}`']],
  directionin: [[FILES.route, "direction: 'outbound', status: 'ringing'", "direction: 'inbound', status: 'ringing'"]],
  recording: [[L, '<Dial callerId=', '<Dial record="record-from-answer-dual" callerId=']],
}
const RED_OF = {
  wrongorg: ['A1'], nophone: ['A2'], suppressed: ['A3'], dnclist: ['A5'], nostaffphone: ['A6'], ratelimit: ['A7'],
  flagoff: ['A8'], allowlistonly: ['A9'], notallowlisted: ['A10'], quiethoursblock: ['A11'], dialfirst: ['A15'],
  sigcore: ['S2', 'S5', 'V2', 'V4'], sigbridge: ['S6'], sigstatus: ['S7'], staleswitch: ['U1'], entryevent: ['E1'],
  inboundroute: ['E2'], directionin: ['E3'], recording: ['N1'],
}
const ALL = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16',
  'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'V1', 'V2', 'V3', 'V4', 'U1', 'U2', 'E1', 'E2', 'E3', 'E4', 'N1']

const sel = process.env.TAMPER || ''
const base = process.env.BASE || ''
const active = sel === '1' ? Object.keys(TAMPERS) : sel ? sel.split(',') : []
for (const t of active) if (!TAMPERS[t]) { console.error(`unknown selector ${t}`); process.exit(2) }
if (base && active.length) { console.error('BASE and TAMPER are separate runs'); process.exit(2) }

// Line endings normalised: a Windows checkout (autocrlf) must not kill a multi-line anchor.
function read(rel) {
  if (base) {
    try { return execFileSync('git', ['show', `${base}:${rel}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n') } catch { return '' }
  }
  const p = path.join(ROOT, rel)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : ''
}
const used = new Set()
function tampered(rel, src) {
  for (const t of active) for (const [file, from, to] of TAMPERS[t]) {
    if (file !== rel) continue
    if (!src.includes(from)) { console.error(`dead anchor: ${t} in ${file}`); process.exit(2) }
    src = src.split(from).join(to)
    used.add(t)
  }
  return src
}
const stripTs = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
const guard = (id, fn) => { try { fn() } catch (e) { check(id, false, `threw: ${e && e.message}`) } }

// ── compile ────────────────────────────────────────────────────────────────────
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-c2c-'))
let compiled = true
for (const rel of MODULES) {
  const raw = read(rel)
  if (!raw) { compiled = false; continue }
  const js = ts.transpileModule(tampered(rel, raw), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  const dest = path.join(out, rel.replace(/^src\//, '').replace(/\.ts$/, '.js'))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, js)
}
// verify.ts imports the voice signature module (database). Stub it: the token is fixed,
// and the URL is built the way the real voiceSignatureUrl builds it.
const STUB = path.join(out, 'stub-voice-signature.js')
fs.writeFileSync(STUB, `exports.resolveVoiceWebhookAuth = async () => ({ orgId: 'org-1', authToken: 'tok_test', source: 'org_via_from' })
exports.voiceSignatureUrl = (p) => 'https://hub.example.com' + p`)
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, parent, ...rest) {
  if (req === '@/lib/twilio-voice-signature') req = STUB
  else if (req.startsWith('@/')) req = path.join(out, req.slice(2))
  else if (!req.startsWith('.') && !path.isAbsolute(req)) {
    // a package (twilio): the compiled files live in a temp dir, so resolve from the repo
    try { return origResolve.call(this, req, parent, ...rest) } catch { return require.resolve(req, { paths: [ROOT] }) }
  }
  return origResolve.call(this, req, parent, ...rest)
}
const load = (p) => { try { return require(path.join(out, p)) } catch { return {} } }
const logic = compiled ? load('lib/click-to-call/logic.js') : {}
const sig = compiled ? load('lib/click-to-call/signature.js') : {}
const ui = compiled ? load('lib/click-to-call/ui-logic.js') : {}
const ver = compiled ? load('lib/click-to-call/verify.js') : {}
const src = {}
for (const [k, f] of Object.entries(FILES)) src[k] = stripTs(tampered(f, read(f)))

async function main() {
  // ── A: the gate ────────────────────────────────────────────────────────────────
  const NOW = new Date('2026-10-01T16:00:00Z') // 12:00 in New York
  const facts = (o = {}) => ({
    callerOrgIds: ['org-1'],
    conversation: { id: 'conv-1', org_id: 'org-1', contact_id: 'c-1', line_e164: '+18289009821' },
    contact: { id: 'c-1', first_name: 'Test', last_name: 'Person', phone: '(828) 555-0100', do_not_contact: false, timezone: 'America/New_York' },
    flags: { enabled: true, live: true }, dncListHit: false, suppressed: false, staffPhone: '828-555-0199',
    onAllowlist: false, attempts: [], line: { e164: '+18289009821', label: 'WNW Office', isDefault: false },
    defaultTz: 'America/New_York', now: NOW, ...o,
  })
  const d = (o) => logic.decide(facts(o))
  const code = (o) => { const r = d(o); return r.ok ? 'ok' : r.code }
  guard('A1', () => check('A1', code({ callerOrgIds: ['org-2'] }) === 'wrong_org' && code({ conversation: null }) === 'wrong_org'
    && d({ callerOrgIds: ['org-2'] }).status === 403, code({ callerOrgIds: ['org-2'] })))
  guard('A2', () => check('A2', code({ contact: { ...facts().contact, phone: null } }) === 'no_contact_phone'
    && code({ contact: { ...facts().contact, phone: 'Test' } }) === 'no_contact_phone', code({ contact: { ...facts().contact, phone: null } })))
  guard('A3', () => check('A3', code({ suppressed: true }) === 'suppressed', code({ suppressed: true })))
  guard('A4', () => check('A4', code({ contact: { ...facts().contact, do_not_contact: true } }) === 'do_not_contact', 'do_not_contact flag'))
  guard('A5', () => check('A5', code({ dncListHit: true }) === 'do_not_contact', code({ dncListHit: true })))
  guard('A6', () => check('A6', code({ staffPhone: null }) === 'no_staff_phone' && code({ staffPhone: '' }) === 'no_staff_phone'
    && /team profile/.test(d({ staffPhone: null }).message), code({ staffPhone: null })))
  const ago = (min) => new Date(NOW.getTime() - min * 60_000).toISOString()
  guard('A7', () => {
    const five = [1, 2, 3, 4, 5].map(ago), four = [1, 2, 3, 4].map(ago), day = Array.from({ length: 40 }, (_, i) => ago(30 + i * 20))
    const r = d({ attempts: five })
    check('A7', r.code === 'rate_limited' && r.status === 429 && code({ attempts: four }) === 'ok' && code({ attempts: day }) === 'rate_limited'
      && code({ attempts: [11, 12, 13, 14, 15].map(ago) }) === 'ok', [r.code, code({ attempts: four })])
  })
  guard('A8', () => check('A8', code({ flags: { enabled: false, live: true } }) === 'flag_off' && code({ flags: logic.parseC2CFlags(undefined) }) === 'flag_off',
    code({ flags: { enabled: false, live: true } })))
  guard('A9', () => check('A9', code({ flags: { enabled: true, live: false }, onAllowlist: true }) === 'ok', code({ flags: { enabled: true, live: false }, onAllowlist: true })))
  guard('A10', () => {
    const r = d({ flags: { enabled: true, live: false }, onAllowlist: false })
    check('A10', r.code === 'not_allowlisted' && /test mode/i.test(r.message) && code({ flags: { enabled: true, live: true }, onAllowlist: false }) === 'ok', r.code)
  })
  guard('A11', () => {
    const late = d({ now: new Date('2026-10-02T02:30:00Z') }) // 22:30 in New York
    const early = d({ now: new Date('2026-10-01T11:59:00Z'), contact: { ...facts().contact, timezone: 'Not/AZone' } }) // 07:59 NY via fallback
    check('A11', late.ok === true && late.quiet.outside === true && late.quiet.localTime === '22:30' && early.ok && early.quiet.outside
      && early.quiet.timezone === 'America/New_York' && d({}).quiet.outside === false, [late.ok, late.quiet, early.quiet])
  })
  guard('A12', () => {
    const p = logic.parseC2CFlags
    check('A12', p({ enabled: 'on', live: 'on' }).live === true && p({ enabled: true, live: 'ON' }).enabled === false && p({ enabled: 'yes' }).enabled === false
      && p(null).enabled === false && p({ enabled: 'on' }).live === false, 'only the exact string on counts')
  })
  guard('A13', () => {
    const nums = [{ phone: '+18284155050', nickname: 'Main' }, { phone: '(828) 900-9821', nickname: 'WNW Office' }]
    const own = logic.pickLine(nums, '+18289009821', '+18284155050')
    const gone = logic.pickLine(nums, '+19999999999', '+18284155050')
    const none = logic.pickLine(nums, null, '+18284155050')
    const envOnly = logic.pickLine([], null, '+18285550000')
    check('A13', own.e164 === '+18289009821' && own.isDefault === false && own.label === 'WNW Office' && gone.e164 === '+18284155050'
      && gone.isDefault && none.isDefault && none.label === 'Main' && envOnly.label === 'Primary' && logic.pickLine([], null, '') === null,
      [own, gone, none, envOnly])
  })
  // A14 the route reads nothing from the body but the conversation id, and the server derives the org from membership
  guard('A14', () => {
    const post = src.route.slice(src.route.indexOf('export const POST'))
    const bodyFields = Array.from(post.matchAll(/body\?\.(\w+)/g)).map((m) => m[1])
    check('A14', post.includes('withStaff(') && bodyFields.length > 0 && bodyFields.every((f) => f === 'conversation_id')
      && /caller\.orgIds\.includes\(conv\.org_id\)/.test(src.server) && src.route.includes('export const GET = withStaff('), bodyFields)
  })
  // A15 the route refuses, then logs, then dials; the preflight never dials or writes
  guard('A15', () => {
    const post = src.route.slice(src.route.indexOf('export const POST'))
    const get = src.route.slice(src.route.indexOf('export const GET'), src.route.indexOf('export const POST'))
    const iRefuse = post.indexOf('if (!d.ok)'), iLog = post.indexOf('logAttempt(ctx.db, { orgId, contactId'), iDial = post.indexOf('.calls.create(')
    check('A15', iRefuse > 0 && iLog > iRefuse && iDial > iLog && !/calls\.create|\.insert\(|logAttempt/.test(get), [iRefuse, iLog, iDial])
  })
  // A16 every refusal message is a sentence without an em dash
  guard('A16', () => {
    const cases = [{ callerOrgIds: [] }, { flags: { enabled: false, live: false } }, { contact: null }, { contact: { ...facts().contact, phone: null } },
      { dncListHit: true }, { suppressed: true }, { staffPhone: null }, { line: null }, { flags: { enabled: true, live: false } }, { attempts: [1, 2, 3, 4, 5].map(ago) }]
    // only the refusals that happen: a planted gate removal is A1 to A10's job, not this one's
    const msgs = cases.map((c) => d(c)).filter((r) => !r.ok).map((r) => r.message)
    const files = Object.values(src).join(' ') + read(L)
    const EM_DASH = String.fromCharCode(0x2014)
    check('A16', msgs.every((m) => typeof m === 'string' && /[.]$/.test(m) && !m.includes(EM_DASH)) && !files.includes(EM_DASH), msgs)
  })

  // ── S: signatures ────────────────────────────────────────────────────────────
  const twilio = require('twilio')
  const URL0 = 'https://hub.example.com/api/twilio/click-to-call/bridge?log=abc'
  const P = { CallSid: 'CA1', From: '+18289009821', To: '+18285550199' }
  const good = twilio.getExpectedTwilioSignature('tok_test', URL0, P)
  guard('S1', () => check('S1', sig.signatureOk('tok_test', URL0, P, good) === true, 'a valid signature was refused'))
  guard('S2', () => check('S2', sig.signatureOk('tok_test', URL0, P, 'AAAA' + good.slice(4)) === false, 'a wrong signature was accepted'))
  guard('S3', () => check('S3', sig.signatureOk('tok_test', URL0, P, '') === false, 'a missing signature was accepted'))
  guard('S4', () => check('S4', sig.signatureOk('', URL0, P, good) === false && sig.signatureOk('tok_test', '', P, good) === false, 'no token or URL was accepted'))
  guard('S5', () => check('S5', sig.signatureOk('tok_test', URL0, { ...P, To: '+19995550000' }, good) === false
    && sig.signatureOk('tok_test', URL0 + '&step=dial', P, good) === false, 'a changed parameter or URL was accepted'))
  // S6 / S7 each webhook verifies, refuses with 403 on failure, and does both before its first database call
  const firstDb = (s) => { const i = [s.indexOf('createAdminSupabase('), s.indexOf('.from(')].filter((x) => x >= 0); return i.length ? Math.min(...i) : Infinity }
  for (const [id, k] of [['S6', 'bridge'], ['S7', 'status']]) guard(id, () => {
    const s = src[k], body = s.slice(s.indexOf('export async function POST'))
    const iVer = body.indexOf('await verifyTwilioWebhook(request'), iRef = body.indexOf("if (!verified) return new NextResponse('Forbidden', { status: 403 })")
    check(id, iVer > 0 && iRef > iVer && iRef < firstDb(body) && !/TWILIO_VOICE_SIGNATURE_MODE|voiceSignatureMode/.test(s), [iVer, iRef, firstDb(body)])
  })
  // V the route-level verifier on a request object
  const req = (bodyParams, sigHeader, search = '?log=abc') => ({
    text: async () => new URLSearchParams(bodyParams).toString(),
    headers: { get: (h) => (h.toLowerCase() === 'x-twilio-signature' ? sigHeader : null) },
    nextUrl: { pathname: '/api/twilio/click-to-call/bridge', search },
  })
  const v = async (r) => { try { return await ver.verifyTwilioWebhook(r, 'harness') } catch (e) { return 'threw' } }
  const quiet = console.error; console.error = () => {}
  try {
    const v1 = await v(req(P, good)), v2 = await v(req(P, good.slice(0, -2) + 'xx')), v3 = await v(req(P, null)), v4 = await v(req(P, good, '?log=other'))
    check('V1', v1 && v1.params && v1.params.CallSid === 'CA1' && v1.orgId === 'org-1', v1)
    check('V2', v2 === null, v2)
    check('V3', v3 === null, v3)
    check('V4', v4 === null, v4)
  } finally { console.error = quiet }

  // ── U: switching conversations ───────────────────────────────────────────────
  guard('U1', () => {
    const pre = (id) => ({ conversation_id: id, ok: true, code: null, message: null, contact_name: id, contact_phone: '+1828555' + id.slice(-4), staff_phone: '+18285550199', line: null, quiet_hours: null, live: true })
    let s = ui.startPreflight('conv-A')
    s = ui.startPreflight('conv-B') // the user switched before A's preflight came back
    s = ui.acceptPreflight(s, 'conv-A', { data: pre('conv-A') })
    const afterLateA = s
    s = ui.acceptPreflight(s, 'conv-B', { data: pre('conv-B') })
    const body = ui.callRequestBody('conv-B', s)
    check('U1', afterLateA.status === 'loading' && afterLateA.data === null && s.data.conversation_id === 'conv-B'
      && body && body.conversation_id === 'conv-B' && ui.callRequestBody('conv-A', s) === null
      && ui.disabledReason(afterLateA) !== null && ui.disabledReason(s) === null, [afterLateA, body])
  })
  guard('U2', () => {
    const b = src.button
    check('U2', /\}, \[conversationId\]\)/.test(b) && b.includes('callRequestBody(openIdRef.current, pre)') && b.includes('openIdRef.current = conversationId')
      && /acceptPreflight\(s, forId/.test(b) && /conversationId=\{selectedThread\.id\}/.test(read('src/app/(dashboard)/crm/conversations/page.tsx')), 'the button is not keyed to the open conversation')
  })

  // ── E: no entry events ───────────────────────────────────────────────────────
  const all = Object.values(src).join('\n') + stripTs(tampered(L, read(L)))
  guard('E1', () => check('E1', all.length > 500 && !/raiseEntryEvent|raise_entry_event|entry_events|marketing\/entry-events/.test(all), 'an entry event reference'))
  guard('E2', () => {
    const u = logic.callbackUrls('https://hub.example.com/', 'id1')
    const urls = Object.values(u).join(' ')
    check('E2', u.bridge === 'https://hub.example.com/api/twilio/click-to-call/bridge?log=id1' && u.dialAction.endsWith('/status?log=id1&leg=dial')
      && !/inbound-call|ring-complete|call-status/.test(urls + all), urls)
  })
  guard('E3', () => check('E3', /from\('call_logs'\)\.insert\(\{[^}]*direction: 'outbound'/.test(src.route) && !/direction: 'inbound'/.test(all)
    && /direction !== 'outbound'\) return null/.test(src.webhook), 'the call row is not outbound'))
  guard('E4', () => check('E4', all.length > 500 && !/from\('contacts'\)\s*\.(update|insert|upsert|delete)/.test(all), 'a contacts write'))

  // ── N: no recording ──────────────────────────────────────────────────────────
  guard('N1', () => {
    const twiml = logic.confirmTwiml('https://x/a?log=1&step=dial', 'Ann') + logic.dialTwiml('+18285550100', '+18289009821', 'https://x/s') + logic.hangupTwiml('Bye')
    check('N1', !/record/i.test(twiml) && !/\brecord\s*:|recordingStatusCallback|<Record|record=/i.test(all)
      && twiml.includes('<Number>+18285550100</Number>') && twiml.includes('callerId="+18289009821"'), twiml)
  })
}

main().then(() => {
  fs.rmSync(out, { recursive: true, force: true })
  const ids = new Set(rows.map((r) => r.id))
  for (const id of ALL) if (!ids.has(id)) check(id, false, 'did not run')
  const red = Array.from(new Set(rows.filter((r) => !r.ok).map((r) => r.id))).sort()
  const sortIds = (a) => a.slice().sort()
  if (!base) for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'RED '} ${r.id}${r.ok ? '' : `  got ${JSON.stringify(r.got)}`}`)
  if (base) {
    console.log(`\nBASE=${base}: red {${red.join(',')}}, declared {${sortIds(ALL).join(',')}}`)
    process.exit(JSON.stringify(red) === JSON.stringify(sortIds(ALL)) ? 0 : 3)
  }
  if (!active.length) {
    console.log(red.length ? `FAIL: ${red.length} red of ${ALL.length}` : `PASS: ${ALL.length} of ${ALL.length}`)
    process.exit(red.length ? 1 : 0)
  }
  for (const t of active) if (!used.has(t)) { console.error(`dead anchor: ${t} touched no file`); process.exit(2) }
  const want = Array.from(new Set(active.flatMap((t) => RED_OF[t]))).sort()
  console.log(`red {${red.join(',')}}, declared {${want.join(',')}}`)
  if (red.length === 0) { console.error('FATAL: a TAMPERED run PASSED.'); process.exit(3) }
  if (JSON.stringify(red) !== JSON.stringify(want)) { console.error('FATAL: tampered red SET does not match the declaration.'); process.exit(3) }
  process.exit(0)
})
