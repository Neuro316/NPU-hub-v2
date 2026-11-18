#!/usr/bin/env node
// scripts/marketing/test-drive-tamper.cjs   (fix/test-drive-run-now: a campaign test drive runs every step now)
//
// Runs the real engine (src/lib/marketing/engine.ts processCampaignSteps), the real exit rules and sweep
// (src/lib/marketing/exits.ts) and the real page logic (src/lib/marketing/ui-logic.ts testDriveView) against an
// in-memory database. The send gate and the claim are recording fakes (dry run). Checks, from intent:
//   D_EXITS   a test drive (source_key manual:test_drive) ignores the campaign's exit rules: a test contact with a
//             cancelled booking still gets the step, and the between-steps sweep never ends a test drive
//   D_DELAYS  a test drive runs its next step on the next engine pass: no step delay
//   D_REAL    a real enrollment is unchanged: the same exit rule ends it (exit_booking_cancelled), its next step
//             waits its full delay, and its steps are not recorded as test steps
//   D_GATE    a test drive still goes through the send gate, so with the gate in dry run nothing is sent for real
//   D_RECORD  each test drive step is recorded (step, channel, decision, reason, send) for the campaign page
//   D_PAGE    the page shows an ended test drive: when it ran and why it ended, or each step's decision, reason, subject
//             and first lines with the name merged; no test drive at all shows the empty state
//
//   exitfortest   the exit rules run for test drives too                     {D_EXITS}
//   delayfortest  test drives wait the step delays                           {D_DELAYS}
//   realskip      every enrollment is treated as a test drive                {D_REAL}
//   skipgate      a test drive skips the gate and is treated as live         {D_GATE}
//   norecord      test drive steps are not recorded                          {D_RECORD}
//   hideended     an ended test drive is shown as no test drive              {D_PAGE}
// TAMPER=1 reddens the sum (6).
const fs = require('fs')
const H = require('../agent/lib/harness.cjs')

