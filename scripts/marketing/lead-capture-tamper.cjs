#!/usr/bin/env node
// scripts/marketing/lead-capture-tamper.cjs   (WNW holiday checklist: POST /api/public/lead-capture)
//
// Runs the real src/lib/marketing/lead-capture.ts. Checks, from intent:
//   L_ORIGIN    only https://waynesvilleneuro.com and https://www.waynesvilleneuro.com get CORS headers; any other
//               origin, plain http, or no Origin at all is refused
//   L_HONEYPOT  a filled "bot" field marks the request as a bot; empty or absent does not
//   L_SOURCE    an unknown source is refused 400, never mapped onto a declared one
//   L_EMAIL     the email is required and must look like an address; it is stored lower case
//   L_PHONE     a phone is optional, but when given must be a 10 digit US number (or 11 with a leading 1) or a
//               + international number of 8 to 15 digits
//   L_KEEP      a matched contact's non-empty first or last name is never overwritten, and a blank never wins;
//               only a blank or the "Unknown" placeholder is filled
//   L_MATCH     the match is by email first (exact, case-insensitive: % and _ in an address are escaped), then by
//               phone, and only then is a contact created through hub_intake_contact
//
//   anyorigin   CORS accepts any origin                                   {L_ORIGIN}
//   nohoneypot  the honeypot is ignored                                   {L_HONEYPOT}
//   anysource   an unknown source falls back to the holiday checklist     {L_SOURCE}
//   looseemail  any string passes as an email                             {L_EMAIL}
//   loosephone  any digits pass as a phone                                {L_PHONE}
//   blankwins   the submitted first name always replaces the card's       {L_KEEP}
//   rawlike     the email is matched with an unescaped ilike pattern      {L_MATCH}
// TAMPER=1 reddens the sum (7).
const fs = require('fs')
const H = require('../agent/lib/harness.cjs')

