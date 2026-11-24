#!/usr/bin/env node
// scripts/notify/notify-tamper.cjs   (Running List q22: notification rules and the 8 AM brief)
//
// Runs the real rules (src/lib/notify/rules.ts), the brief sender (brief.ts) and the urgent sender (urgent.ts)
// against an in-memory database that enforces hub_brief_runs' unique (org, user, date). Checks, from intent:
//   N_EARLY    no brief before 08:05 New York or on a weekend; a live run at 07:30 queues nothing
//   N_NORMAL   an item set to the brief is never texted on its own
//   N_URGENT   an urgent item is texted now (live), never held for the brief
//   N_ONCE     a second run the same day queues no second brief
//   N_OWNER    every automatic task has an owner: the rule's recipient, else the default owner
//   N_PRIVATE  the brief carries a count of private mail, never a subject, and never selects one
//   N_MODE     off and preview never send: no brief and no urgent text is queued
//   N_RECENT   private mail is counted only when RECEIVED since the last brief; old unread mail is not counted, and
//              a zero count leaves the line out
//   N_CLOSED   a card in a closed column (Done or Trash) with a past due date shows no Overdue and no Stuck badge,
//              through the one helper the board and the brief share (src/lib/notify/board.ts)
//
//   early      the brief may go from 07:00 New York                       {N_EARLY}
//   normaltext an item set to the brief is routed to a text now           {N_NORMAL}
//   holdurgent the urgent sender holds urgent items for the brief         {N_URGENT}
//   twice      the daily claim never collides, so a second brief goes     {N_ONCE}
//   noowner    automatic tasks lose the default owner                     {N_OWNER}
//   subject    the brief names the first private mail's subject           {N_PRIVATE}
//   sendpreview preview sends like live                                   {N_MODE}
//   allmail    the brief counts every unread message, however old          {N_RECENT}
//   closedbadge cards in Done and Trash keep their Overdue and Stuck badges  {N_CLOSED}
//   I_IMPORT_NOT_IN_BRIEF  the brief's new leads line counts a fresh lead and never an imported contact (an import
//              batch, source sensorium_import, or a source starting 'import')
//   briefimport  the brief counts imported contacts as new leads             {I_IMPORT_NOT_IN_BRIEF}
// TAMPER=1 reddens the sum (10).
const fs = require('fs')
const H = require('../agent/lib/harness.cjs')

