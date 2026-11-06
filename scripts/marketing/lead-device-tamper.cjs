#!/usr/bin/env node
// scripts/marketing/lead-device-tamper.cjs
//
// The rules a lead device must not break. Checks, against the real source:
//   D_TEST      a test submission writes its own row and touches no contact, consent, campaign or text
//   D_LIVE      a live submission makes the contact through hub_lead_device_contact and routes it
//   D_REPLAY    a repeated idempotency key changes nothing
//   D_CONSENT   only exactly true counts as ticked, and the Hub form's text comes from the manifest
//   D_OPTOUT    a person's own opt-out is never reversed, and SMS consent needs the same phone
//   D_LEAD      first name, email and the result box are required on the Hub form; phone is optional
//   D_SECRET    the intake secret refuses when unset, short or wrong
//   D_PREVIEW   a forged or expired preview token is refused, and a draft device needs one
//   D_FILE      the file may reach nothing, is sandboxed without allow-same-origin, and gets the bridge
//   D_PAGE      the page's scripts need a nonce and frames are limited to the ruled origins
//   D_HOT       the hot lead rule matches only what it names
//   D_FACTS     lead_device and quiz_archetype read the facts and stay empty without them
//   D_NOLOG     no lead device source logs a name, address, answer or consent text
//
//   testwrites  a test submission goes on to make a contact  {D_TEST}
//   notest      a device that is not live counts as real     {D_TEST}
//   noreplay    a repeated key is processed again            {D_REPLAY}
//   truthy      any truthy value counts as ticked            {D_CONSENT}
//   optout      an opt-out does not stop a consent           {D_OPTOUT}
//   noresult    the result box is not required               {D_LEAD}
//   secretopen  an unset secret passes                       {D_SECRET}
//   anypreview  any preview token passes                     {D_PREVIEW}
//   sameorigin  the sandbox gains allow-same-origin          {D_FILE}
//   connect     the file may connect out                     {D_FILE}
//   nonce       the page allows any inline script            {D_PAGE}
//   hotall      every submission is a hot lead               {D_HOT}
//   factsall    lead_device matches everyone                 {D_FACTS}
//   logname     the contact failure logs the email           {D_NOLOG}
// TAMPER=1 reddens the union.
const fs = require('fs'), path = require('path')
const H = require('../agent/lib/harness.cjs')

const I = 'lib/lead-devices/intake.ts', M = 'lib/lead-devices/manifest.ts', C = 'lib/lead-devices/contract.ts', P = 'lib/lead-devices/player.ts', PD = 'lib/lead-devices/public-device.ts', E = 'lib/lead-devices/external.ts', L = 'lib/marketing/smart-lists/match.ts'
const TAMPERS = {
  testwrites: [[I, "  if (test) {\n    const { error } = await db.from('lead_device_submissions').update({ status: 'accepted' })", "  if (false) {\n    const { error } = await db.from('lead_device_submissions').update({ status: 'accepted' })"]],
  notest: [[M, "return preview || status !== 'live'", 'return preview']],
  noreplay: [[I, "if ((seen as any)?.status === 'accepted') return { ok: true, id: (seen as any).id, duplicate: true, test: (seen as any).is_test }", '']],
  truthy: [[I, "granted: sent?.email === true", 'granted: !!sent?.email']],
  optout: [[I, "if (String((st as any)?.reason ?? '').endsWith('_revoked')) { out.push({ ...c, recorded: false, skipped: 'opted_out' }); continue }", '']],
  noresult: [[I, "if (b?.consent?.result !== true) errors.result = 'Please tick this box so we can email your result.'", '']],
  secretopen: [[E, 'if (!auth || !secret || secret.trim().length < 32) return false', 'if (!secret) return true\n  if (!auth || secret.trim().length < 32) return false']],
  anypreview: [[PD, 'return want.length === got.length && timingSafeEqual(want, got) ? versionId : null', 'return versionId']],
  sameorigin: [[C, "'allow-forms'] as const", "'allow-forms', 'allow-same-origin'] as const"]],
  connect: [[P, `"connect-src 'none'",`, `"connect-src *",`]],
  nonce: [[P, "`script-src 'nonce-${nonce}' ${TURNSTILE}`", "`script-src 'unsafe-inline' ${TURNSTILE}`"]],
  hotall: [[M, 'if (!rule) return false', 'if (!rule) return true']],
  factsall: [[L, "case 'lead_device': return asList(r.value).some((v) => (f.lead_devices ?? []).includes(v))", "case 'lead_device': return true"]],
  logname: [[I, 'console.error(`[lead-device] submission=${id} contact failed: ${cErr?.code ?? \'no id\'}`)', 'console.error(`[lead-device] ${input.email} contact failed`)']],
}
const RED_OF = {
  testwrites: ['D_TEST'], notest: ['D_TEST'], noreplay: ['D_REPLAY'], truthy: ['D_CONSENT'], optout: ['D_OPTOUT'], noresult: ['D_LEAD'], secretopen: ['D_SECRET'],
  anypreview: ['D_PREVIEW'], sameorigin: ['D_FILE'], connect: ['D_FILE'], nonce: ['D_PAGE'], hotall: ['D_HOT'], factsall: ['D_FACTS'], logname: ['D_NOLOG'],
}
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-leaddev')
const load = H.install(out)
const { processSubmission, hostedConsents, checkHostedLead, checkExternalSubmission } = load(I)
const { hotLeadMatches, cleanManifest } = load(M)
const { isLeadIntakeCaller } = load(E)
const { mintPreview, readPreview } = load(PD)
const { SANDBOX_ATTR, buildNpuBridge, wrapDeviceHtml } = load(C)
const { fileCsp, pageCsp, renderPlayer } = load(P)
const { matches, missingSources } = load(L)

