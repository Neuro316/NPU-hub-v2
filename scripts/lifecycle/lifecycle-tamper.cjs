#!/usr/bin/env node
// scripts/lifecycle/lifecycle-tamper.cjs
//
// The lifecycle engine's rules (src/lib/lifecycle/rules.ts) and its dry-run boundary (ledger.ts). Checks, each
// declared from what the rule is for:
//   L_MODE      only the exact string 'live' is live; 'dry_run' is dry; anything else (LIVE, true, missing) is off
//   L_ROUTE     a lead route needs a pipeline and a stage; malformed entries are dropped, never guessed
//   L_TAG       a brand tag is added only when the contact has neither brand tag, so a hand edit is never overwritten
//   L_PRODUCT   purchases are classified to the right product (phases, assessment, Fresh Air, WNW, coaching)
//   L_FORWARD   Enrolled moves only forward; only Drop-off risk goes back to Active; Completed is never left
//   L_ACTIONS   a coaching purchase is recorded only; a no-show opens a task and starts Discovery no-show; 3 quiet
//               days move to Drop-off risk and start Drop-off nudge
//   L_CLOSE     each event closes exactly the task reasons it should (a booking never closes the held-no-purchase task)
//   L_LEADTASK  a lead is owed a task only after 24 hours with no touch and no booking of their own
//   L_INACTIVE  3 days quiet is risk, 7 days is the task (2 days is not risk)
//   L_DRYRUN    in dry_run the only write is the ledger row; applying pending rows makes no call at all; off writes nothing
//
//   liveany     any truthy mode other than dry_run is live              {L_MODE}
//   leadnostage a lead route without a stage is kept                    {L_ROUTE}
//   tagover     the brand tag is added over an existing one             {L_TAG}
//   phasemix    Phase 3 is classified as Phase 2                        {L_PRODUCT}
//   backward    an Enrolled move may go backward                        {L_FORWARD}
//   coachbuys   a coaching purchase moves Enrolled and starts onboarding {L_ACTIONS}
//   closeall    every event closes every task                           {L_CLOSE}
//   early       the lead task is owed after 2 hours                     {L_LEADTASK}
//   idle4       risk after 2 quiet days                                 {L_INACTIVE}
//   dryapply    pending rows are applied in dry_run                     {L_DRYRUN}
// TAMPER=1 reddens the union (10).
const fs = require('fs')
const H = require('../agent/lib/harness.cjs')

const R = 'lib/lifecycle/rules.ts', L = 'lib/lifecycle/ledger.ts'
const TAMPERS = {
  liveany: [[R, "r.mode === 'live' ? 'live' : r.mode === 'dry_run' ? 'dry_run' : 'off'", "r.mode === 'dry_run' ? 'dry_run' : r.mode ? 'live' : 'off'"]],
  leadnostage: [[R, '    if (!pipeline || !stage) continue\n', '']],
  tagover: [[R, '  if (Object.values(BRAND_TAG).some((t) => have.has(t.toLowerCase()))) return null\n', '']],
  phasemix: [[R, "if (/phase 3/.test(s)) return 'phase_3'", "if (/phase 3/.test(s)) return 'phase_2'"]],
  backward: [[R, 'return idx(current) < idx(want) ? want : null', 'return idx(current) !== idx(want) ? want : null']],
  coachbuys: [[R, "if (event === 'purchase' && !ENROLLING_PRODUCTS.includes(product as Product)) return { exit: ['checkout_recovery'] }\n", '']],
  closeall: [[R, 'return (Object.keys(TASK_CLOSERS) as TaskReason[]).filter((r) => TASK_CLOSERS[r].some((c) => closers.includes(c)))', 'return Object.keys(TASK_CLOSERS) as TaskReason[]']],
  early: [[R, 'export const LEAD_TOUCH_HOURS = 24', 'export const LEAD_TOUCH_HOURS = 2']],
  idle4: [[R, 'export const INACTIVE_DAYS = { risk: 3, task: 7 } as const', 'export const INACTIVE_DAYS = { risk: 2, task: 7 } as const']],
  dryapply: [[L, "  if (cfg.mode !== 'live') return out\n", "  if (cfg.mode === 'off') return out\n"]],
}
const RED_OF = {
  liveany: ['L_MODE'], leadnostage: ['L_ROUTE'], tagover: ['L_TAG'], phasemix: ['L_PRODUCT'], backward: ['L_FORWARD'],
  coachbuys: ['L_ACTIONS'], closeall: ['L_CLOSE'], early: ['L_LEADTASK'], idle4: ['L_INACTIVE'], dryapply: ['L_DRYRUN'],
}
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-lifecycle')
const load = H.install(out)
const rules = load(R)
const ledger = load(L)

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
const ORG = '00000000-0000-0000-0000-000000000001'
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// L_MODE
const modes = [['live', 'live'], ['dry_run', 'dry_run'], ['LIVE', 'off'], [true, 'off'], ['on', 'off'], [undefined, 'off'], ['', 'off']]
const gotModes = modes.map(([m]) => rules.parseConfig(ORG, m === undefined ? {} : { mode: m }).mode)
check('L_MODE', modes.every(([, want], i) => gotModes[i] === want) && rules.parseConfig(ORG, null).mode === 'off', gotModes)

