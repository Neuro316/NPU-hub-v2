#!/usr/bin/env node
// scripts/marketing/speed-to-lead-tamper.cjs
//
// Speed-to-lead alerts (src/lib/lead-alerts) and campaign exit rules (src/lib/marketing/exits.ts). Checks:
//   L_QUIET   8 PM to 8 AM Eastern queues to the next 8 AM (across the DST change too); daytime is now; a booking
//             starting within 24 hours is now even at night, and one starting later waits
//   L_TEXT    the SMS carries name, source, what they did, phone, email and the card link, and nothing else; untrusted
//             text is one capped line; the Slack text escapes < > &
//   L_CONFIG  only enabled 'on' with a recipient turns alerts on; leads before `since` or the lookback never alert
//   L_ONCE    a channel that already went out is never sent again; a refused SMS is final, not retried
//   L_LOGS    nothing in src/lib/lead-alerts or the two routes logs a name, an email, a phone or the message text
//   E_PARSE   exit rules keep only well-formed values: a bad stage id or an unknown payment mode is dropped, never widened
//   E_ENGINE  the engine checks exit rules before the send gate on every step, and skips an unfilled [[placeholder]]
//             before a dry run or a live send can use it
//
//   quietoff    quiet hours are ignored                         {L_QUIET}
//   urgentall   every night booking counts as urgent            {L_QUIET}
//   noescape    the Slack text is not escaped                   {L_TEXT}
//   truthy      any truthy enabled value turns alerts on        {L_CONFIG}
//   resend      a channel already sent is sent again            {L_ONCE}
//   logname     the delivery logs the person's name             {L_LOGS}
//   widen       any string counts as an exit stage              {E_PARSE}
//   noexit      the engine skips the exit check                 {E_ENGINE}
//   placelive   an unfilled placeholder can be sent             {E_ENGINE}
// TAMPER=1 reddens the union (7).
const fs = require('fs'), path = require('path')
const H = require('../agent/lib/harness.cjs')

