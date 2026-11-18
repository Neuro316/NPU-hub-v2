#!/usr/bin/env node
// scripts/notify/q34-tamper.cjs   (Running List q34: follow-ups from q22 and q30)
//
// Checks, from intent:
//   Q_ONEWRITER  contacts' call and text totals (total_calls, total_texts, the inbound/outbound splits and
//                total_call_duration_seconds) have one writer, the database triggers on call_logs and crm_messages.
//                No file under src/app or src/lib adds to one of them again.
//   Q_STUCK      the brief's stuck-onboarding count (read from hub_metrics_daily, which has no org column) is built
//                only for Neuro Progeny. Another org's brief carries 0; NP's carries the metric.
//   Q_CRON       the daily Slack post of contact due dates is retired: no crm-due-dates schedule in vercel.json and no
//                route file.
//   Q_RECIPIENT  every recipient choice on Settings › Notifications shows its login's email, one choice per login,
//                active staff of the org only, and the page renders that label.
//
//   appcount    an app route adds to total_calls again                     {Q_ONEWRITER}
//   stuckanyorg the stuck line is built for any org                        {Q_STUCK}
//   cronback    the retired schedule is back in vercel.json                {Q_CRON}
//   noemail     a recipient choice shows its name only                     {Q_RECIPIENT}
// TAMPER=1 reddens the sum (4).
const fs = require('fs'), path = require('path')
const H = require('../agent/lib/harness.cjs')

const B = 'lib/notify/brief.ts', RCP = 'lib/notify/recipients.ts'
const TOKEN = 'src/app/api/voice/token/route.ts', VERCEL = 'vercel.json'
// compiled by the shared harness (src/lib/notify)
const TAMPERS = {
  stuckanyorg: [[B, '  if (orgId === METRICS_ORG && mine(s, userId, \'stuck_onboarding\')) {', '  if (mine(s, userId, \'stuck_onboarding\')) {']],
  noemail: [[RCP, 'label: `${name} (${email})`', 'label: name']],
}
// read as text from the repo root (not compiled)
const TEXT_TAMPERS = {
  appcount: [[TOKEN, '    // contacts.total_calls, total_outbound_calls and last_call_at are written by the call_logs insert trigger\n',
    "    { const { data: cur } = await admin.from('contacts').select('total_calls').eq('id', contact_id).single()\n" +
    "      if (cur) await admin.from('contacts').update({ total_calls: (cur.total_calls || 0) + 1 }).eq('id', contact_id) }\n"]],
  cronback: [[VERCEL, '    { "path": "/api/cron/sms-outbox"', '    { "path": "/api/cron/crm-due-dates", "schedule": "0 14 * * *" },\n    { "path": "/api/cron/sms-outbox"']],
}
const RED_OF = { appcount: ['Q_ONEWRITER'], stuckanyorg: ['Q_STUCK'], cronback: ['Q_CRON'], noemail: ['Q_RECIPIENT'] }

const sel = process.env.TAMPER || ''
const active = sel === '1' ? Object.keys(RED_OF) : sel ? sel.split(',') : []
for (const t of active) if (!RED_OF[t]) { console.error(`unknown selector ${t}`); process.exit(2) }
const out = H.compile(TAMPERS, active.filter((t) => TAMPERS[t]), 'hub-q34')
const load = H.install(out, { '@/lib/metrics/collect': { leadChannel: () => 'inbound_web', SCORECARD_CHANNELS: () => true } })
const brief = load(B), recipients = load(RCP), rules = load('lib/notify/rules.ts')

const textHits = {}
function text(rel) {
  let s = fs.existsSync(path.join(H.ROOT, rel)) ? fs.readFileSync(path.join(H.ROOT, rel), 'utf8').replace(/\r\n/g, '\n') : ''
  for (const t of active) for (const [file, from, to] of TEXT_TAMPERS[t] || []) {
    if (file !== rel) continue
    if (!s.includes(from)) { console.error(`dead anchor: ${t} in ${file}`); process.exit(2) }
    s = s.split(from).join(to); textHits[t] = (textHits[t] || 0) + 1
  }
  return s
}
function walk(dir) {
  const abs = path.join(H.ROOT, dir)
  if (!fs.existsSync(abs)) return []
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name)
    return e.isDirectory() ? walk(rel) : /\.tsx?$/.test(e.name) ? [rel] : []
  })
}

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

