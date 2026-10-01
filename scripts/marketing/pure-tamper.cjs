#!/usr/bin/env node
// scripts/marketing/pure-tamper.cjs
//
// Pure checks on the marketing modules that decide safety: flags, sender, tokens,
// webhook signatures, the University redirect, rendering, the watchdog, intake
// validation and the Resend request. Compiles the REAL source with TypeScript's
// transpiler into this run's own temp directory and requires it. No network, no
// database. Cost: about 2 seconds.
//
// TAMPER=<selector> plants one defect into the source text before compiling, and the
// run must redden EXACTLY the declared set (the SET convention, not a count):
//   flagson     parseFlags treats any truthy value as on           {F1}
//   placeholder senderProblem forgets the placeholder sender       {P1}
//   svixopen    a bad signature is accepted                         {S3}
//   redirect    the University redirect loses both of its guards   {U2,U3,U4}
//   nostop      marketing SMS loses its STOP line                   {R2}
//   onefail     the watchdog alarms on one failure, not two         {W4}
//   unsubreq    a marketing email may go without unsubscribe        {RS1}
// TAMPER=1 runs every selector at once and must redden the union.
// Exit: 0 green (untampered) or the declared set reddened (tampered); 1 a red that
// was not declared; 2 unknown selector or a substitution that matched nothing;
// 3 a tampered run whose red set is not the declaration.
const fs = require('fs'), path = require('path'), os = require('os'), Module = require('module')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src')
const MODULES = ['lib/marketing/flags.ts', 'lib/marketing/policy.ts', 'lib/marketing/tokens.ts', 'lib/marketing/svix.ts',
  'lib/marketing/university.ts', 'lib/marketing/engine.ts', 'lib/marketing/render.ts', 'lib/marketing/watchdog.ts',
  'lib/marketing/intake.ts', 'lib/marketing/providers/resend.ts', 'lib/marketing/providers/types.ts', 'lib/crm-server.ts', 'lib/phone.ts']

const TAMPERS = {
  flagson: [['lib/marketing/flags.ts', "out[k] = (raw as Record<string, unknown>)[k] === 'on'", 'out[k] = Boolean((raw as Record<string, unknown>)[k])']],
  placeholder: [['lib/marketing/policy.ts', "if (domain === PLACEHOLDER_SENDER_DOMAIN) return 'sender_is_placeholder'", '']],
  svixopen: [['lib/marketing/svix.ts', "return { ok: false, reason: 'bad_signature' }", 'return { ok: true }']],
  redirect: [
    ['lib/marketing/university.ts', "if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes(BACKSLASH)) return null", "if (typeof path !== 'string') return null"],
    ['lib/marketing/university.ts', 'return url.origin === UNIVERSITY_ORIGIN ? url.toString() : null', 'return url.toString()'],
  ],
  nostop: [['lib/marketing/render.ts', "if (i.kind === 'marketing' && !/reply stop/i.test(text)) text = `${text} ${SMS_STOP_LINE}`", '']],
  onefail: [['lib/marketing/watchdog.ts', "finished.length >= 2 && finished[0].ok === false && finished[1].ok === false", 'finished.length >= 1 && finished[0].ok === false']],
  unsubreq: [['lib/marketing/providers/resend.ts', "if (msg.kind === 'marketing' && !msg.unsubscribeUrl) return { refused: 'marketing_without_unsubscribe' }", '']],
}
const RED_OF = { flagson: ['F1'], placeholder: ['P1'], svixopen: ['S3'], redirect: ['U2', 'U3', 'U4'], nostop: ['R2'], onefail: ['W4'], unsubreq: ['RS1'] }

const sel = process.env.TAMPER || ''
const active = sel === '1' ? Object.keys(TAMPERS) : sel ? sel.split(',') : []
for (const t of active) if (!TAMPERS[t]) { console.error(`unknown selector ${t}`); process.exit(2) }