const C = 'lib/lead-alerts/compose.ts', R = 'lib/lead-alerts/run.ts', X = 'lib/marketing/exits.ts', ENG = 'lib/marketing/engine.ts'
const TAMPERS = {
  quietoff: [[C, '  if (!inQuietHours(now)) return now\n', '  return now\n']],
  urgentall: [[C, "if (source === 'booking' && startsAt && startsAt.getTime() - now.getTime() <= BOOKING_URGENT_MS) return now", "if (source === 'booking') return now"]],
  noescape: [[C, "return composeAlert(f, appUrl).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')", 'return composeAlert(f, appUrl)']],
  truthy: [[R, "enabled: v.enabled === 'on' && !!rid", 'enabled: !!v.enabled && !!rid']],
  resend: [[R, "  if (sms !== 'sent') {\n", '  if (true) {\n']],
  logname: [[R, "  const uid = cfg.recipientUserId!\n", "  const uid = cfg.recipientUserId!\n  console.info(`[lead-alerts] alert=${a.id} for ${loaded.facts.name}`)\n"]],
  widen: [[X, "e.stages.filter((x: unknown) => typeof x === 'string' && UUID.test(x))", "e.stages.filter((x: unknown) => typeof x === 'string')"]],
  noexit: [[ENG, "  if (exit) {\n    await endAsExited(db, ce.id, exit, now)\n    return { ...base, outcome: `exited_${exit}` }\n  }\n", '']],
  placelive: [[ENG, "    if (PLACEHOLDER.test(`${r.subject}\\n${r.text}`)) {", '    if (false) {']],
}
const RED_OF = { quietoff: ['L_QUIET'], urgentall: ['L_QUIET'], noescape: ['L_TEXT'], truthy: ['L_CONFIG'], resend: ['L_ONCE'], logname: ['L_LOGS'],
  widen: ['E_PARSE'], noexit: ['E_ENGINE'], placelive: ['E_ENGINE'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-speedtolead')
const load = H.install(out)
const compose = load(C)
const run = load(R)
const exits = load(X)
const engine = load(ENG)

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
const iso = (d) => d.toISOString()

// ── L_QUIET ── (2026-11-10 is EST, UTC-5; 2026-10-30 is EDT, UTC-4; DST ends 2026-11-01)
{
  const { alertDueAt } = compose
  const cases = [
    ['noon EST is now', alertDueAt('form', new Date('2026-11-10T17:00:00Z'), null), '2026-11-10T17:00:00.000Z'],
    ['9 PM EST waits for 8 AM', alertDueAt('lead_device', new Date('2026-11-11T02:00:00Z'), null), '2026-11-11T13:00:00.000Z'],
    ['6 AM EST waits for 8 AM', alertDueAt('university_signup', new Date('2026-11-10T11:00:00Z'), null), '2026-11-10T13:00:00.000Z'],
    ['7:59 PM EST is now', alertDueAt('form', new Date('2026-11-11T00:59:00Z'), null), '2026-11-11T00:59:00.000Z'],
    ['8 PM EST waits', alertDueAt('form', new Date('2026-11-11T01:00:00Z'), null), '2026-11-11T13:00:00.000Z'],
    ['11 PM EDT the night before DST ends waits for 8 AM EST', alertDueAt('form', new Date('2026-11-01T03:00:00Z'), null), '2026-11-01T13:00:00.000Z'],
    ['10 PM EDT waits for 8 AM EDT', alertDueAt('form', new Date('2026-10-30T02:00:00Z'), null), '2026-10-30T12:00:00.000Z'],
    ['night booking in 10 h is now', alertDueAt('booking', new Date('2026-11-11T03:00:00Z'), new Date('2026-11-11T13:00:00Z')), '2026-11-11T03:00:00.000Z'],
    ['night booking in 30 h waits', alertDueAt('booking', new Date('2026-11-11T03:00:00Z'), new Date('2026-11-12T09:00:00Z')), '2026-11-11T13:00:00.000Z'],
    ['night booking with no start waits', alertDueAt('booking', new Date('2026-11-11T03:00:00Z'), null), '2026-11-11T13:00:00.000Z'],
  ]
  const bad = cases.filter(([, got, want]) => iso(got) !== want).map(([n, got]) => `${n}: ${iso(got)}`)
  check('L_QUIET', bad.length === 0, bad)
}

// ── L_TEXT ──
{
  const app = 'https://hub.neuroprogeny.com/'
  const f = { source: 'lead_device', name: 'Jane\nDoe', label: 'Sleep <quiz>', outcome: 'Holder', email: 'jane@example.com', phone: '+15555550100',
    startsAt: null, contactId: '11111111-2222-3333-4444-555555555555' }
  const sms = compose.composeAlert(f, app)
  const want = 'New lead: Jane Doe\nSource: Lead device\nCompleted "Sleep <quiz>" (result: Holder)\nPhone: +15555550100\nEmail: jane@example.com\n'
    + 'Card: https://hub.neuroprogeny.com/crm/contacts?id=11111111-2222-3333-4444-555555555555'
  const slack = compose.composeSlack(f, app)
  const long = compose.clean('x'.repeat(500), 80)
  const noCard = compose.composeAlert({ ...f, contactId: 'not-a-uuid', phone: null, email: '  ' }, app)
  check('L_TEXT', sms === want && slack.includes('Sleep &lt;quiz&gt;') && !slack.includes('<quiz>') && long.length === 80
    && noCard.endsWith('Card: not created yet') && !/Phone|Email/.test(noCard), { sms, slack })
}

// ── L_CONFIG ──
{
  const p = run.parseAlertConfig
  const rid = '22456608-5f7d-495e-af02-7037fea125cc'
  const ok = p({ enabled: 'on', recipient_user_id: rid }).enabled === true
    && [{ enabled: true, recipient_user_id: rid }, { enabled: 'ON', recipient_user_id: rid }, { enabled: 'on' }, { enabled: 'on', recipient_user_id: 'x' }, null, 'on']
      .every((v) => p(v).enabled === false)
  const now = new Date('2026-11-10T17:00:00Z')
  const w1 = run.windowStart(now, '2026-11-10T16:00:00Z'), w2 = run.windowStart(now, '2026-11-01T00:00:00Z'), w3 = run.windowStart(now, null)
  check('L_CONFIG', ok && w1 === '2026-11-10T16:00:00.000Z' && w2 === '2026-11-10T11:00:00.000Z' && w3 === '2026-11-10T11:00:00.000Z', { w1, w2, w3 })
}

// ── L_ONCE ──
;(async () => {
  const sent = []
  const senders = {
    slack: async () => { sent.push('push'); return { ok: true, code: null } },
    sms: async () => { sent.push('sms'); return { ok: false, retry: false, code: 'no_phone' } },
  }
  const base = { id: 'A1', org_id: 'O', source: 'test', source_id: 'test:1', contact_id: null, starts_at: null, attempts: 0 }
  const make = (row) => {
    const writes = []
    const db = H.stubDb({ hub_lead_alerts: [{ ...row, status: 'pending', due_at: '2026-01-01T00:00:00Z' }] }, {
      table: (t, ops, mode) => {
        const up = ops.find((o) => o[0] === 'update')
        if (t === 'hub_lead_alerts' && up) {
          writes.push(up[1][0])
          if (up[1][0].status === 'sending') return { data: [{ ...row, ...up[1][0] }], error: null }
          return { data: [], error: null }
        }
        return undefined
      },
    })
    return { db, writes }
  }
  const cfg = { enabled: true, recipientUserId: '22456608-5f7d-495e-af02-7037fea125cc', since: null }
  const a = make({ ...base, push_status: null, sms_status: 'sent' })
  await run.dispatch({ db: a.db, now: () => new Date('2026-11-10T17:00:00Z'), appUrl: 'https://hub.neuroprogeny.com', senders }, 'O', cfg)
  const first = sent.splice(0)
  const finalA = a.writes[a.writes.length - 1]
  const b = make({ ...base, push_status: null, sms_status: null })
  await run.dispatch({ db: b.db, now: () => new Date('2026-11-10T17:00:00Z'), appUrl: 'https://hub.neuroprogeny.com', senders }, 'O', cfg)
  const second = sent.splice(0)
  const finalB = b.writes[b.writes.length - 1]
  check('L_ONCE', JSON.stringify(first) === '["push"]' && finalA.status === 'sent' && finalA.sms_status === 'sent'
    && JSON.stringify(second) === '["push","sms"]' && finalB.status === 'partial' && !('due_at' in finalB), { first, finalA, second, finalB })

  // ── L_LOGS ──
  const ROOT = H.ROOT
  const files = ['src/lib/lead-alerts/compose.ts', 'src/lib/lead-alerts/sources.ts', 'src/lib/lead-alerts/run.ts', 'src/lib/lead-alerts/senders.ts',
    'src/app/api/cron/lead-alerts/route.ts', 'src/app/api/lead-alerts/test/route.ts', 'src/lib/marketing/exits.ts']
  const logs = []
  for (const f of files) {
    let src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')
    if (active.includes('logname') && f.endsWith('lead-alerts/run.ts')) src = src.replace("  const uid = cfg.recipientUserId!\n", "  const uid = cfg.recipientUserId!\n  console.info(`[lead-alerts] alert=${a.id} for ${loaded.facts.name}`)\n")
    for (const line of src.split('\n')) if (/console\.(log|info|warn|error)/.test(line)) logs.push(`${f}: ${line.trim()}`)
  }
  const leaky = logs.filter((l) => /\b(name|email|phone|facts|text|body|first_name|last_name|full_name|token|bot_token)\b/i.test(l.replace(/\[[^\]]*\]/g, '')))
  check('L_LOGS', logs.length > 0 && leaky.length === 0, leaky)

  // ── E_PARSE ──
  const sid = 'ac06b5d8-38de-494d-b853-a96262dc3fc9'
  const parsed = exits.parseExitRules({ exit: { stages: [sid, 'stage:x', 7, "x' or 1=1"], payment: 'sometimes', reply: 'yes', enrollment: 'any', left_entry_stage: 1 } })
  check('E_PARSE', JSON.stringify(parsed) === JSON.stringify({ stages: [sid], enrollment: 'any' })
    && JSON.stringify(exits.parseExitRules(null)) === '{}' && JSON.stringify(exits.parseExitRules({ exit: [] })) === '{}', parsed)

  // ── E_ENGINE ──
  let eng = fs.readFileSync(path.join(H.SRC, ENG), 'utf8').replace(/\r\n/g, '\n')
  for (const t of active) for (const [file, from, to] of TAMPERS[t]) if (file === ENG) eng = eng.split(from).join(to)
  const exitAt = eng.indexOf('await endAsExited(db, ce.id, exit, now)'), gateAt = eng.indexOf("db.rpc('gate_check'")
  const placeAt = eng.indexOf('if (PLACEHOLDER.test(`${r.subject}\\n${r.text}`)) {'), dryAt = eng.indexOf("if (g.mode === 'dry_run') {")
  const P = engine.PLACEHOLDER
  check('E_ENGINE', exitAt > 0 && gateAt > exitAt && placeAt > 0 && dryAt > placeAt
    && P.test('Hi\n[[RECAP: two lines]]\nbye') && !P.test('see [link] and [[ ]') && !P.test('[[\n]]'), { exitAt, gateAt, placeAt, dryAt })

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})()