;(async () => {
  // Q_ONEWRITER: an object key for one of the trigger-owned totals assigned anything with a "+" (an increment).
  {
    const KEY = /\btotal_(calls|texts|inbound_calls|outbound_calls|inbound_texts|outbound_texts|call_duration_seconds)\s*:[^,\n}]*\+/
    const offenders = [...walk('src/app'), ...walk('src/lib')].filter((f) => KEY.test(text(f)))
    check('Q_ONEWRITER', offenders.length === 0, { offenders })
  }

  // Q_STUCK
  {
    const NP = brief.METRICS_ORG, OTHER = '806e0330-2c18-4afb-91f5-090906eaa20b', USER = '00000000-0000-4000-8000-0000000000c1'
    // only the stuck line is on, for USER; every other rule has no recipient
    const settings = rules.parseSettings({ mode: 'preview', rules: { stuck_onboarding: { recipient: USER, urgency: 'brief' } } }, null)
    const metrics = [{ metric_key: 'onboarding_stuck', dimension_key: '', date: '2026-11-17', value: 4 }]
    const db = H.stubDb({ hub_metrics_daily: metrics }, {
      table: (table, ops) => {
        let r = table === 'hub_metrics_daily' ? metrics.slice() : []
        for (const [m, a] of ops) if (m === 'eq') r = r.filter((x) => x[a[0]] === a[1])
        return { data: r, error: null }
      },
    })
    const now = new Date('2026-11-17T13:10:00Z'), since = '2026-11-16T13:10:00Z'
    const other = await brief.gatherBrief(db, OTHER, USER, settings, now, since)
    const np = await brief.gatherBrief(db, NP, USER, settings, now, since)
    check('Q_STUCK', other.stuckOnboarding === 0 && np.stuckOnboarding === 4, { other: other.stuckOnboarding, np: np.stuckOnboarding })
  }

  // Q_CRON
  {
    let crons = []
    try { crons = (JSON.parse(text(VERCEL)).crons || []).map((c) => c.path) } catch (e) { crons = ['unparseable'] }
    const route = fs.existsSync(path.join(H.ROOT, 'src/app/api/cron/crm-due-dates/route.ts'))
    check('Q_CRON', !crons.includes('/api/cron/crm-due-dates') && !crons.includes('unparseable') && !route, { scheduled: crons.includes('/api/cron/crm-due-dates'), route })
  }

  // Q_RECIPIENT
  {
    const C = 'cam-1', C2 = 'cam-2', C3 = 'cam-3', E = 'ella-1', E2 = 'ella-2'
    const rowsIn = [
      { user_id: C, display_name: 'Cameron Allen', email: 'cameron@example.com', role: 'super_admin', status: 'active' },
      { user_id: C2, display_name: 'Cameron Allen', email: 'cameron.work@example.com', role: 'super_admin', status: 'active' },
      { user_id: C3, display_name: 'Cameron Allen', email: 'cameron.home@example.com', role: 'team_member', status: 'active' },
      { user_id: E, display_name: 'Ella Staff', email: null, role: 'admin', status: 'active' },
      { user_id: E2, display_name: 'Ella Staff', email: 'ella.two@example.com', role: 'team_member', status: 'active' },
      { user_id: C, display_name: 'Cameron Allen', email: 'cameron@example.com', role: 'super_admin', status: 'active' },
      { user_id: 'gone', display_name: 'Former Staff', email: 'gone@example.com', role: 'team_member', status: 'inactive' },
      { user_id: 'client', display_name: 'A Participant', email: 'client@example.com', role: 'participant', status: 'active' },
    ]
    const opts = recipients.recipientOptions(rowsIn, { [E]: 'ella.one@example.com' })
    const ids = opts.map((o) => o.user_id)
    const labelsCarryEmail = opts.every((o) => o.email && o.label.includes(o.email))
    const labelsDistinct = new Set(opts.map((o) => o.label)).size === opts.length
    const page = text('src/app/(dashboard)/settings/notifications/page.tsx')
    const route = text('src/app/api/settings/notifications/route.ts')
    const wired = page.includes('{s.label}</option>') && /select\('user_id, display_name, email, role, status'\)/.test(route) && route.includes('recipientOptions(')
    check('Q_RECIPIENT', labelsCarryEmail && labelsDistinct && wired && ids.length === 5 && !ids.includes('gone') && !ids.includes('client'),
      { labels: opts.map((o) => o.label), wired })
  }

  for (const t of active) if (TEXT_TAMPERS[t] && (textHits[t] || 0) < TEXT_TAMPERS[t].length) { console.error(`dead anchor: ${t}`); process.exit(2) }
  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})()
