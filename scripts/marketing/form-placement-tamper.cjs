#!/usr/bin/env node
// scripts/marketing/form-placement-tamper.cjs   (Running List q08, Hub half: website form leads into Sales)
//
// Runs the real src/lib/marketing/form-placement.ts against an in-memory database. Checks, from intent:
//   F_NEW       a contact CREATED by an accepted submission of a routed form is placed at the route's stage
//               (Sales › New Lead), forward only, with the source form:<slug>
//   F_EXISTING  a contact that existed before the submission is never placed (a client signing up for the
//               newsletter does not become a Sales lead)
//   F_OUTCOME   only accepted submissions place anything: a received (mid-flight) submission places nothing
//   F_UNROUTED  a form with no route places nothing, and a malformed route is dropped, never guessed
//
//   noplace     the placement call is skipped                         {F_NEW}
//   existing    existing contacts are placed too                      {F_EXISTING}
//   anyoutcome  any submission outcome places                         {F_OUTCOME}
//   fallback    a form with no route borrows another form's route     {F_UNROUTED}
// TAMPER=1 reddens the sum (4).
const fs = require('fs')
const H = require('../agent/lib/harness.cjs')

const F = 'lib/marketing/form-placement.ts'
const TAMPERS = {
  noplace: [[F, 'const r = await placeByName(db, row.org_id, s.contact_id, route.pipeline, route.stage, true, `form:${sub.form_slug}`)', "const r = { placed: false, reason: 'skipped' } as any; void placeByName"]],
  existing: [[F, '  if (Date.parse(contactCreatedAt) < Date.parse(s.created_at) - 60_000) return null\n', '']],
  anyoutcome: [[F, "  if (s.outcome !== 'accepted' || !s.contact_id || !contactCreatedAt) return null", '  if (!s.contact_id || !contactCreatedAt) return null'],
    [F, ".eq('outcome', 'accepted').gte('created_at', since)", ".gte('created_at', since)"]],
  fallback: [[F, '  const route = routes.get(s.form_slug)\n', '  const route = routes.get(s.form_slug) ?? Array.from(routes.values())[0]\n']],
}
const RED_OF = { noplace: ['F_NEW'], existing: ['F_EXISTING'], anyoutcome: ['F_OUTCOME'], fallback: ['F_UNROUTED'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-formplace')
const load = H.install(out)
const fp = load(F)

const ORG = '00000000-0000-0000-0000-000000000001'
const SALES = 'd2aa430f-84fb-45e1-be3c-95958403d4d6', NEW_LEAD = '1c45635a-bac8-42c0-9a5e-26982cd635f5'
const NOW = new Date('2026-11-17T18:00:00Z')
const T = (h) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const DATA = {
  org_settings: [{ org_id: ORG, setting_key: 'hub_form_routes', setting_value: {
    'np-website-contact': { pipeline: 'default', stage: 'New Lead' },
    'np-newsletter': { pipeline: 'default', stage: 'New Lead' },
    'Bad Slug': { pipeline: 'default', stage: 'New Lead' },
    'np-no-stage': { pipeline: 'default' },
  } }],
  form_definitions: [{ id: 'f1', org_id: ORG, slug: 'np-website-contact' }, { id: 'f2', org_id: ORG, slug: 'np-newsletter' }],
  form_submissions: [
    { id: 's1', org_id: ORG, form_id: 'f1', contact_id: 'c-new', outcome: 'accepted', created_at: T(1) },
    { id: 's2', org_id: ORG, form_id: 'f2', contact_id: 'c-old', outcome: 'accepted', created_at: T(2) },
    { id: 's3', org_id: ORG, form_id: 'f1', contact_id: 'c-mid', outcome: 'received', created_at: T(3) },
  ],
  contacts: [
    { id: 'c-new', created_at: T(1), merged_into_id: null },
    { id: 'c-old', created_at: T(24 * 30), merged_into_id: null },
    { id: 'c-mid', created_at: T(3), merged_into_id: null },
  ],
  pipelines: [{ id: SALES, org_id: ORG, legacy_key: 'default', name: 'Sales Pipeline', position: 0, archived_at: null }],
  pipeline_stages: [{ id: NEW_LEAD, org_id: ORG, pipeline_id: SALES, legacy_key: 's1', name: 'New Lead', position: 0, color: null, is_closed_won: false, is_closed_lost: false, archived_at: null }],
}
const rpcs = []
const db = H.stubDb(DATA, {
  rpc: (name, args) => { rpcs.push({ name, args }); return name === 'hub_pipeline_place' ? { data: { placed: true, moved: false }, error: null } : undefined },
  table: (table, ops) => {
    let rows = (DATA[table] || []).slice()
    for (const [m, a] of ops) {
      if (m === 'eq') rows = rows.filter((r) => r[a[0]] === a[1])
      if (m === 'is') rows = rows.filter((r) => (r[a[0]] ?? null) === a[1])
      if (m === 'in') rows = rows.filter((r) => a[1].includes(r[a[0]]))
      if (m === 'gte') rows = rows.filter((r) => String(r[a[0]]) >= String(a[1]))
    }
    return undefined === rows ? undefined : { data: rows, error: null, __rows: true }
  },
})
// stubDb returns the handler's result for every mode; single rows for maybeSingle
const origFrom = db.from.bind(db)
db.from = (table) => {
  const b = origFrom(table)
  const ms = b.maybeSingle
  b.maybeSingle = () => ({ then: (res, rej) => ms().then((r) => ({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error })).then(res, rej) })
  return b
}

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

;(async () => {
  const counts = await fp.runFormPlacement(db, NOW, Date.now() + 10_000)
  const placed = rpcs.filter((r) => r.name === 'hub_pipeline_place').map((r) => r.args)
  const placedIds = placed.map((a) => a.p_contact)

  const nw = placed.find((a) => a.p_contact === 'c-new')
  check('F_NEW', !!nw && nw.p_stage === NEW_LEAD && nw.p_only_forward === true && nw.p_source === 'form:np-website-contact', { placed, counts })
  // the decision itself, so these checks never depend on the placement call running
  const routes = fp.parseFormRoutes(DATA.org_settings[0].setting_value)
  const sub = (s, slug) => ({ ...s, form_slug: slug })
  const oldDecision = fp.placementFor(sub(DATA.form_submissions[1], 'np-newsletter'), DATA.contacts[1].created_at, routes)
  const midDecision = fp.placementFor(sub(DATA.form_submissions[2], 'np-website-contact'), DATA.contacts[2].created_at, routes)
  const subCalls = db.calls.filter((c) => c.table === 'form_submissions')
  const acceptedOnly = subCalls.length > 0 && subCalls.every((c) => c.ops.some((o) => o[0] === 'eq' && o[1][0] === 'outcome' && o[1][1] === 'accepted'))
  check('F_EXISTING', oldDecision === null && !placedIds.includes('c-old'), { oldDecision, placedIds })
  check('F_OUTCOME', midDecision === null && acceptedOnly && !placedIds.includes('c-mid'), { midDecision, acceptedOnly, placedIds })

  const unrouted = fp.placementFor({ id: 'x', org_id: ORG, contact_id: 'c-x', outcome: 'accepted', created_at: T(1), form_slug: 'np-unrouted' }, T(1), routes)
  check('F_UNROUTED', unrouted === null && routes.size === 2 && !routes.has('Bad Slug') && !routes.has('np-no-stage'), { unrouted, keys: Array.from(routes.keys()) })

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})()