// ── compile into THIS run's own directory (never a fixed path: verify runs in parallel) ──
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-pure-'))
for (const rel of MODULES) {
  let src = fs.readFileSync(path.join(SRC, rel), 'utf8')
  for (const t of active) for (const [file, from, to] of TAMPERS[t]) {
    if (file !== rel) continue
    if (!src.includes(from)) { console.error(`dead anchor: ${t} in ${file}`); process.exit(2) }
    src = src.split(from).join(to)
  }
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  const dest = path.join(out, rel.replace(/\.ts$/, '.js'))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, js)
}
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, parent, ...rest) {
  if (req.startsWith('@/')) req = path.join(out, req.slice(2))
  return origResolve.call(this, req, parent, ...rest)
}
const L = (p) => require(path.join(out, p))
const { parseFlags } = L('lib/marketing/flags.js')
const { senderProblem } = L('lib/marketing/policy.js')
const tokens = L('lib/marketing/tokens.js')
const { verifySvix } = L('lib/marketing/svix.js')
const { universityTarget } = L('lib/marketing/university.js')
const { renderStep } = L('lib/marketing/render.js')
const { findProblems } = L('lib/marketing/watchdog.js')
const { validateIntake, definitionProblems } = L('lib/marketing/intake.js')
const { buildResendRequest } = L('lib/marketing/providers/resend.js')
const crypto = require('crypto')

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
const EM_DASH = String.fromCharCode(0x2014)