const F = 'lib/marketing/lead-capture.ts'
const TAMPERS = {
  anyorigin: [[F, '  if (!origin || !allOrigins().includes(origin)) return null\n', '  if (!origin) return null\n']],
  nohoneypot: [[F, '  if (b == null) return false\n', '  return false\n']],
  anysource: [[F, '  const def = LEAD_SOURCES[source]\n', "  const def = LEAD_SOURCES[source] ?? LEAD_SOURCES['holiday-checklist']\n"]],
  looseemail: [[F, '|| !EMAIL.test(email)) fields.email', ') fields.email']],
  loosephone: [[F, '  if (!e) return null\n  const digits', '  if (!e) return null\n  return e\n  const digits']],
  blankwins: [[F, "  if (first && (!cf || cf === 'Unknown')) out.first_name = first", '  out.first_name = first']],
  rawlike: [[F, ".ilike('email', likeExact(l.email))", ".ilike('email', l.email)"]],
}
const RED_OF = { anyorigin: ['L_ORIGIN'], nohoneypot: ['L_HONEYPOT'], anysource: ['L_SOURCE'], looseemail: ['L_EMAIL'],
  loosephone: ['L_PHONE'], blankwins: ['L_KEEP'], rawlike: ['L_MATCH'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-leadcap')
const load = H.install(out)
const lc = load(F)

const WNW = 'https://waynesvilleneuro.com', WWW = 'https://www.waynesvilleneuro.com'
const body = (o) => ({ source: 'holiday-checklist', name: 'Ana Rivera', email: 'ana@example.com', phone: '', resource: 'holidayproof-checklist', ...o })

// A recording stub: every builder call is logged; reads answer from `answers` keyed by table, rpc returns a new id.
function stub(answers = {}) {
  const calls = []
  const builder = (table) => {
    const ops = []
    const b = new Proxy({}, {
      get(_, m) {
        if (m === 'then') {
          const r = (answers[table] || (() => ({ data: [], error: null })))(ops)
          return (res, rej) => Promise.resolve(r).then(res, rej)
        }
        return (...a) => { ops.push([m, a]); return b }
      },
    })
    calls.push({ table, ops })
    return b
  }
  return { calls, from: builder, rpc: (name, args) => { calls.push({ rpc: name, args }); return Promise.resolve({ data: 'new-id', error: null }) } }
}

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

;(async () => {
  const cors = [WNW, WWW, 'https://evil.example', 'http://waynesvilleneuro.com', 'https://waynesvilleneuro.com.evil.example', null].map((o) => [o, !!lc.corsFor(o)])
  check('L_ORIGIN', cors.map((c) => c[1]).join() === 'true,true,false,false,false,false'
    && lc.corsFor(WNW)['Access-Control-Allow-Origin'] === WNW, cors)

  const bots = [{ bot: 'x' }, { bot: ' spam ' }, { bot: 1 }, { bot: '' }, {}, { bot: null }].map((b) => lc.isBot(b))
  check('L_HONEYPOT', bots.join() === 'true,true,true,false,false,false', bots)

  const unknown = lc.validateLead(body({ source: 'other' }), WNW)
  const missing = lc.validateLead(body({ source: undefined }), WNW)
  check('L_SOURCE', !unknown.ok && unknown.status === 400 && !missing.ok && missing.status === 400, { unknown, missing })

  const em = ['nope', 'a@b', 'a b@c.com', '', 'Ana@Example.COM'].map((e) => lc.validateLead(body({ email: e }), WNW))
  check('L_EMAIL', em.slice(0, 4).every((r) => !r.ok && r.fields && r.fields.email) && em[4].ok && em[4].email === 'ana@example.com', em.map((r) => r.ok))

  const ph = ['(828) 555-0100', '1-828-555-0100', '+44 20 7946 0958', '555-0100', '+1 828 555 01', '12345', 'call me'].map((p) => lc.validateLead(body({ phone: p }), WNW))
  check('L_PHONE', ph[0].ok && ph[0].phone === '+18285550100' && ph[1].ok && ph[1].phone === '+18285550100' && ph[2].ok && ph[2].phone === '+442079460958'
    && ph.slice(3).every((r) => !r.ok && r.fields && r.fields.phone) && lc.validateLead(body({ phone: '' }), WNW).phone === null, ph.map((r) => r.ok ? r.phone : 'refused'))

  const keep = [
    lc.nameFill({ first_name: 'Ana', last_name: 'Rivera' }, 'Anna', 'Smith'),
    lc.nameFill({ first_name: 'Ana', last_name: 'Rivera' }, '', ''),
    lc.nameFill({ first_name: 'Unknown', last_name: '' }, 'Ana', 'Rivera'),
    lc.nameFill({ first_name: null, last_name: null }, 'Ana', ''),
  ]
  check('L_KEEP', JSON.stringify(keep) === JSON.stringify([{}, {}, { first_name: 'Ana', last_name: 'Rivera' }, { first_name: 'Ana' }]), keep)

  // email hit: no phone lookup, no create
  const l1 = lc.validateLead(body({ email: 'a_b%c@example.com', phone: '(828) 555-0100' }), WNW)
  const s1 = stub({ contacts: () => ({ data: [{ id: 'by-email' }], error: null }) })
  const r1 = await lc.matchOrCreate(s1, l1)
  const like = s1.calls[0].ops.find((o) => o[0] === 'ilike')
  // no email hit: phone lookup by last ten digits, then the oldest exact match
  const s2 = stub({ contacts: (ops) => ops.some((o) => o[0] === 'ilike') ? { data: [], error: null }
    : { data: [{ id: 'other', phone: '+18285550199' }, { id: 'by-phone', phone: '828.555.0100' }], error: null } })
  const r2 = await lc.matchOrCreate(s2, lc.validateLead(body({ phone: '(828) 555-0100' }), WNW))
  // neither: created through hub_intake_contact with the source key
  const s3 = stub()
  const r3 = await lc.matchOrCreate(s3, lc.validateLead(body({ phone: '(828) 555-0100' }), WNW))
  const create = s3.calls.find((c) => c.rpc)
  check('L_MATCH', r1.id === 'by-email' && !r1.created && !s1.calls.some((c) => c.rpc) && s1.calls.length === 1
    && like && like[1][1] === 'a\\_b\\%c@example.com'
    && r2.id === 'by-phone' && !r2.created && !s2.calls.some((c) => c.rpc)
    && r3.id === 'new-id' && r3.created && create.rpc === 'hub_intake_contact' && create.args.p_source_key === 'website:wnw-holiday-checklist'
    && create.args.p_email === 'ana@example.com' && create.args.p_phone === '+18285550100' && create.args.p_first === 'Ana' && create.args.p_last === 'Rivera',
  { r1, like: like && like[1], r2, r3, create })

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})()
