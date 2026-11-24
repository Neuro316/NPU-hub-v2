#!/usr/bin/env node
// scripts/resolve/resolve-tamper.cjs   ("No reply needed", hub_250; q44 folded in)
//
// Runs the REAL code (src/lib/resolve, the text alert, the touchpoint raise, the lead_no_touch_24h scan, the lifecycle
// task write, the returning flag, the /api/resolve route) against an in-memory database that applies filters and
// enforces exactly two constraints the checks are about: the one-live-row index of hub_contact_resolutions, and the
// tasks.assigned_to foreign key to team_members. Now is Friday 2026-11-20, 10:00 AM ET.
// Checks, from intent:
//   R_RESOLVE_WRITES       a resolve writes one row (scope, reason, resolved_by) and ONE contact_resolved timeline entry
//                          with who, the reason chip text and the note
//   R_CLEARS_TEXT          resolving text_waiting clears the open text_waiting_1h row, and the next alert run posts nothing
//   R_CLEARS_TOUCHPOINT    resolving touchpoint clears the open situations, moves their cards to Done with the reason, and
//                          the raise step raises nothing new for the contact
//   R_CLEARS_STL           resolving speed_to_lead closes the open lead_no_touch_24h task, and the scan emits no new
//                          lead_no_touch_24h event for the lead
//   R_REOPENS_ON_INBOUND   a new inbound text after resolved_at reopens the row ('new_inbound'), and the raise step raises
//                          the contact again
//   R_REOPEN_MANUAL        Reopen sets reopened_at with 'manual'; the contact is no longer resolved; a new resolve is allowed
//   R_RETURNING_CHIP       a lead who bought before is flagged 'returning' on the lead_no_touch_24h task and in the alert
//                          text, and the task is still opened (flagged, not hidden)
//   R_TASK_FK_FALLBACK     a lifecycle assignee with no team_members row (the 23503 of 2026-11-21) gets the org default
//                          owner's team member, the fallback is logged in job_runs, and the run does not fail
//   R_SHARED_ACROSS_USERS  resolved as Cameron, read as Shane through GET /api/resolve: the same row, by Cameron; and a
//                          second resolve by Shane for the same scope is refused as already resolved
//
//   notimeline   the timeline entry is written under another kind                {R_RESOLVE_WRITES}
//   textposts    the text alert ignores the resolve                              {R_CLEARS_TEXT}
//   touchraise   the touchpoint raise ignores the resolve                        {R_CLEARS_TOUCHPOINT}
//   stlscan      the lead_no_touch_24h scan ignores the resolve                  {R_CLEARS_STL}
//   noreopen     a new inbound does not reopen                                   {R_REOPENS_ON_INBOUND}
//   manualnoop   Reopen records the wrong reason                                 {R_REOPEN_MANUAL}
//   noreturning  past purchases are not read                                     {R_RETURNING_CHIP}
//   rawassignee  the task is written with the user id                            {R_TASK_FK_FALLBACK}
//   perlogin     GET /api/resolve shows only the viewer's own resolves           {R_SHARED_ACROSS_USERS}
// TAMPER=1 reddens the sum (9).
const H = require('../agent/lib/harness.cjs')