const E = 'lib/marketing/engine.ts', X = 'lib/marketing/exits.ts', U = 'lib/marketing/ui-logic.ts'
const TAMPERS = {
  exitfortest: [[E, '  const exit = testDrive ? null : await exitReason(', '  const exit = await exitReason(']],
  delayfortest: [[E, '  const next = () => advance(db, enr, now, testDrive)', '  const next = () => advance(db, enr, now, false)']],
  realskip: [[X, "export const isTestDrive = (sourceKey: unknown): boolean => sourceKey === TEST_DRIVE_SOURCE", 'export const isTestDrive = (sourceKey: unknown): boolean => true']],
  skipgate: [[E, "  const { data: gate, error: gErr } = await db.rpc('gate_check', {",
    "  const { data: gate, error: gErr } = testDrive ? { data: { decision: 'allow', mode: 'live', reason: 'passed', step: 'done', to_address: 'x', consent_event_id: null }, error: null } as any : await db.rpc('gate_check', {"]],
  norecord: [[E, '      if (note.testDrive) await recordTestStep(db, note, r, now)\n', '']],
  hideended: [[U, "  if (td.status === 'active' && !td.steps.length) return { state: 'waiting', startedAt: td.enrolled_at }",
    "  if (td.status !== 'active') return { state: 'none' }\n  if (td.status === 'active' && !td.steps.length) return { state: 'waiting', startedAt: td.enrolled_at }"]],
}
const RED_OF = { exitfortest: ['D_EXITS'], delayfortest: ['D_DELAYS'], realskip: ['D_REAL'], skipgate: ['D_GATE'], norecord: ['D_RECORD'], hideended: ['D_PAGE'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-testdrive')
const load = H.install(out, { '@/lib/sms-split': { SMS_PART_MAX: 320 } })
process.env.HUB_UNSUBSCRIBE_SECRET = 'u'.repeat(48)
const engine = load(E), exits = load(X), ui = load(U)

const ORG = '00000000-0000-0000-0000-000000000001', CAMP = 'camp-1', SEQ = 'seq-1', CONTACT = 'contact-test'
const NOW = new Date('2026-11-18T18:00:00.000Z')

/** A small in-memory table store: eq/neq/is/not/lt/lte/gt/gte/in filters, order, limit, insert, update with select. */
function memDb(seed) {
  const T = JSON.parse(JSON.stringify(seed))
  const writes = [], rpcs = []
  const match = (rows, ops) => {
    let r = rows
    for (const [m, a] of ops) {
      if (m === 'eq') r = r.filter((x) => x[a[0]] === a[1])
      if (m === 'neq') r = r.filter((x) => x[a[0]] !== a[1])
      if (m === 'is') r = r.filter((x) => (x[a[0]] ?? null) === a[1])
      if (m === 'not' && a[1] === 'is') r = r.filter((x) => (x[a[0]] ?? null) !== a[2])
      if (m === 'lte') r = r.filter((x) => x[a[0]] != null && String(x[a[0]]) <= String(a[1]))
      if (m === 'lt') r = r.filter((x) => x[a[0]] != null && String(x[a[0]]) < String(a[1]))
      if (m === 'gt') r = r.filter((x) => x[a[0]] != null && x[a[0]] > a[1])
      if (m === 'gte') r = r.filter((x) => x[a[0]] != null && String(x[a[0]]) >= String(a[1]))
      if (m === 'in') r = r.filter((x) => a[1].includes(x[a[0]]))
    }
    const ord = ops.find((o) => o[0] === 'order')
    if (ord) { const [k, opt] = ord[1]; const asc = !opt || opt.ascending !== false; r = r.slice().sort((p, q) => (p[k] > q[k] ? 1 : p[k] < q[k] ? -1 : 0) * (asc ? 1 : -1)) }
    const lim = ops.find((o) => o[0] === 'limit')
    return lim ? r.slice(0, lim[1][0]) : r
  }
  const db = H.stubDb({}, {
    rpc: (name, args) => {
      rpcs.push({ name, args })
      if (name === 'gate_check') return { data: { decision: 'allow', mode: 'dry_run', reason: 'passed', step: 'done', to_address: 'test@example.com', consent_event_id: null, contact_id: args.p_contact }, error: null }
      if (name === 'claim_send') { const id = `send-${T.message_sends.length + 1}`; T.message_sends.push({ id, status: 'sending', contact_id: args.p_contact, dedupe_key: args.p_dedupe_key, dry_run: args.p_mode === 'dry_run' }); return { data: id, error: null } }
      return { data: null, error: null }
    },
    table: (table, ops, mode) => {
      T[table] = T[table] || []
      const w = ops.find((o) => ['insert', 'update', 'upsert', 'delete'].includes(o[0]))
      if (w) {
        writes.push({ table, op: w[0], payload: w[1][0], where: ops.filter((o) => o[0] === 'eq').map((o) => o[1]) })
        if (w[0] === 'insert') { const row = { id: `${table}-${T[table].length + 1}`, ...w[1][0] }; T[table].push(row); return { data: mode === 'many' ? [row] : row, error: null } }
        const hit = match(T[table], ops)
        for (const r of hit) Object.assign(r, w[1][0])
        return { data: hit.map((r) => ({ id: r.id })), error: null }
      }
      const rows = match(T[table], ops)
      const sel = ops.find((o) => o[0] === 'select')
      if (sel && sel[1][1] && sel[1][1].head) return { data: null, count: rows.length, error: null }
      return mode === 'maybeSingle' || mode === 'single' ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }
    },
  })
  return { db, T, writes, rpcs }
}

const seed = (sourceKey) => ({
  sequence_enrollments: [{ id: 'se-1', sequence_id: SEQ, contact_id: CONTACT, current_step: 1, status: 'active', next_step_at: '2026-11-18T17:00:00.000Z', campaign_enrollment_id: 'ce-1' }],
  campaign_enrollments: [{ id: 'ce-1', status: 'active', campaign_id: CAMP, org_id: ORG, contact_id: CONTACT, enrolled_at: '2026-11-18T17:00:00.000Z', source_key: sourceKey }],
  funnel_campaigns: [{ id: CAMP, org_id: ORG, status: 'active', name: 'Discovery booked', entry_pipeline_id: null, entry_stage_id: null, goal: { exit: { booking_cancelled: true } } }],
  org_settings: [{ org_id: ORG, setting_key: 'hub_marketing_flags', setting_value: { engine: 'on' } }],
  sequence_steps: [
    { id: 'step-1', sequence_id: SEQ, step_order: 1, channel: 'email', kind: 'marketing', step_type: 'message', delay_minutes: 30, subject: 'Looking forward to our call', body: '<p>Hi {{first_name}},</p><p>Thanks for booking.</p><p>Cameron</p>' },
    { id: 'step-2', sequence_id: SEQ, step_order: 2, channel: 'email', kind: 'marketing', step_type: 'message', delay_minutes: 1440, subject: 'Second', body: '<p>Hi {{first_name}},</p><p>Two.</p>' },
  ],
  contacts: [{ id: CONTACT, org_id: ORG, first_name: 'Cameron', last_name: 'Test', email: 'test@example.com', phone: null }],
  hub_booking_syncs: [{ contact_id: CONTACT, status: 'cancelled', first_synced_at: '2026-10-01T00:00:00.000Z' }],
  organizations: [{ id: ORG, name: 'Neuro Progeny' }],
  message_sends: [], contact_timeline: [],
})
const deps = (db) => ({ db, email: { send: async () => { throw new Error('no live email') } }, sms: { send: async () => { throw new Error('no live sms') } }, now: () => NOW, appUrl: 'https://hub.example.com' })
async function pass(sourceKey, noRules = false) {
  const m = memDb(seed(sourceKey))
  if (noRules) m.T.funnel_campaigns[0].goal = {}
  const res = await engine.processCampaignSteps(deps(m.db))
  return { ...m, res: res[0] }
}

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

;(async () => {
  // with the cancelled-booking exit rule: what the rule does to a test drive and to a real enrollment
  const test = await pass('manual:test_drive')
  const real = await pass('lifecycle:discovery_booked')
  // without exit rules: a plain test drive step, for the delay, gate and record checks
  const plain = await pass('manual:test_drive', true)

  // D_EXITS: the test drive ran the step despite the cancelled booking; the sweep skips test drives
  {
    const sweepQuery = memDb(seed('manual:test_drive'))
    const swept = await exits.sweepCampaignExits(sweepQuery.db, NOW)
    const ce = sweepQuery.T.campaign_enrollments[0]
    check('D_EXITS', !test.res.outcome.startsWith('exited_') && test.res.outcome !== 'error' && test.T.campaign_enrollments[0].status === 'active' && ce.status === 'active' && !swept.booking_cancelled,
      { outcome: test.res.outcome, status: test.T.campaign_enrollments[0].status, swept })
  }

  // D_DELAYS: the next step is due now, not in 1440 minutes
  {
    const se = plain.T.sequence_enrollments[0]
    check('D_DELAYS', se.current_step === 2 && se.next_step_at === NOW.toISOString(), { current_step: se.current_step, next_step_at: se.next_step_at })
  }

  // D_REAL: the real enrollment exits on the same rule; a real step's next step waits its delay
  {
    const ce = real.T.campaign_enrollments[0]
    const noRule = memDb(seed('lifecycle:discovery_booked'))
    noRule.T.funnel_campaigns[0].goal = {}
    const r2 = await engine.processCampaignSteps(deps(noRule.db))
    const se = noRule.T.sequence_enrollments[0]
    const waits = se.current_step === 2 && se.next_step_at === new Date(NOW.getTime() + 1440 * 60_000).toISOString()
    const recorded = noRule.T.contact_timeline.filter((t) => t.event_type === 'campaign_test_step').length
    check('D_REAL', real.res.outcome === 'exited_booking_cancelled' && ce.status === 'exited' && ce.end_reason === 'exit_booking_cancelled' && r2[0].outcome.startsWith('dry_run_') && waits && recorded === 0,
      { realOutcome: real.res.outcome, end_reason: ce.end_reason, waitsUntil: se.next_step_at, recorded })
  }

  // D_GATE: the gate was asked, and the result is a dry run: nothing sent, the send row is a dry run
  {
    const asked = plain.rpcs.some((r) => r.name === 'gate_check' && r.args.p_contact === CONTACT)
    const send = plain.T.message_sends[0]
    check('D_GATE', asked && plain.res.mode === 'dry_run' && send && send.dry_run === true, { asked, mode: plain.res.mode, dry: send?.dry_run })
  }

  // D_RECORD: one timeline record for the test drive step, none for the real enrollment
  {
    const rec = plain.T.contact_timeline.filter((t) => t.event_type === 'campaign_test_step')
    const m = rec[0]?.metadata ?? {}
    check('D_RECORD', rec.length === 1 && rec[0].source_id === 'ce-1' && m.campaign_id === CAMP && m.step_order === 1 && m.channel === 'email'
      && m.decision === 'allow' && m.reason === 'passed' && m.send_id === 'send-1',
      { records: rec.length, meta: m })
  }

  // D_PAGE: ended early with no steps, ended with a step (merged name in the preview), and none
  {
    const ended = ui.testDriveView({ enrollment_id: 'ce-1', status: 'exited', enrolled_at: '2026-11-18T17:00:00Z', ended_at: '2026-11-18T17:05:00Z', end_reason: 'exit_booking_cancelled', steps: [] })
    const withStep = ui.testDriveView({ enrollment_id: 'ce-2', status: 'completed', enrolled_at: '2026-11-18T17:00:00Z', ended_at: '2026-11-18T17:20:00Z', end_reason: 'sequence_finished', steps: [
      { at: '2026-11-18T17:05:00Z', step_order: 1, channel: 'email', outcome: 'dry_run_advanced', mode: 'dry_run', decision: 'allow', reason: 'passed', send_status: 'sending', skip_reason: null,
        subject: 'Looking forward to our call', rendered_body: '<p>Hi Cameron,</p><p>Thanks for booking a discovery call.</p><p>Here is what to expect.</p><p>More.</p>' }] })
    const none = ui.testDriveView(null)
    const s = withStep.steps?.[0]
    check('D_PAGE', ended.state === 'ended_early' && /cancelled/i.test(ended.ending ?? '') && ended.startedAt === '2026-11-18T17:00:00Z'
      && withStep.state === 'finished' && s && /^Allowed, as a dry run/.test(s.verdict) && s.why === 'Every check passed.' && s.subject === 'Looking forward to our call'
      && s.preview.startsWith('Hi Cameron,') && !s.preview.includes('{{') && s.preview.split('\n').length === 3 && none.state === 'none',
      { ended: ended.state, ending: ended.ending, withStep: withStep.state, preview: s?.preview })
  }

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})()
