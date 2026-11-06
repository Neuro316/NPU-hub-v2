#!/usr/bin/env node
// scripts/marketing/activity-log-tamper.cjs
//
// logActivity wrote columns activity_log does not have, so nothing was ever logged. Checks:
//   A_COLS     the row names only the table's real columns
//   A_REF      a uuid reference goes to entity_id; anything else stays in details
//   A_ACTOR    actor_id takes the team member; the auth user stays in details
//   A_READ     a stored row reads back as what was logged
//   A_READERS  no reader of activity_log asks for a column the table lacks
//
//   rawcols    the row names event_type again           {A_COLS,A_READ}
//   refraw     any reference goes to the uuid column     {A_REF}
//   actorraw   actor_id takes the auth user              {A_ACTOR}
//   readold    a row reads event_type, not action        {A_READ}
//   orderold   the shared loader orders by occurred_at   {A_READERS}
// TAMPER=1 reddens the union (5).
const fs = require('fs'), path = require('path')
const H = require('../agent/lib/harness.cjs')

const F = 'lib/activity-log.ts'
const TAMPERS = {
  rawcols: [[F, 'action: entry.event_type,', 'event_type: entry.event_type,']],
  refraw: [[F, 'entity_id: refIsUuid ? entry.ref_id! : null,', 'entity_id: entry.ref_id ?? null,']],
  actorraw: [[F, 'actor_id: teamMemberId,', 'actor_id: entry.actor_id ?? null,']],
  readold: [[F, 'event_type: row.action,', 'event_type: row.event_type,']],
  orderold: [[F, ".order('created_at', { ascending: false })", ".order('occurred_at', { ascending: false })"]],
}
const RED_OF = {
  rawcols: ['A_COLS', 'A_READ'], refraw: ['A_REF'], actorraw: ['A_ACTOR'], readold: ['A_READ'], orderold: ['A_READERS'],
}
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-activity')
const load = H.install(out)
const { toActivityRow, fromActivityRow } = load(F)

const REAL = new Set(['id', 'org_id', 'contact_id', 'actor_id', 'action', 'entity_type', 'entity_id', 'details', 'created_at'])
const USER = '22222222-2222-4222-8222-222222222222', TEAM = '33333333-3333-4333-8333-333333333333'
const REF = '44444444-4444-4444-8444-444444444444'
const entry = { contact_id: 'c1', org_id: 'o1', event_type: 'sms_sent', event_data: { channel: 'sms' }, ref_table: 'crm_messages', ref_id: REF, actor_id: USER }

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

const row = toActivityRow(entry, TEAM)
check('A_COLS', Object.keys(row).every((k) => REAL.has(k)) && row.action === 'sms_sent' && row.entity_type === 'crm_messages', Object.keys(row))
const textRef = toActivityRow({ ...entry, ref_id: 'CA123' }, TEAM)
check('A_REF', row.entity_id === REF && textRef.entity_id === null && textRef.details.ref_id === 'CA123', { entity: textRef.entity_id, details: textRef.details })
const noTeam = toActivityRow(entry, null)
check('A_ACTOR', row.actor_id === TEAM && noTeam.actor_id === null && noTeam.details.actor_user_id === USER, { row: row.actor_id, none: noTeam.actor_id })
const back = fromActivityRow({ ...row, id: 'r1', created_at: '2026-11-06T12:00:00Z' })
const backText = fromActivityRow({ ...textRef, id: 'r2', created_at: '2026-11-06T12:00:00Z' })
const backNoRef = fromActivityRow({ ...toActivityRow({ contact_id: 'c1', org_id: 'o1', event_type: 'x' }, null), id: 'r3', created_at: '2026-11-06T12:00:00Z' })
check('A_READ',
  fromActivityRow({ id: 'r4', action: 'stored', details: {}, created_at: '2026-11-06T12:00:00Z' }).event_type === 'stored'
  && back.event_type === 'sms_sent' && back.event_data && back.event_data.channel === 'sms' && back.ref_table === 'crm_messages' && back.ref_id === REF
  && back.actor_id === USER && back.occurred_at === '2026-11-06T12:00:00Z' && backText.ref_id === 'CA123' && backNoRef.actor_id === null && backNoRef.ref_table === 'contact',
  back)

// Every file that reads the table, as written, plus the loader as compiled with any tamper.
const SRC = path.resolve(__dirname, '..', '..', 'src')
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []))
const stale = []
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8')
  for (const m of text.matchAll(/\.from\(['"]activity_log['"]\)([\s\S]{0,300})/g)) {
    if (/event_type|event_data|occurred_at|ref_table|ref_id/.test(m[1].split(/;|\n\s*\n/)[0])) stale.push(path.relative(SRC, file))
  }
}
const compiledLoader = fs.readFileSync(path.join(out, 'lib', 'activity-log.js'), 'utf8')
check('A_READERS', stale.length === 0 && !compiledLoader.includes("order('occurred_at'"), { stale })

H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