const SECRET = 'x'.repeat(40)
const manifest = cleanManifest({ outcomes: [{ key: 'holder', label: 'Holder' }], questions: [{ key: 'q1', label: 'Question one' }], hot_lead_rule: { outcomes: ['holder'] } }, 'neuro_progeny')
const device = (status) => ({ id: 'd1', org_id: 'o1', slug: 'quiz', name: 'Quiz', brand: 'neuro_progeny', type: 'quiz', hosting: 'hub', content: 'html', status, manifest, pipeline_id: null, live_version_id: 'v1', assets: {}, provisioned_at: 'x', provision_error: null, test_drive_passed_at: null, went_live_at: null })
const input = (over = {}) => ({
  channel: 'hosted', idempotencyKey: 'k1', email: 'a@example.com', firstName: 'Ana', phone: '+18285550100', outcome: 'holder', answers: { q1: 'yes' },
  consents: hostedConsents({ manifest }, { result: true, email: true, sms: true }), utm: null, pageUrl: null, submittedAt: null, ipHash: 'h', userAgent: 'u', versionId: 'v1', preview: false, ...over,
})
const dbFor = (opts = {}) => H.stubDb({ contacts: [{ id: 'c1', tags: [], email: 'a@example.com', phone: '+18285550100' }], lead_device_submissions: opts.seen ?? [] }, {
  rpc: (name) => {
    if (name === 'hub_lead_device_contact') return { data: 'c1', error: null }
    if (name === 'consent_state') return { data: { reason: opts.state ?? 'none' }, error: null }
    return { data: [], error: null }
  },
})
const rpcs = (db) => db.calls.filter((c) => c.rpc).map((c) => c.rpc)
const writes = (db) => db.calls.filter((c) => c.ops && c.ops.some((o) => ['insert', 'update', 'upsert', 'delete'].includes(o[0]))).map((c) => c.table)

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