// L_ROUTE
const routes = rules.parseTypeRoutes({
  [U(1)]: { kind: 'lead', brand: 'np', pipeline: 'default', stage: 'Discovery call Scheduled' },
  [U(2)]: { kind: 'lead', brand: 'wnw', pipeline: 'default' },
  [U(3)]: { kind: 'activity', brand: 'wnw', pipeline: 'x', stage: 'y' },
  [U(4)]: { kind: 'lead', pipeline: 'default', stage: 'S' },
  [U(5)]: { kind: 'other', brand: 'np' },
  'not-a-uuid': { kind: 'activity', brand: 'np' },
})
check('L_ROUTE', routes.size === 2 && routes.get(U(1)).stage === 'Discovery call Scheduled' && routes.get(U(3)).kind === 'activity'
  && routes.get(U(3)).pipeline === null && !routes.has(U(2)) && rules.parseTypeRoutes([]).size === 0, Array.from(routes.keys()))

// L_TAG
const tagCases = [[[], 'wnw', 'WNW'], [['vip'], 'np', 'Neuro Progeny'], [['WNW'], 'np', null], [['neuro progeny'], 'wnw', null], [[' Wnw '], 'wnw', null], [null, 'np', 'Neuro Progeny']]
const gotTags = tagCases.map(([t, b]) => rules.brandTagToAdd(t, b))
check('L_TAG', tagCases.every(([, , want], i) => gotTags[i] === want), gotTags)

// L_PRODUCT
const WNW = U(9)
const prod = [
  [{ programName: 'Capacity Protocol', paywallSlug: 'capacity-protocol' }, 'phase_1'],
  [{ programName: 'Capacity Protocol', paywallSlug: 'capacity-protocol-phases-1-2-3' }, 'phase_1'],
  [{ programName: 'Capacity Protocol Phase 2', paywallSlug: 'capacity-protocol-phases-2-3' }, 'phase_2'],
  [{ programName: 'Capacity Protocol Phase 3', paywallSlug: 'capacity-protocol-phase-3' }, 'phase_3'],
  [{ programName: 'Capacity Assessment' }, 'assessment'],
  [{ paywallSlug: 'fresh-air-app' }, 'fresh_air'],
  [{ programName: 'Eleven 60 Minute Coaching sessions', orgId: WNW }, 'wnw'],
  [{ programName: 'Waynesville Neuro Wellness' }, 'wnw'],
  [{ programName: '30 Minute Coaching, 5 Sessions' }, 'coaching'],
  [{ programName: 'Clarity Program' }, 'clarity'],
  [{ programName: 'The Limbic Loop' }, 'other'],
]
const gotProd = prod.map(([p]) => rules.classifyProduct(p, WNW))
check('L_PRODUCT', prod.every(([, want], i) => gotProd[i] === want), gotProd)

// L_FORWARD
const fw = [
  [null, 'Purchased', 'Purchased'], ['Purchased', 'Consent signed', 'Consent signed'], ['Active', 'Onboarded', null],
  ['Active', 'Drop-off risk', 'Drop-off risk'], ['Drop-off risk', 'back_to_active', 'Active'], ['Onboarded', 'back_to_active', null],
  ['Completed', 'Drop-off risk', null], ['Completed', 'back_to_active', null], ['Started course', 'Purchased', 'Purchased'], ['Active', 'Active', null],
]
const gotFw = fw.map(([c, w]) => rules.enrolledTarget(c, w))
check('L_FORWARD', fw.every(([, , want], i) => gotFw[i] === want), gotFw)