const R = 'lib/notify/rules.ts', B = 'lib/notify/brief.ts', U = 'lib/notify/urgent.ts', BOARD = 'lib/notify/board.ts'
const TAMPERS = {
  early: [[R, '  return n.hour === BRIEF_HOUR && n.minute >= BRIEF_MINUTE', '  return n.hour >= BRIEF_HOUR - 1']],
  normaltext: [[R, "  if (rule.urgency === 'urgent') return 'text_now'\n  return 'brief'", "  return 'text_now'"]],
  holdurgent: [[U, "  if (route !== 'text_now') return route === 'brief' ? 'held_for_brief' : 'dropped'", "  if (route !== 'text_now' || type) return route === 'drop' ? 'dropped' : 'held_for_brief'"]],
  twice: [[B, 'user_id: userId, brief_date: date, mode:', 'user_id: userId, brief_date: date + Math.random(), mode:']],
  noowner: [[R, '  return rule?.recipient ?? defaultOwner ?? null', '  return rule?.recipient ?? null']],
  subject: [[R, "since the last brief in your mailbox: ${u}/mail`)", "since the last brief in your mailbox (${i.privateMail[0].subject}): ${u}/mail`)"]],
  sendpreview: [[R, "export const maySend = (mode: Mode) => mode === 'live'", "export const maySend = (mode: Mode) => mode !== 'off'"]],
  allmail: [[B, ".eq('status', 'new').gt('received_at', since).limit(1000)", ".eq('status', 'new').limit(1000)"]],
  briefimport: [[B, "SCORECARD_CHANNELS(leadChannel(c.source)) && !isImportedLead(c))", "SCORECARD_CHANNELS(leadChannel(c.source)))"]],
  closedbadge: [[BOARD, '  const open = !task.completed_at && !closed\n', '  const open = !task.completed_at\n']],
}
const RED_OF = { early: ['N_EARLY'], normaltext: ['N_NORMAL'], holdurgent: ['N_URGENT'], twice: ['N_ONCE'], noowner: ['N_OWNER'], subject: ['N_PRIVATE'], sendpreview: ['N_MODE'], allmail: ['N_RECENT'], closedbadge: ['N_CLOSED'], briefimport: ['I_IMPORT_NOT_IN_BRIEF'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-notify')
// the import rule is the real one (isImportedLead, compiled with the tree), so the brief is checked against it
const realCollect = () => require(require('path').join(out, 'lib/metrics/collect.js'))
const load = H.install(out, { '@/lib/metrics/collect': { leadChannel: () => 'inbound_web', SCORECARD_CHANNELS: () => true, isImportedLead: (c) => realCollect().isImportedLead(c) } })
const rules = load(R), brief = load(B), urgent = load(U), board = load(BOARD)

const ORG = '00000000-0000-0000-0000-0000000000a1'
const OWNER = brief.DEFAULT_OWNER
const OTHER = '00000000-0000-4000-8000-0000000000b2'
const at = (iso) => new Date(iso)
const TUE_0810 = at('2026-11-17T13:10:00Z'), TUE_0730 = at('2026-11-17T12:30:00Z'), TUE_0804 = at('2026-11-17T13:04:00Z'), SAT_0830 = at('2026-11-21T13:30:00Z')

function memDb(mode, rulesOverride) {
  const T = {
    org_settings: [{ org_id: ORG, setting_key: 'hub_notifications', setting_value: { mode, rules: rulesOverride ?? {} } }],
    contacts: [{ id: 'c1', org_id: ORG, source: 'website', created_at: '2026-11-17T01:00:00Z', merged_into_id: null, archived_at: null }],
    tasks: [], hub_metrics_daily: [], nr_bookings: [], kanban_columns: [], kanban_tasks: [],
    hub_mail_connections: [{ id: 'box1', owner_user_id: OWNER, status: 'active' }],
    hub_mail_messages: [
      { id: 'mm1', connection_id: 'box1', status: 'new', subject: 'SECRETSUBJ', received_at: '2026-11-10T09:00:00Z' },
      { id: 'mm2', connection_id: 'box1', status: 'new', subject: 'SECRETSUBJ2', received_at: '2026-11-17T10:00:00Z' },
    ],
    hub_brief_runs: [], hub_sms_outbox: [],
  }
  const calls = []
  const db = {
    T, calls,
    rpc: async () => ({ data: null, error: null }),
    from(table) {
      const ops = []
      const b = {}
      for (const m of ['select', 'eq', 'neq', 'is', 'not', 'in', 'gte', 'gt', 'lte', 'lt', 'like', 'ilike', 'or', 'order', 'limit', 'insert', 'update', 'upsert', 'delete']) b[m] = (...a) => { ops.push([m, a]); return b }
      const run = (mode_) => {
        calls.push({ table, ops })
        const ins = ops.find((o) => o[0] === 'insert')
        if (ins) {
          const row = { id: `${table}-${(T[table] || []).length + 1}`, ...ins[1][0] }
          if (table === 'hub_brief_runs' && T[table].some((r) => r.org_id === row.org_id && r.user_id === row.user_id && String(r.brief_date) === String(row.brief_date))) return { data: null, error: { code: '23505' } }
          ;(T[table] = T[table] || []).push(row)
          return mode_ === 'many' ? { data: [row], error: null } : { data: row, error: null }
        }
        if (ops.some((o) => o[0] === 'update' || o[0] === 'upsert' || o[0] === 'delete')) return { data: null, error: null }
        let rows = (T[table] || []).slice()
        for (const [m, a] of ops) {
          if (m === 'eq') rows = rows.filter((r) => r[a[0]] === a[1])
          if (m === 'is') rows = rows.filter((r) => (r[a[0]] ?? null) === a[1])
          if (m === 'in') rows = rows.filter((r) => a[1].includes(r[a[0]]))
          if (m === 'gt') rows = rows.filter((r) => r[a[0]] != null && String(r[a[0]]) > String(a[1]))
        }
        const sel = ops.find((o) => o[0] === 'select')
        const cols = sel ? String(sel[1][0]).split(',').map((c) => c.trim()).filter(Boolean) : null
        if (cols && !cols.includes('*')) rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])))
        if (mode_ === 'single' || mode_ === 'maybeSingle') return { data: rows[0] || null, error: null }
        return { data: rows, error: null }
      }
      b.maybeSingle = () => ({ then: (res, rej) => Promise.resolve(run('maybeSingle')).then(res, rej) })
      b.single = () => ({ then: (res, rej) => Promise.resolve(run('single')).then(res, rej) })
      b.then = (res, rej) => Promise.resolve(run('many')).then(res, rej)
      return b
    },
  }
  return db
}

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