;(async () => {
  const draft = dbFor()
  const t = await processSubmission(draft, device('draft'), input())
  const paused = dbFor()
  await processSubmission(paused, device('paused'), input({ idempotencyKey: 'k9' }))
  const previewDb = dbFor()
  const prev = await processSubmission(previewDb, device('live'), input({ preview: true }))
  const clean = (db) => rpcs(db).length === 0 && writes(db).every((w) => w === 'lead_device_submissions')
  check('D_TEST', t.ok && t.test === true && prev.test === true && clean(draft) && clean(paused) && clean(previewDb), { rpcs: rpcs(draft), writes: writes(draft) })

  const live = dbFor()
  const l = await processSubmission(live, device('live'), input())
  const liveRpcs = rpcs(live)
  check('D_LIVE', l.ok && l.test === false && liveRpcs.includes('hub_lead_device_contact') && liveRpcs.includes('route_and_enroll') && liveRpcs.filter((r) => r === 'record_consent').length === 3 && writes(live).includes('hub_sms_outbox'), { liveRpcs })

  const replay = dbFor({ seen: [{ id: 's1', device_id: 'd1', idempotency_key: 'k1', status: 'accepted', is_test: false }] })
  const again = await processSubmission(replay, device('live'), input())
  check('D_REPLAY', again.ok && again.duplicate === true && rpcs(replay).length === 0 && writes(replay).length === 0, { again, rpcs: rpcs(replay) })

  const vals = ['on', 'true', 1, {}, []]
  const offered = hostedConsents({ manifest }, { result: true })
  check('D_CONSENT',
    vals.every((v) => hostedConsents({ manifest }, { email: v, sms: v, result: v }).every((c) => c.granted === false))
    && offered[0].kind === 'service' && offered[0].text === manifest.result_consent_text && offered[1].kind === 'marketing' && offered[1].channel === 'email' && offered[2].channel === 'sms'
    && hostedConsents({ manifest }, { email: true, email_text: 'other words' })[1].text === manifest.email_consent_text,
    offered.map((c) => c.granted))

  const out1 = dbFor({ state: 'marketing_revoked' })
  await processSubmission(out1, device('live'), input())
  const otherPhone = dbFor()
  await processSubmission(otherPhone, device('live'), input({ phone: '+18285559999' }))
  const consentCount = (db) => db.calls.filter((c) => c.rpc === 'record_consent').length
  check('D_OPTOUT', consentCount(out1) === 0 && consentCount(otherPhone) === 2, { revoked: consentCount(out1), otherPhone: consentCount(otherPhone) })

  const good = { first_name: 'Ana', email: 'a@example.com', consent: { result: true } }
  const leadOk = checkHostedLead(good).ok && checkHostedLead({ ...good, phone: '' }).ok
  check('D_LEAD', leadOk && !checkHostedLead({ ...good, first_name: '' }).ok && !checkHostedLead({ ...good, email: 'nope' }).ok
    && !checkHostedLead({ first_name: 'Ana', email: 'a@example.com', consent: {} }).ok && !checkHostedLead({ ...good, consent: { result: 'true' } }).ok
    && !checkExternalSubmission({ email: 'a@example.com', idempotency_key: 'k', consent: { email: true } }).ok
    && checkExternalSubmission({ email: 'a@example.com', idempotency_key: 'k', consent: { email: true, email_text: 'Yes' } }).ok, { leadOk })

  check('D_SECRET', isLeadIntakeCaller(`Bearer ${SECRET}`, { LEAD_INTAKE_SECRET: SECRET })
    && !isLeadIntakeCaller(`Bearer ${SECRET}`, {}) && !isLeadIntakeCaller('Bearer ', {}) && !isLeadIntakeCaller('Bearer short', { LEAD_INTAKE_SECRET: 'short' })
    && !isLeadIntakeCaller('Bearer wrong', { LEAD_INTAKE_SECRET: SECRET }) && !isLeadIntakeCaller(null, { LEAD_INTAKE_SECRET: SECRET }), 'secret cases')

  const envOk = { LEAD_INTAKE_SECRET: SECRET }
  const NOW = 1_800_000_000_000
  const token = mintPreview('d1', 'v1', NOW, envOk)
  const [v, exp] = token.split('.')
  check('D_PREVIEW', readPreview(token, 'd1', NOW, envOk) === 'v1' && readPreview(token, 'd2', NOW, envOk) === null
    && readPreview(`${v}.${exp}.forged`, 'd1', NOW, envOk) === null && readPreview(token, 'd1', NOW + 8 * 86400000, envOk) === null
    && readPreview(token, 'd1', NOW, {}) === null && mintPreview('d1', 'v1', NOW, {}) === null, 'preview cases')

  const fc = fileCsp(['https://cdn.example.com'])
  const stored = '<!doctype html><html><body>hi</body></html>'
  const served = wrapDeviceHtml(stored, buildNpuBridge('quiz'))
  check('D_FILE', !SANDBOX_ATTR.includes('allow-same-origin') && fc.includes(`sandbox ${SANDBOX_ATTR}`) && fc.includes("connect-src 'none'") && fc.includes("form-action 'none'")
    && fc.includes('https://cdn.example.com') && !fileCsp([]).includes('cdn') && served.startsWith('<!doctype html>') && served.includes('window.NPU=') && served.includes('track:track') && served.endsWith(stored.slice('<!doctype html>'.length)), fc)

  const pc = pageCsp('N1', ['https://podcast.example.com'])
  const page = renderPlayer({ device: { slug: 'quiz', name: '<b>Q</b>', content: 'html', manifest }, nonce: 'N1', siteKey: 'site', preview: null })
  check('D_PAGE', pc.includes("script-src 'nonce-N1' https://challenges.cloudflare.com") && !pc.includes("script-src 'unsafe-inline'") && pc.includes("default-src 'none'") && pc.includes('frame-ancestors https://hub.neuroprogeny.com') && pc.includes('https://podcast.example.com') && !pc.includes('university')
    && !page.includes('<b>Q</b>') && page.includes(`sandbox="${SANDBOX_ATTR}"`) && !/<input[^>]*type="checkbox"[^>]*checked/.test(page) && page.includes(manifest.result_consent_text), pc)

  check('D_HOT', hotLeadMatches({ outcomes: ['holder'] }, 'holder', {}) && !hotLeadMatches({ outcomes: ['holder'] }, 'giver', {}) && !hotLeadMatches(null, 'holder', {}) && hotLeadMatches({ answers: { q1: 'yes' } }, null, { q1: 'yes' }) && !hotLeadMatches({ answers: { q1: 'yes' } }, null, { q1: 'no' }), 'hot cases')

  const facts = { contact_id: 'c', created_at: '2026-01-01', tags: [], email_allowed: false, texting_allowed: false, lead_devices: ['quiz'], quiz_archetypes: ['Holder', 'holder'] }
  const rule = (field, value) => ({ match: 'all', rules: [{ field, op: 'in', value }] })
  check('D_FACTS', matches(rule('lead_device', ['quiz']), facts, 0) && !matches(rule('lead_device', ['other']), facts, 0) && !matches(rule('lead_device', ['quiz']), { ...facts, lead_devices: [] }, 0)
    && matches(rule('quiz_archetype', ['Holder']), facts, 0) && !matches(rule('quiz_archetype', ['Giver']), facts, 0) && missingSources(rule('quiz_archetype', ['Holder'])).length === 0 && missingSources(rule('lead_device', ['quiz'])).length === 0, 'facts cases')

  const SENSITIVE = /console\.(?:log|info|warn|error)\([^\n]*(?:email|phone|firstName|first_name|answers|\.text|consent_text|body\b|secret)/i
  const files = ['intake', 'external', 'provision', 'public-device', 'turnstile', 'player', 'manifest'].map((f) => path.join(out, 'lib', 'lead-devices', `${f}.js`))
  const routes = ['lead-device/[slug]/route.ts', 'lead-device/[slug]/file/route.ts', 'lead-device/[slug]/submit/route.ts', 'lead-device/[slug]/track/route.ts', 'api/marketing/lead-devices/route.ts', 'api/marketing/lead-devices/upload/route.ts']
    .map((r) => path.join(__dirname, '..', '..', 'src', 'app', r))
  const leaks = [...files, ...routes].filter((f) => SENSITIVE.test(fs.readFileSync(f, 'utf8'))).map((f) => path.basename(f))
  check('D_NOLOG', leaks.length === 0, { leaks })

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})().catch((e) => { console.error(e); process.exit(2) })
