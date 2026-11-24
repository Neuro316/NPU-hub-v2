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
//   L_TAGS_ALL  tags "includes all of" needs every chosen tag (AND); an empty choice matches nobody
//   L_HAS_PHONE has a phone: at least 10 digits, either way round
//   L_HAS_EMAIL has an email: an address with an @ and a domain, either way round
//   L_PIPE_STAGE pipeline and stage together: the stage must be in that pipeline, not in any pipeline
//   L_BOARD_TAGS the pipeline board's tag chips: every chosen tag (AND), none chosen shows every card, the URL round-trips
//
//   emptyall    an empty list matches everyone         {L_EMPTY}
//   missingyes  a no-source field stops being refused  {L_MISSING}
//   unknownyes  an unknown field passes                {L_UNKNOWN}
//   anyall      any is treated as all                  {L_GROUP}
//   nonepass    none is treated as any                 {L_PURCHASE}
//   activity    inactivity ignores the created date    {L_DAYS}
//   consent     texting allowed reads email_allowed    {L_CONSENT}
//   nocheck     checkDefinition stops checking fields  {L_CHECK}
//   tagsany     all of is treated as any of            {L_TAGS_ALL}
//   phoneany    any phone text counts as a phone       {L_HAS_PHONE}
//   emailany    any email text counts as an email      {L_HAS_EMAIL}
//   stageanywhere the pair matches the stage in any pipeline  {L_PIPE_STAGE}
//   boardany    the board shows cards with any chosen tag          {L_BOARD_TAGS}
// TAMPER=1 reddens the union (13).
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
  tagsany: [[F, "if (r.op === 'all') return want.length > 0 && want.every((t) => have.includes(t))", "if (r.op === 'all') return want.some((t) => have.includes(t))"]],
  phoneany: [[F, "export const hasPhone = (p: string | null | undefined) => String(p ?? '').replace(/\\D/g, '').length >= 10", "export const hasPhone = (p: string | null | undefined) => String(p ?? '').trim().length > 0"]],
  emailany: [[F, "export const hasEmail = (e: string | null | undefined) => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(e ?? '').trim())", "export const hasEmail = (e: string | null | undefined) => String(e ?? '').trim().length > 0"]],
  stageanywhere: [[F, "return (f.pipelines ?? []).some((p) => want.includes(pipelineStageValue(p.pipeline_key, p.stage)))", "return (f.pipelines ?? []).some((p) => want.some((w) => w.split('|')[1] === p.stage))"]],
  boardany: [['lib/pipelines/board-tags.ts', 'return cards.filter((c) => chosen.every((t) => (c.tags ?? []).includes(t)))', 'return cards.filter((c) => chosen.some((t) => (c.tags ?? []).includes(t)))']],
}
const RED_OF = {
  emptyall: ['L_EMPTY'], missingyes: ['L_MISSING'], unknownyes: ['L_UNKNOWN'], anyall: ['L_GROUP'],
  nonepass: ['L_PURCHASE'], activity: ['L_DAYS'], consent: ['L_CONSENT'], nocheck: ['L_CHECK'],
  tagsany: ['L_TAGS_ALL'], phoneany: ['L_HAS_PHONE'], emailany: ['L_HAS_EMAIL'], stageanywhere: ['L_PIPE_STAGE'], boardany: ['L_BOARD_TAGS'],
}
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-smartlist')
const load = H.install(out)
const { matches, checkDefinition, missingSources } = load(F)

const NOW = new Date('2026-11-05T12:00:00Z').getTime()
const ago = (d) => new Date(NOW - d * 86400000).toISOString()
const base = {
  contact_id: 'c', tags: ['podcast'], source: 'stripe', contact_type: 'B2C', partnership_type: null, pipelines: [{ pipeline_id: 'p1-uuid', pipeline_key: 'p1', pipeline_name: 'P1', stage_id: 's1-uuid', stage: 'Follow up' }],
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
const miss = [R('no_show', 'is', true), R('no_show', 'is', false), R('webinar_attended', 'is', false)]
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

// the Sensorium outreach filters
const tagged = { ...base, tags: ['sensorium', 'clinic'] }
check('L_TAGS_ALL', m(all(R('tags', 'all', ['sensorium', 'clinic'])), tagged) && !m(all(R('tags', 'all', ['sensorium', 'podcast'])), tagged)
  && !m(all(R('tags', 'all', [])), tagged) && m(all(R('tags', 'any', ['sensorium', 'podcast'])), tagged), 'tags all cases')
check('L_HAS_PHONE', m(all(R('has_phone', 'is', true)), { ...base, phone: '(828) 555-0101' }) && !m(all(R('has_phone', 'is', true)), { ...base, phone: 'n/a' })
  && !m(all(R('has_phone', 'is', true)), { ...base, phone: null }) && m(all(R('has_phone', 'is', false)), { ...base, phone: '555' }), 'phone cases')
check('L_HAS_EMAIL', m(all(R('has_email', 'is', true)), { ...base, email: 'a@b.co' }) && !m(all(R('has_email', 'is', true)), { ...base, email: 'none' })
  && m(all(R('has_email', 'is', false)), { ...base, email: '' }), 'email cases')
const two = { ...base, pipelines: [{ pipeline_id: 'p1-uuid', pipeline_key: 'p1', pipeline_name: 'P1', stage_id: 's1', stage: 'Follow up' },
  { pipeline_id: 'p2-uuid', pipeline_key: 'p2', pipeline_name: 'P2', stage_id: 's2', stage: 'New' }] }
check('L_PIPE_STAGE', m(all(R('pipeline_stage', 'in', ['p1|Follow up'])), two) && m(all(R('pipeline_stage', 'in', ['p2|New'])), two)
  && !m(all(R('pipeline_stage', 'in', ['p1|New'])), two) && !m(all(R('pipeline_stage', 'in', ['p3|Follow up'])), two), 'pipeline and stage cases')
const bt = load('lib/pipelines/board-tags.ts')
const cards = [{ id: 'a', tags: ['sensorium', 'clinic'] }, { id: 'b', tags: ['sensorium'] }, { id: 'c', tags: [] }]
check('L_BOARD_TAGS', bt.filterByTags(cards, ['sensorium', 'clinic']).map((c) => c.id).join() === 'a' && bt.filterByTags(cards, []).length === 3
  && bt.filterByTags(cards, ['sensorium']).length === 2 && bt.parseTags(bt.formatTags(['sensorium', ' clinic '])).join() === 'sensorium,clinic'
  && bt.boardTags(cards).join() === 'clinic,sensorium', bt.filterByTags(cards, ['sensorium', 'clinic']).map((c) => c.id))

H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