const RR = 'lib/resolve/rules.ts', CK = 'lib/resolve/check.ts', TA = 'lib/touchpoints/text-alerts.ts', RUN = 'lib/touchpoints/run.ts'
const SCAN = 'lib/lifecycle/scan.ts', LED = 'lib/lifecycle/ledger.ts', RET = 'lib/touch/returning.ts', ROUTE = 'app/api/resolve/route.ts'
const TAMPERS = {
  notimeline: [[RR, "event_type: 'contact_resolved',", "event_type: 'resolved',"]],
  textposts: [[TA, '  const waiting = found.filter((w) => !resolved.has(w.contactId))', '  const waiting = found']],
  touchraise: [[RUN, '  candidates = candidates.filter((c) => !resolved.has(c.contactId))\n', '']],
  stlscan: [[SCAN, '    if (resolved.has(c.id)) continue\n', '']],
  noreopen: [[CK, '    if (await inboundSince(db, r.contact_id, r.resolved_at)) {', '    if (false as boolean) {']],
  manualnoop: [[RR, "update({ reopened_at: iso(now), reopened_reason: 'manual' })", "update({ reopened_at: iso(now), reopened_reason: 'new_inbound' })"]],
  noreturning: [[RET, '  for (const b of (buys ?? []) as any[]) if (b.contact_id) out.add(b.contact_id)\n', '']],
  rawassignee: [[LED, "await db.from('tasks').insert({ ...fields, assigned_to: who.memberId })", "await db.from('tasks').insert({ ...fields, assigned_to: cfg.assignee })"]],
  perlogin: [[ROUTE, 'resolutions: await resolutionsFor(ctx.db, orgId, id!)', 'resolutions: (await resolutionsFor(ctx.db, orgId, id!)).filter((r) => r.by_id === ctx.userId)']],
}
const RED_OF = { notimeline: ['R_RESOLVE_WRITES'], textposts: ['R_CLEARS_TEXT'], touchraise: ['R_CLEARS_TOUCHPOINT'], stlscan: ['R_CLEARS_STL'],
  noreopen: ['R_REOPENS_ON_INBOUND'], manualnoop: ['R_REOPEN_MANUAL'], noreturning: ['R_RETURNING_CHIP'], rawassignee: ['R_TASK_FK_FALLBACK'],
  perlogin: ['R_SHARED_ACROSS_USERS'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-resolve')
const load = H.install(out)
const resolve = load(RR), check = load(CK), ta = load(TA), run = load(RUN), scan = load(SCAN), ledger = load(LED), ret = load(RET)
const compose = load('lib/lead-alerts/compose.ts'), lrules = load('lib/lifecycle/rules.ts'), route = load(ROUTE)

const ORG = '00000000-0000-0000-0000-000000000001'
const CAMERON = '22456608-5f7d-495e-af02-7037fea125cc', SHANE = 'ec05f3ea-99b3-455a-aefc-378f2e07d82a'
const C = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const NOW = Date.parse('2026-11-20T15:00:00Z')
const ago = (h) => new Date(NOW - h * 3_600_000).toISOString()
const at = (t) => new Date(t).toISOString()

function world() {
  return {
    contacts: [1, 2, 3, 4, 5, 6].map((n) => ({ id: C(n), org_id: ORG, first_name: `P${n}`, last_name: null, email: `p${n}@example.com`, phone: `+1555010100${n}`,
      source: 'form', tags: [], do_not_contact: false, merged_into_id: null, archived_at: null, created_at: ago(30) })),
    team_profiles: [{ org_id: ORG, user_id: CAMERON, display_name: 'Cameron Allen', role: 'super_admin', status: 'active' },
      { org_id: ORG, user_id: SHANE, display_name: 'Shane Granau', role: 'super_admin', status: 'active' }],
    team_members: [{ id: 'tm-cameron', org_id: ORG, user_id: CAMERON, is_active: true }],
    hub_contact_resolutions: [], contact_timeline: [], hub_touchpoint_situations: [], kanban_tasks: [], tasks: [], job_runs: [], hub_lifecycle_events: [],
    kanban_columns: [{ id: 'col-act', org_id: ORG, title: 'Action Steps', sort_order: 1 }, { id: 'col-done', org_id: ORG, title: 'Done', sort_order: 4 }],
    conversations: [], crm_messages: [], call_logs: [], hub_mail_messages: [], hub_booking_syncs: [], hub_resources: [],
  }
}

function memDb(T) {
  let seq = 0
  const cmp = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return Number.isNaN(x) || Number.isNaN(y) ? String(a).localeCompare(String(b)) : x - y }
  return {
    from(table) {
      const ops = []
      const b = {}
      for (const m of ['select', 'eq', 'neq', 'is', 'not', 'in', 'gt', 'gte', 'lt', 'lte', 'ilike', 'order', 'limit', 'range', 'insert', 'update', 'upsert']) b[m] = (...a) => { ops.push([m, a]); return b }
      const filt = (rows) => {
        for (const [m, a] of ops) {
          if (m === 'eq') rows = rows.filter((r) => r[a[0]] === a[1])
          if (m === 'neq') rows = rows.filter((r) => r[a[0]] !== a[1])
          if (m === 'is') rows = rows.filter((r) => (r[a[0]] ?? null) === a[1])
          if (m === 'not' && a[1] === 'is') rows = rows.filter((r) => (r[a[0]] ?? null) !== a[2])
          if (m === 'in') rows = rows.filter((r) => a[1].includes(r[a[0]]))
          if (m === 'gt') rows = rows.filter((r) => r[a[0]] != null && cmp(r[a[0]], a[1]) > 0)
          if (m === 'gte') rows = rows.filter((r) => r[a[0]] != null && cmp(r[a[0]], a[1]) >= 0)
          if (m === 'lt') rows = rows.filter((r) => r[a[0]] != null && cmp(r[a[0]], a[1]) < 0)
          if (m === 'lte') rows = rows.filter((r) => r[a[0]] != null && cmp(r[a[0]], a[1]) <= 0)
          if (m === 'ilike') rows = rows.filter((r) => String(r[a[0]] ?? '').toLowerCase() === String(a[1]).replace(/\\(.)/g, '$1').toLowerCase())
        }
        return rows
      }
      const exec = (mode) => {
        T[table] = T[table] || []
        const ins = ops.find((o) => o[0] === 'insert' || o[0] === 'upsert'), upd = ops.find((o) => o[0] === 'update')
        if (ins) {
          const list = (Array.isArray(ins[1][0]) ? ins[1][0] : [ins[1][0]]).map((r) => ({ id: `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}`, ...r }))
          if (table === 'hub_contact_resolutions') {
            for (const r of list) if (T[table].some((x) => x.contact_id === r.contact_id && x.scope === r.scope && !x.reopened_at)) return { data: null, error: { code: '23505' } }
            for (const r of list) { r.reopened_at = null; r.reopened_reason = null }
          }
          if (table === 'tasks') for (const r of list) if (r.assigned_to && !T.team_members.some((m) => m.id === r.assigned_to)) return { data: null, error: { code: '23503' } }
          if (ins[0] === 'upsert' && table === 'hub_lifecycle_events') {
            const fresh = list.filter((r) => !T[table].some((x) => x.org_id === r.org_id && x.event_key === r.event_key))
            T[table].push(...fresh)
            return { data: fresh, error: null }
          }
          for (const r of list) if (table === 'hub_touchpoint_situations' && r.cleared_at === undefined) r.cleared_at = null
          T[table].push(...list)
          return { data: mode === 'one' ? list[0] : list, error: null }
        }
        if (upd) {
          const rows = filt(T[table])
          for (const r of rows) Object.assign(r, upd[1][0])
          return mode === 'one' ? (rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116' } }) : { data: rows, error: null }
        }
        let rows = filt(T[table].slice())
        const ord = ops.find((o) => o[0] === 'order')
        if (ord) rows.sort((x, y) => (ord[1][1]?.ascending === false ? -1 : 1) * cmp(x[ord[1][0]], y[ord[1][0]]))
        const lim = ops.find((o) => o[0] === 'limit'); if (lim) rows = rows.slice(0, lim[1][0])
        return { data: mode === 'one' ? rows[0] ?? null : rows, error: null }
      }
      b.single = () => ({ then: (res, rej) => Promise.resolve(exec('one')).then(res, rej) })
      b.maybeSingle = b.single
      b.then = (res, rej) => Promise.resolve(exec('many')).then(res, rej)
      return b
    },
  }
}

const rows = []
const ok = (id, pass, got) => rows.push({ id, ok: !!pass, got })
const res = (T, input) => resolve.resolveContact(memDb(T), { orgId: ORG, note: null, byUserId: CAMERON, now: NOW, ...input })
const live = (T, c, scope, now = NOW + 60_000) => check.liveResolutions(memDb(T), [c], scope, now)

;(async () => {
  // R_RESOLVE_WRITES
  {
    const T = world()
    const r = await res(T, { contactId: C(1), scope: 'all', reason: 'former_client', note: 'Finished the program in May' })
    const tl = T.contact_timeline.filter((e) => e.contact_id === C(1))
    ok('R_RESOLVE_WRITES', r.status === 200 && T.hub_contact_resolutions.length === 1 && T.hub_contact_resolutions[0].scope === 'all' && T.hub_contact_resolutions[0].resolved_by === CAMERON
      && tl.length === 1 && tl[0].event_type === 'contact_resolved' && tl[0].metadata.reason_text === 'Former client' && tl[0].metadata.by_name === 'Cameron Allen'
      && tl[0].metadata.scope === 'all' && /Finished the program in May/.test(tl[0].description), { status: r.status, tl })
  }

  // R_CLEARS_TEXT: a waiting text thread, resolved, then an alert run
  {
    const T = world()
    T.conversations.push({ id: 'cv2', org_id: ORG, contact_id: C(2), line_e164: '+15550000001', last_message_at: ago(1) })
    T.crm_messages.push({ id: 'm2', conversation_id: 'cv2', direction: 'inbound', status: 'received', created_at: ago(2), to_e164: '+15550000001', from_e164: '+15557770000', body: 'hi' })
    T.hub_touchpoint_situations.push({ id: 'tw2', org_id: ORG, contact_id: C(2), kind: 'text_waiting_1h', situation_key: `${C(2)}:text_waiting_1h:m2`, waiting_since: ago(2),
      opened_at: ago(1), cleared_at: null, cleared_reason: null, severity: 'low', detail: { alerted_at: ago(1) }, task_id: null })
    await res(T, { contactId: C(2), scope: 'text_waiting', reason: 'conversation_ended' })
    const clearedNow = !!T.hub_touchpoint_situations.find((s) => s.id === 'tw2').cleared_at
    const posts = []
    const people = { contacts: new Map([[C(2), { id: C(2), email: null }]]), names: new Map([[C(2), 'P2']]), excluded: new Map(), primaryOf: new Map() }
    const out2 = await ta.textAlerts({ db: memDb(T), orgId: ORG, now: NOW + 30 * 60_000, hubUrl: 'https://hub.example', lines: async () => [],
      slackChannel: async (o, ch, text) => { posts.push(text); return { ok: true, code: null } } }, people)
    ok('R_CLEARS_TEXT', clearedNow && posts.length === 0 && out2.waiting === 0 && T.hub_touchpoint_situations.filter((s) => s.kind === 'text_waiting_1h' && !s.cleared_at).length === 0,
      { clearedNow, posts: posts.length, waiting: out2.waiting })
  }

  // R_CLEARS_TOUCHPOINT: an open situation with a card; resolved; then the raise step on a new situation for the contact
  {
    const T = world()
    T.kanban_tasks.push({ id: 'card3', org_id: ORG, column_id: 'col-act', title: 'P3: texted us, no reply yet', description: 'x' })
    T.hub_touchpoint_situations.push({ id: 's3', org_id: ORG, contact_id: C(3), kind: 'text_no_reply', situation_key: `${C(3)}:text_no_reply:t1`, waiting_since: ago(30),
      opened_at: ago(5), cleared_at: null, cleared_reason: null, severity: 'low', detail: {}, task_id: 'card3' })
    await res(T, { contactId: C(3), scope: 'touchpoint', reason: 'handled_elsewhere' })
    const s = T.hub_touchpoint_situations.find((x) => x.id === 's3'), card = T.kanban_tasks.find((x) => x.id === 'card3')
    const d = { db: memDb(T), orgId: ORG, now: NOW + 60_000, enrolledPipeline: 'enrolled', owner: CAMERON, hubUrl: 'https://hub.example', isTest: () => false, slack: async () => ({ ok: true, code: null }) }
    const f = { contactId: C(3), kind: 'inbound_no_reply', key: `${C(3)}:inbound_no_reply:mm9`, triggerId: 'mm9', since: ago(30), detail: { message_id: 'mm9' } }
    const raised = await run.raiseCandidates(d, [f], new Set(), new Map([[C(3), 'P3']]))
    ok('R_CLEARS_TOUCHPOINT', s.cleared_at && /no reply needed: handled elsewhere, by Cameron Allen/.test(s.cleared_reason) && card.column_id === 'col-done'
      && /Cleared: no reply needed/.test(card.description) && raised === 0, { reason: s.cleared_reason, col: card.column_id, raised })
  }

  // R_CLEARS_STL: an open lead_no_touch_24h task; resolved; then the scan
  {
    const T = world()
    T.tasks.push({ id: 'task4', org_id: ORG, contact_id: C(4), source: 'hub_followup:lead_no_touch_24h', status: 'todo', hub_task_id: null })
    await res(T, { contactId: C(4), scope: 'speed_to_lead', reason: 'not_a_lead' })
    const cfg = lrules.parseConfig(ORG, { mode: 'dry_run', assignee: CAMERON })
    const ctx = { db: memDb(T), orgId: ORG, cfg, routes: new Map(), now: NOW + 60_000, deadline: Date.now() + 60_000, counts: {} }
    T.contacts = T.contacts.filter((c) => c.id === C(4) || c.id === C(5)) // C(5): an unresolved lead the scan still owes
    await scan.scanLeads(ctx)
    const events = T.hub_lifecycle_events.filter((e) => e.event_type === 'lead_no_touch_24h').map((e) => e.contact_id)
    ok('R_CLEARS_STL', T.tasks.find((t) => t.id === 'task4').status === 'done' && !events.includes(C(4)) && events.includes(C(5)), { task: T.tasks[0].status, events })
  }

  // R_REOPENS_ON_INBOUND: resolved, then they text again; the raise step raises them again
  {
    const T = world()
    T.conversations.push({ id: 'cv6', org_id: ORG, contact_id: C(6), line_e164: null, last_message_at: ago(1) })
    await res(T, { contactId: C(6), scope: 'all', reason: 'conversation_ended' })
    const before = (await live(T, C(6), 'touchpoint')).has(C(6))
    T.crm_messages.push({ id: 'm6', conversation_id: 'cv6', direction: 'inbound', status: 'received', created_at: at(NOW + 5 * 60_000), body: 'one more thing' })
    const after = (await live(T, C(6), 'touchpoint', NOW + 10 * 60_000)).has(C(6))
    const row = T.hub_contact_resolutions[0]
    const d = { db: memDb(T), orgId: ORG, now: NOW + 10 * 60_000, enrolledPipeline: 'enrolled', owner: CAMERON, hubUrl: 'https://hub.example', isTest: () => false, slack: async () => ({ ok: true, code: null }) }
    const f = { contactId: C(6), kind: 'text_no_reply', key: `${C(6)}:text_no_reply:m6`, triggerId: 'm6', since: at(NOW + 5 * 60_000), detail: { message_id: 'm6' } }
    const raised = await run.raiseCandidates(d, [f], new Set(), new Map([[C(6), 'P6']]))
    ok('R_REOPENS_ON_INBOUND', before && !after && row.reopened_at && row.reopened_reason === 'new_inbound' && raised === 1, { before, after, reason: row.reopened_reason, raised })
  }

  // R_REOPEN_MANUAL
  {
    const T = world()
    const r = await res(T, { contactId: C(1), scope: 'touchpoint', reason: 'spam' })
    const back = await resolve.reopenResolution(memDb(T), ORG, r.body.id, SHANE, NOW + 60_000)
    const row = T.hub_contact_resolutions[0]
    const still = (await live(T, C(1), 'touchpoint')).has(C(1))
    const again = await res(T, { contactId: C(1), scope: 'touchpoint', reason: 'spam', now: NOW + 120_000 })
    ok('R_REOPEN_MANUAL', back.status === 200 && row.reopened_reason === 'manual' && row.reopened_at && !still && again.status === 200 && T.hub_contact_resolutions.length === 2,
      { back: back.status, reason: row.reopened_reason, still, again: again.status })
  }

  // R_RETURNING_CHIP: a lead who bought before
  {
    const T = world()
    T.hub_lifecycle_events.push({ id: 'ev-buy', org_id: ORG, contact_id: C(5), event_type: 'purchase', occurred_at: ago(24 * 200) })
    const cfg = lrules.parseConfig(ORG, { mode: 'live', assignee: CAMERON })
    const opened = await ledger.openTask(memDb(T), cfg, { id: 'ev-l', org_id: ORG, contact_id: C(5), event_type: 'lead_no_touch_24h' }, 'lead_no_touch_24h')
    const task = T.tasks.find((t) => t.contact_id === C(5))
    const flagged = (await ret.returningContacts(memDb(T), [C(5), C(1)]))
    const alert = compose.composeAlert({ source: 'form', name: 'P5', label: 'Contact us', outcome: null, email: 'p5@example.com', phone: null, startsAt: null, contactId: C(5), returning: flagged.has(C(5)) }, 'https://hub.example')
    ok('R_RETURNING_CHIP', opened === 'opened' && task && /\(returning\)$/.test(task.title) && flagged.has(C(5)) && !flagged.has(C(1)) && /^New lead: P5 \[returning\]/.test(alert),
      { opened, title: task?.title, alert: alert.split('\n')[0] })
  }

  // R_TASK_FK_FALLBACK: the configured assignee has no team_members row
  {
    const T = world()
    const cfg = lrules.parseConfig(ORG, { mode: 'live', assignee: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
    let threw = null, opened = null
    try { opened = await ledger.openTask(memDb(T), cfg, { id: 'ev-f', org_id: ORG, contact_id: C(2), event_type: 'lead_no_touch_24h' }, 'lead_no_touch_24h') } catch (e) { threw = String(e.message) }
    const task = T.tasks.find((t) => t.contact_id === C(2))
    const log = T.job_runs.filter((j) => j.job === 'lifecycle-task-fallback')
    ok('R_TASK_FK_FALLBACK', !threw && opened === 'opened_default_owner' && task?.assigned_to === 'tm-cameron' && log.length === 1 && log[0].detail.why === 'default_owner'
      && log[0].detail.used === 'tm-cameron', { threw, opened, assigned: task?.assigned_to, log: log.map((j) => j.detail) })
  }

  // R_SHARED_ACROSS_USERS: resolved as Cameron, read as Shane through the route; Shane's second resolve is refused
  {
    const T = world()
    await res(T, { contactId: C(3), scope: 'text_waiting', reason: 'conversation_ended' })
    global.__ctx = { db: memDb(T), userId: SHANE, isSuperadmin: true, orgIds: [ORG], orgRoles: {} }
    const got = await route.GET({ nextUrl: { searchParams: new URLSearchParams({ contact_id: C(3) }) } }, {})
    const list = got.body?.resolutions ?? []
    const shaneTries = await res(T, { contactId: C(3), scope: 'text_waiting', reason: 'spam', byUserId: SHANE })
    const sameForBoth = (await live(T, C(3), 'text_waiting')).has(C(3))
    ok('R_SHARED_ACROSS_USERS', got.status === 200 && list.length === 1 && list[0].by === 'Cameron Allen' && list[0].reason_text === 'Conversation ended'
      && shaneTries.status === 409 && sameForBoth && T.hub_contact_resolutions.length === 1, { status: got.status, list, shane: shaneTries.status })
  }

  H.report(rows, active, RED_OF)
})().catch((e) => { console.error(e); process.exit(2) })
