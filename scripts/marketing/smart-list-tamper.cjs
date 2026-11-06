#!/usr/bin/env node
// scripts/marketing/smart-list-tamper.cjs
//
// A list decides who a campaign reaches, so the real matcher must never widen. Checks:
//   L_EMPTY     a list with no filters has no members
//   L_MISSING   a field with no data source matches nobody, in either direction
//   L_UNKNOWN   an unknown field matches nobody
//   L_GROUP     all means every filter, any means at least one
//   L_PURCHASE  any and none, with the date range
//   L_DAYS      engagement windows; a contact never touched counts from its created date
//   L_CONSENT   consent filters read the computed flags
//   L_CHECK     checkDefinition refuses a bad field or operator
//
//   emptyall    an empty list matches everyone         {L_EMPTY}
//   missingyes  a no-source field stops being refused  {L_MISSING}
//   unknownyes  an unknown field passes                {L_UNKNOWN}
//   anyall      any is treated as all                  {L_GROUP}
//   nonepass    none is treated as any                 {L_PURCHASE}
//   activity    inactivity ignores the created date    {L_DAYS}
//   consent     texting allowed reads email_allowed    {L_CONSENT}
//   nocheck     checkDefinition stops checking fields  {L_CHECK}
// TAMPER=1 reddens the union (8).
const fs = require('fs')
const H = require('../agent/lib/harness.cjs')

const F = 'lib/marketing/smart-lists/match.ts'
const TAMPERS = {
  emptyall: [[F, 'd.rules.length === 0) return false', 'd.rules.length === 0) return true']],
  missingyes: [[F, 'if (def.noDataSource) return false', 'if (def.noDataSource) return true']],
  unknownyes: [[F, 'if (!def) return false', 'if (!def) return true']],
  anyall: [[F, "d.match === 'any' ? d.rules.some(", "d.match === 'any' ? d.rules.every("]],
  nonepass: [[F, "const hit = purchasesInRange(f, r).some((p) => want.includes(p.key))\n      return r.op === 'any' ? hit : !hit", 'const hit = purchasesInRange(f, r).some((p) => want.includes(p.key))\n      return hit']],
  activity: [[F, 'f.last_activity_at ?? f.created_at', 'f.last_activity_at']],
  consent: [[F, 'return f.texting_allowed === yes', 'return f.email_allowed === yes']],
  nocheck: [[F, "if (!def) return { ok: false, message: 'One filter uses a field that does not exist.' }", "if (!def) { rules.push(r); continue }"]],
}
const RED_OF = {
  emptyall: ['L_EMPTY'], missingyes: ['L_MISSING'], unknownyes: ['L_UNKNOWN'], anyall: ['L_GROUP'],
  nonepass: ['L_PURCHASE'], activity: ['L_DAYS'], consent: ['L_CONSENT'], nocheck: ['L_CHECK'],
}
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-smartlist')
const load = H.install(out)
const { matches, checkDefinition, missingSources } = load(F)

const NOW = new Date('2026-11-05T12:00:00Z').getTime()
const ago = (d) => new Date(NOW - d * 86400000).toISOString()
const base = {
  contact_id: 'c', tags: ['podcast'], source: 'stripe', contact_type: 'B2C', partnership_type: null, pipeline_id: 'p1', pipeline_stage: 'Follow up',
  brand: 'np', created_at: ago(200), last_activity_at: null, last_open_at: ago(10), last_click_at: null, booked_at: null, booking_types: [],
  client_reasons: [], email_allowed: true, texting_allowed: false,
  purchases: [{ key: 'clarity-protocol', name: 'Clarity', at: ago(40) }],
}
const all = (...rules) => ({ match: 'all', rules })
const any = (...rules) => ({ match: 'any', rules })
const m = (d, f = base) => matches(d, f, NOW)
const R = (field, op, value, extra = {}) => ({ field, op, value, ...extra })

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

check('L_EMPTY', !m(all()) && !m(any()), { all: m(all()), any: m(any()) })
const miss = [R('no_show', 'is', true), R('no_show', 'is', false), R('webinar_attended', 'is', false), R('quiz_archetype', 'in', ['x']), R('lead_device', 'in', ['x'])]
check('L_MISSING', miss.every((r) => !m(all(r))) && missingSources(all(miss[0])).length === 1, miss.map((r) => m(all(r))))
check('L_UNKNOWN', !m(all(R('nope', 'is', true))), m(all(R('nope', 'is', true))))
const yes = R('source', 'in', ['stripe']), no = R('source', 'in', ['other'])
check('L_GROUP', !m(all(yes, no)) && m(any(yes, no)) && !m(any(no)), { allMixed: m(all(yes, no)), anyMixed: m(any(yes, no)), anyNone: m(any(no)) })
const clarity = ['clarity-protocol']
check('L_PURCHASE',
  m(all(R('purchase', 'any', clarity))) && !m(all(R('purchase', 'none', clarity)))
  && m(all(R('purchase', 'none', ['other'])))
  && m(all(R('purchase', 'any', clarity, { since: '2026-09-01' }))) && !m(all(R('purchase', 'any', clarity, { since: '2026-11-01' })))
  && m(all(R('purchase', 'none', clarity, { until: '2026-01-01' }))), 'purchase cases')
check('L_DAYS',
  m(all(R('opened_days', 'lte', 30))) && !m(all(R('opened_days', 'lte', 5))) && !m(all(R('clicked_days', 'lte', 90)))
  && m(all(R('inactive_days', 'gte', 90))) && !m(all(R('inactive_days', 'gte', 90)), { ...base, created_at: ago(5) })
  && !m(all(R('inactive_days', 'gte', 90)), { ...base, last_activity_at: ago(5) }), 'days cases')
check('L_CONSENT', m(all(R('email_allowed', 'is', true))) && !m(all(R('texting_allowed', 'is', true))) && m(all(R('texting_allowed', 'is', false))), 'consent cases')
const bad = [{ match: 'all', rules: [R('nope', 'is', true)] }, { match: 'all', rules: [R('stage', 'lte', 3)] }, { match: 'some', rules: [] }]
check('L_CHECK', bad.every((d) => !checkDefinition(d).ok) && checkDefinition(all(yes)).ok, bad.map((d) => checkDefinition(d).ok))

H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