// L_ACTIONS
const coach = rules.actionsFor('purchase', 'coaching'), phase = rules.actionsFor('purchase', 'phase_1')
const ns = rules.actionsFor('booking_no_show', null), idle = rules.actionsFor('inactive_5d', null)
check('L_ACTIONS', !coach.enrolled && !coach.enroll && phase.enrolled === 'Purchased' && phase.enroll === 'client_onboarding'
  && ns.openTask === 'discovery_no_show' && ns.enroll === 'discovery_no_show' && idle.enrolled === 'Drop-off risk' && idle.enroll === 'dropoff_nudge'
  && rules.actionsFor('activity_resumed', null).enrolled === 'back_to_active', { coach, ns, idle })

// L_CLOSE
const closes = {
  booking_made: ['discovery_no_show', 'lead_no_touch_24h'],
  purchase: ['discovery_no_show', 'held_no_purchase_2d', 'lead_no_touch_24h'],
  coaching_held: ['enrolled_inactive_10d'],
  program_end: ['enrolled_inactive_10d'],
  inactive_5d: [],
}
const gotClose = Object.fromEntries(Object.keys(closes).map((e) => [e, rules.tasksClosedBy(e).slice().sort()]))
check('L_CLOSE', Object.entries(closes).every(([e, want]) => JSON.stringify(gotClose[e]) === JSON.stringify(want)), gotClose)

// L_LEADTASK
const H1 = 3_600_000, T0 = Date.UTC(2026, 10, 10)
const lt = [
  [T0, null, null, T0 + 23 * H1, false], [T0, null, null, T0 + 25 * H1, true], [T0, T0 + H1, null, T0 + 25 * H1, false],
  [T0, T0 - H1, null, T0 + 25 * H1, true], [T0, null, T0 + 2 * H1, T0 + 25 * H1, false], [T0, null, null, T0 + 3 * H1, false],
]
const gotLt = lt.map(([c, t, b, n]) => rules.leadOwedTask(c, t, b, n))
check('L_LEADTASK', lt.every((x, i) => gotLt[i] === x[4]), gotLt)

// L_INACTIVE
const D = 86_400_000
const ina = [[2, []], [2.9, []], [3, ['inactive_5d']], [6.9, ['inactive_5d']], [7, ['inactive_5d', 'inactive_10d']]]
const gotIna = ina.map(([d]) => rules.inactivityDue(T0, T0 + d * D))
check('L_INACTIVE', ina.every(([, want], i) => JSON.stringify(gotIna[i]) === JSON.stringify(want)), gotIna)

// L_DRYRUN
;(async () => {
  const ev = { orgId: ORG, contactId: U(7), type: 'booking_no_show', key: 'booking:x:no_show', occurredAt: new Date(T0).toISOString(), source: 'nr_bookings', sourceId: 'x' }
  const pending = [{ id: U(8), org_id: ORG, contact_id: U(7), event_type: 'booking_no_show', event_key: 'k', occurred_at: ev.occurredAt, mode: 'live', applied_at: null, detail: {} }]
  const dryDb = H.stubDb({ hub_lifecycle_events: pending })
  const dry = rules.parseConfig(ORG, { mode: 'dry_run', assignee: U(6) })
  const r1 = await ledger.recordEvent(dryDb, dry, ev)
  const written = dryDb.calls.filter((c) => c.ops && c.ops.some((o) => ['insert', 'update', 'upsert', 'delete'].includes(o[0]))).map((c) => c.table)
  const before = dryDb.calls.length
  let applyThrew = null
  const applied = await ledger.applyPending(dryDb, dry, ORG, Date.now() + 5000).catch((e) => { applyThrew = String(e && e.message); return null })
  const applyCalls = dryDb.calls.length - before
  const upsert = dryDb.calls.find((c) => c.table === 'hub_lifecycle_events').ops.find((o) => o[0] === 'upsert')[1][0]
  const offDb = H.stubDb({})
  await ledger.recordEvent(offDb, rules.parseConfig(ORG, {}), ev)
  check('L_DRYRUN', r1 === 'new' && JSON.stringify(written) === JSON.stringify(['hub_lifecycle_events']) && upsert.mode === 'dry_run'
    && upsert.planned.open_task === 'discovery_no_show' && applyCalls === 0 && !applyThrew && applied && applied.applied === 0 && offDb.calls.length === 0,
  { written, applyCalls, applyThrew, mode: upsert.mode, off: offDb.calls.length })

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})()