;(async () => {
  // N_EARLY
  {
    const due = [TUE_0730, TUE_0804, TUE_0810, SAT_0830].map((d) => rules.briefDue(d))
    const db = memDb('live')
    await brief.sendBriefs(db, ORG, TUE_0730)
    check('N_EARLY', JSON.stringify(due) === JSON.stringify([false, false, true, false]) && db.T.hub_sms_outbox.length === 0, { due, queued: db.T.hub_sms_outbox.length })
  }

  // N_NORMAL
  {
    const r = rules.routeItem({ recipient: OWNER, urgency: 'brief' })
    const db = memDb('live', { discovery_no_show: { recipient: OWNER, urgency: 'brief' } })
    const res = await urgent.notifyUrgent(db, ORG, 'discovery_no_show', 'c1')
    check('N_NORMAL', r === 'brief' && res === 'held_for_brief' && db.T.hub_sms_outbox.length === 0, { r, res })
  }

  // N_URGENT
  {
    const r = rules.routeItem({ recipient: OWNER, urgency: 'urgent' })
    const db = memDb('live')
    const res = await urgent.notifyUrgent(db, ORG, 'discovery_no_show', 'c1')
    const q = db.T.hub_sms_outbox
    check('N_URGENT', r === 'text_now' && res === 'queued' && q.length === 1 && q[0].user_id === OWNER && !/\u2014/.test(q[0].body), { r, res, queued: q.length })
  }

  // N_ONCE
  {
    const db = memDb('live')
    const a = await brief.sendBriefs(db, ORG, TUE_0810)
    const b2 = await brief.sendBriefs(db, ORG, at('2026-11-17T13:40:00Z'))
    check('N_ONCE', a.queued === 1 && b2.queued === 0 && db.T.hub_sms_outbox.filter((m) => m.source === 'hub-brief').length === 1, { first: a, second: b2 })
  }

  // N_OWNER
  {
    const D = OWNER
    const ok = rules.taskOwner(undefined, D) === D && rules.taskOwner({ recipient: null, urgency: 'brief' }, D) === D
      && rules.taskOwner({ recipient: OTHER, urgency: 'brief' }, D) === OTHER && rules.taskOwner(null, null) === null
    const podcast = fs.readFileSync(require('path').join(H.SRC, 'app/api/integrations/podcast-conversion/route.ts'), 'utf8')
    check('N_OWNER', ok && podcast.includes('if (defaultCol && owner)') && podcast.includes('owner_id: owner,'), { ok })
  }

  // N_PRIVATE
  {
    const text = rules.composeBrief({ hubUrl: 'https://hub.example', newLeads: 0, tasksDueToday: 0, tasksOverdue: 0, stuckOnboarding: 0, discoveryCallsToday: 0, coachingToday: 0, flagged: 0, privateMail: [{ subject: 'SECRETSUBJ' }, { subject: 'OTHER' }], welcomeEmailProblems: 0 }).text
    const db = memDb('preview')
    const input = await brief.gatherBrief(db, ORG, OWNER, brief.loadSettings ? await brief.loadSettings(db, ORG) : null, TUE_0810, '2026-11-16T13:00:00Z')
    const mailSelect = db.calls.filter((c) => c.table === 'hub_mail_messages').map((c) => String((c.ops.find((o) => o[0] === 'select') || [0, ['']])[1][0]))
    check('N_PRIVATE', !text.includes('SECRETSUBJ') && text.includes('2 emails since the last brief') && JSON.stringify(input.privateMail).indexOf('SECRET') < 0 && mailSelect.every((s) => !/subject/.test(s)), { mailSelect })
  }

  // N_RECENT
  {
    const db = memDb('preview')
    const s = await brief.loadSettings(db, ORG)
    const recent = await brief.gatherBrief(db, ORG, OWNER, s, TUE_0810, '2026-11-16T13:00:00Z')
    const none = await brief.gatherBrief(db, ORG, OWNER, s, TUE_0810, '2026-11-17T12:00:00Z')
    const lineOut = !rules.composeBrief(none).text.includes('in your mailbox')
    check('N_RECENT', recent.privateMail.length === 1 && none.privateMail.length === 0 && lineOut, { recent: recent.privateMail.length, none: none.privateMail.length, lineOut })
  }

  // N_CLOSED
  {
    const now = TUE_0810
    const past = { due_date: '2026-11-01T00:00:00Z', completed_at: null, custom_fields: { reason: 'enrolled_inactive_10d' } }
    const closedTitles = ['Done', 'Trash', ' trash ', 'DONE'].map((t) => board.isClosedColumn(t))
    const openTitles = ['Action Steps', 'Capture', 'Waiting for', 'Someday Maybe', ''].map((t) => board.isClosedColumn(t))
    const inDone = board.cardBadges(past, board.isClosedColumn('Done'), now)
    const inTrash = board.cardBadges(past, board.isClosedColumn('Trash'), now)
    const inOpen = board.cardBadges(past, board.isClosedColumn('Action Steps'), now)
    const finished = board.cardBadges({ ...past, completed_at: '2026-11-02T00:00:00Z' }, false, now)
    check('N_CLOSED', closedTitles.every(Boolean) && !openTitles.some(Boolean)
      && !inDone.overdue && !inDone.stuck && !inTrash.overdue && !inTrash.stuck
      && inOpen.overdue && inOpen.stuck && !finished.overdue && !finished.stuck, { inDone, inTrash, inOpen, finished })
  }

  // I_IMPORT_NOT_IN_BRIEF: one fresh lead and three imported contacts since the last brief
  {
    const db = memDb('preview')
    db.T.contacts.push({ id: 'i1', org_id: ORG, source: 'podcast_tracker', import_batch_id: 'batch-1', created_at: '2026-11-17T02:00:00Z', merged_into_id: null, archived_at: null },
      { id: 'i2', org_id: ORG, source: 'sensorium_import', import_batch_id: null, created_at: '2026-11-17T02:00:00Z', merged_into_id: null, archived_at: null },
      { id: 'i3', org_id: ORG, source: 'import_chat', import_batch_id: null, created_at: '2026-11-17T02:00:00Z', merged_into_id: null, archived_at: null })
    const s = await brief.loadSettings(db, ORG)
    const input = await brief.gatherBrief(db, ORG, OWNER, s, TUE_0810, '2026-11-16T13:00:00Z')
    check('I_IMPORT_NOT_IN_BRIEF', input.newLeads === 1, { newLeads: input.newLeads })
  }

  // N_MODE
  {
    const results = []
    for (const mode of ['off', 'preview']) {
      const db = memDb(mode)
      await brief.sendBriefs(db, ORG, TUE_0810)
      const u = await urgent.notifyUrgent(db, ORG, 'discovery_no_show', 'c1')
      results.push({ mode, queued: db.T.hub_sms_outbox.length, claimed: db.T.hub_brief_runs.length, u })
    }
    check('N_MODE', results.every((r) => r.queued === 0 && r.claimed === 0), results)
  }

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})()