// flags
check('F1', JSON.stringify(parseFlags({ engine: 'on', intake: 'true', gate_live_sends: true })) === JSON.stringify({ engine: true, gate_live_sends: false, provider_email: false, intake: false, deliver_asset: false, mirror_legacy_stage: false }), parseFlags({ engine: 'on', intake: 'true', gate_live_sends: true }))
check('F2', Object.values(parseFlags(null)).every((x) => x === false), parseFlags(null))
// sender
check('P1', senderProblem({ from_address: 'NP <hello@sender-not-set.neuroprogeny.com>', from_domain: 'sender-not-set.neuroprogeny.com' }) === 'sender_is_placeholder')
check('P2', senderProblem({ from_address: 'NP <hello@mail.neuroprogeny.com>', from_domain: 'mail.neuroprogeny.com' }) === null)
check('P3', senderProblem({ from_address: 'NP <hello@gmail.com>', from_domain: 'mail.neuroprogeny.com' }) === 'sender_address_not_on_domain')
// tokens
process.env.HUB_UNSUBSCRIBE_SECRET = 'x'.repeat(40)
const sid = '1b4e28ba-2fa1-41d2-883f-0016d3cca427'
const tok = tokens.mintUnsubscribeToken(sid)
check('T1', tokens.verifyUnsubscribeToken(tok) === sid, tok)
check('T2', tokens.verifyUnsubscribeToken(tok.slice(0, -2) + (tok.endsWith('AA') ? 'BB' : 'AA')) === null)
delete process.env.HUB_UNSUBSCRIBE_SECRET
check('T3', tokens.mintUnsubscribeToken(sid) === null && tokens.verifyUnsubscribeToken(tok) === null)
const at = tokens.newAssetToken()
check('T4', at.hash.length === 32 && !at.token.includes(at.hash.toString('hex')) && /^[A-Za-z0-9_-]{43}$/.test(at.token), at.token.length)
// svix
const secret = 'whsec_' + Buffer.from('k'.repeat(24)).toString('base64')
const sign = (s, id, ts, body) => 'v1,' + crypto.createHmac('sha256', Buffer.from(s.slice(6), 'base64')).update(`${id}.${ts}.${body}`).digest('base64')
const now = 1_800_000_000
const body = '{"type":"email.delivered"}'
check('S1', verifySvix(secret, { id: 'm1', timestamp: String(now), signature: sign(secret, 'm1', now, body) }, body, now).ok === true)
check('S2', verifySvix(secret, { id: null, timestamp: null, signature: null }, body, now).reason === 'unsigned')
const other = 'whsec_' + Buffer.from('z'.repeat(24)).toString('base64')
check('S3', verifySvix(secret, { id: 'm1', timestamp: String(now), signature: sign(other, 'm1', now, body) }, body, now).ok === false)
check('S4', verifySvix(secret, { id: 'm1', timestamp: String(now - 3600), signature: sign(secret, 'm1', now - 3600, body) }, body, now).reason === 'stale')
check('S5', verifySvix(undefined, { id: 'm1', timestamp: String(now), signature: 'v1,x' }, body, now).reason === 'secret_missing')
// University redirect
check('U1', universityTarget('/signup?asset=guide') === 'https://university.neuroprogeny.com/signup?asset=guide')
check('U2', universityTarget('//evil.example/x') === null, universityTarget('//evil.example/x'))
check('U3', universityTarget('/' + String.fromCharCode(92) + 'evil.example') === null, universityTarget('/' + String.fromCharCode(92) + 'evil.example'))
check('U4', universityTarget('https://evil.example/') === null, universityTarget('https://evil.example/'))
// rendering
const person = { first_name: 'Ana', last_name: 'B', email: 'a@x.io', phone: '+15555550100', pipeline_stage: '' }
const e1 = renderStep({ channel: 'email', kind: 'marketing', subject: 'Hi {{first_name}}', body: 'Hello {{first_name}}', contact: person, orgName: 'Neuro Progeny', unsubscribeUrl: 'https://h/u?t=1', assetUrl: null })
check('R1', e1.subject === 'Hi Ana' && e1.html.includes('https://h/u?t=1') && e1.text.includes('Unsubscribe: https://h/u?t=1'), e1)
const s1 = renderStep({ channel: 'sms', kind: 'marketing', subject: null, body: 'Hi {{first_name}}', contact: person, orgName: 'NP', unsubscribeUrl: null, assetUrl: null })
check('R2', s1.text === 'Hi Ana Reply STOP to opt out.', s1.text)
const s2 = renderStep({ channel: 'sms', kind: 'service', subject: null, body: 'See you at 3', contact: person, orgName: 'NP', unsubscribeUrl: null, assetUrl: null })
check('R3', s2.text === 'See you at 3', s2.text)
const s3 = renderStep({ channel: 'sms', kind: 'service', subject: null, body: 'Your guide: {{asset_link}}', contact: person, orgName: 'NP', unsubscribeUrl: null, assetUrl: 'https://h/a/T' })
check('R4', s3.text === 'Your guide: https://h/a/T', s3.text)
check('R5', !e1.html.includes(EM_DASH) && !e1.text.includes(EM_DASH))
// watchdog
const t0 = new Date('2026-10-01T12:00:00Z')
const run = (min, ok) => ({ job: 'campaign-steps', started_at: new Date(t0.getTime() - min * 60000).toISOString(), finished_at: new Date(t0.getTime() - min * 60000 + 1000).toISOString(), ok })
const EXP = [{ job: 'campaign-steps', maxGapMinutes: 20 }]
check('W1', findProblems(EXP, [], t0)[0]?.problem === 'not_running')
check('W2', findProblems(EXP, [run(4, true), run(9, true)], t0).length === 0)
check('W3', findProblems(EXP, [run(4, false), run(9, false)], t0)[0]?.problem === 'failed_twice')
check('W4', findProblems(EXP, [run(4, false), run(9, true)], t0).length === 0, findProblems(EXP, [run(4, false), run(9, true)], t0))
// intake
const def = { fields: [{ key: 'email', label: 'Email', type: 'email', required: true, maps_to: 'email' }, { key: 'phone', label: 'Phone', type: 'tel', maps_to: 'phone' }],
  consents: [{ id: 'news', channel: 'email', kind: 'marketing', text: 'Send me the newsletter.' }, { id: 'texts', channel: 'sms', kind: 'marketing', text: 'Text me updates.' }] }
check('I1', validateIntake(def, {}, []).ok === false)
const ok1 = validateIntake(def, { email: 'A@B.io' }, ['news', 'forged'])
check('I2', ok1.ok && ok1.email === 'a@b.io' && ok1.consents.length === 1 && ok1.consents[0].text === 'Send me the newsletter.', ok1)
check('I3', validateIntake(def, { email: 'a@b.io' }, ['texts']).ok === false)
check('I4', definitionProblems({ fields: [{ key: 'name', label: 'Name', type: 'text' }], consents: [] }).length > 0)
// Resend request
const base = { orgId: 'o', sendId: sid, from: 'NP <hello@mail.x.io>', to: 'a@b.io', subject: 's', html: '<p>h</p>', text: 'h', kind: 'marketing' }
check('RS1', 'refused' in buildResendRequest({ ...base }), buildResendRequest({ ...base }))
const rq = buildResendRequest({ ...base, unsubscribeUrl: 'https://h/u?t=1' })
check('RS2', rq.body?.headers?.['List-Unsubscribe'] === '<https://h/u?t=1>' && rq.body?.headers?.['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', rq)
check('RS3', rq.headers?.['Idempotency-Key'] === `hub-send-${sid}`)

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
