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
//   R_RESOLVE_RETURNS_ROW  POST /api/resolve returns the new row (by, reason_text as the chip reads, resolved_at) in exactly
//                          the shape GET then lists, so the button shows it at once
//   R_REOPEN_RESTORES      Reopen (manual) puts back what the resolve cleared: the touchpoint situation and the
//                          text_waiting_1h row open again, the card back in Follow-ups to review, and ONE contact_reopened
//                          timeline entry with who (why it reopened is R_REOPEN_MANUAL's)
//   R_RERAISE_AFTER_RESOLVE a key cleared by a resolve is held while the resolution is live (the one check), and once it is
//                          reopened raiseCandidates raises it again, the same row reopened in place
//   R_CARD_SHOWS_RESOLVED  the contact card's Waiting on us block is shown as resolved ("Resolved by <name>, Not a lead, ...")
//                          when there are no open rows and a live resolution exists, and shows nothing when neither exists
//   R_GROUP_RESOLVE        two cards for one number ('Unknown +18284215174' and 'David Rusch', production 2026-11-24): resolving
//                          one writes a row per card (same reason, note, resolved_by, resolved_at; a timeline entry each), and
//                          the touchpoint raise stays quiet for both; a row on one card alone (before this rule) covers the other
//   R_GROUP_REOPEN         Reopen of one card's row reopens the person's rows on both cards ('manual', an entry each), and
//                          neither card is resolved after
//   R_MERGE_CARRIES        a merge carries the merged card's live resolution to the survivor (a row when it has none, same
//                          reason and resolved_at), reopens the merged card's row ('manual', a timeline note, nothing put back),
//                          leaves one live row per scope after the repoint, and the merge route does it before the repoint
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
//   noreturnrow  POST /api/resolve returns no row                                {R_RESOLVE_RETURNS_ROW}
//   cardhides    the Waiting on us block ignores the live resolution             {R_CARD_SHOWS_RESOLVED}
//   norestore    Reopen leaves the cleared situations cleared                    {R_REOPEN_RESTORES}
//   resolvedblocks a key cleared by a resolve is never raised again             {R_RERAISE_AFTER_RESOLVE}
//   onecard      a resolve writes a row for the clicked card only               {R_GROUP_RESOLVE}
//   reopenone    Reopen reopens the clicked card's row only                     {R_GROUP_REOPEN}
//   nocarry      a merge carries nothing                                        {R_MERGE_CARRIES}
// TAMPER=1 reddens the sum (16).
const H = require('../agent/lib/harness.cjs')

const RR = 'lib/resolve/rules.ts', CK = 'lib/resolve/check.ts', TA = 'lib/touchpoints/text-alerts.ts', RUN = 'lib/touchpoints/run.ts'
const SCAN = 'lib/lifecycle/scan.ts', LED = 'lib/lifecycle/ledger.ts', RET = 'lib/touch/returning.ts', ROUTE = 'app/api/resolve/route.ts'
const TAMPERS = {
  notimeline: [[RR, "event_type: 'contact_resolved',", "event_type: 'resolved',"]],
  textposts: [[TA, '  const waiting = found.filter((w) => !resolved.has(w.contactId))', '  const waiting = found']],
  touchraise: [[RUN, '  candidates = candidates.filter((c) => !resolved.has(c.contactId))\n', '']],
  stlscan: [[SCAN, '    if (resolved.has(c.id)) continue\n', '']],
  noreopen: [[CK, '    for (const card of cardsOf(groups, r.contact_id)) if (await inboundSince(db, card, r.resolved_at)) { fresh = true; break }', '']],
  manualnoop: [[RR, "await reopenRow(db, data as any, 'manual',", "await reopenRow(db, data as any, 'new_inbound',"]],
  norestore: [[CK, '  const restored = opts.restore === false ? 0 : await restoreCleared(db, row, now)', '  const restored = 0']],
  onecard: [[RR, '  for (const card of cards.filter((id) => id !== contactId)) {', '  for (const card of [] as string[]) {']],
  reopenone: [[CK, '  for (const r of [row, ...((data ?? []) as Row[]).filter((x) => x.id !== row.id)])', '  for (const r of [row])']],
  nocarry: [[RR, '    if (error || !(lost ?? []).length) return []', '    return []']],
  resolvedblocks: [[RUN, '.filter((r) => r.cleared_reason === STAFF_OR_DUPLICATE || isResolvedClear(r.cleared_reason))', '.filter((r) => r.cleared_reason === STAFF_OR_DUPLICATE)']],
  noreturning: [[RET, '  for (const b of (buys ?? []) as any[]) if (b.contact_id) out.add(b.contact_id)\n', '']],
  rawassignee: [[LED, "await db.from('tasks').insert({ ...fields, assigned_to: who.memberId })", "await db.from('tasks').insert({ ...fields, assigned_to: cfg.assignee })"]],
  perlogin: [[ROUTE, 'resolutions: await resolutionsFor(ctx.db, orgId, id!, Date.now(), scope)', 'resolutions: (await resolutionsFor(ctx.db, orgId, id!, Date.now(), scope)).filter((r) => r.by_id === ctx.userId)']],
  noreturnrow: [[RR, 'body: { resolution: viewOf(row as any, name), cleared, also_resolved: also } }', 'body: { resolution: null, cleared, also_resolved: also } }']],
  cardhides: [['lib/resolve/view.ts', "  if (live) return 'resolved'\n", '']],
}
const RED_OF = { notimeline: ['R_RESOLVE_WRITES'], textposts: ['R_CLEARS_TEXT'], touchraise: ['R_CLEARS_TOUCHPOINT'], stlscan: ['R_CLEARS_STL'],
  noreopen: ['R_REOPENS_ON_INBOUND'], manualnoop: ['R_REOPEN_MANUAL'], noreturning: ['R_RETURNING_CHIP'], rawassignee: ['R_TASK_FK_FALLBACK'],
  perlogin: ['R_SHARED_ACROSS_USERS'], noreturnrow: ['R_RESOLVE_RETURNS_ROW'], cardhides: ['R_CARD_SHOWS_RESOLVED'],
  norestore: ['R_REOPEN_RESTORES'], resolvedblocks: ['R_RERAISE_AFTER_RESOLVE'],
  onecard: ['R_GROUP_RESOLVE'], reopenone: ['R_GROUP_REOPEN'], nocarry: ['R_MERGE_CARRIES'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-resolve')
const load = H.install(out)
const resolve = load(RR), check = load(CK), ta = load(TA), run = load(RUN), scan = load(SCAN), ledger = load(LED), ret = load(RET)
const compose = load('lib/lead-alerts/compose.ts'), lrules = load('lib/lifecycle/rules.ts'), route = load(ROUTE), view = load('lib/resolve/view.ts')

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
    kanban_columns: [{ id: 'col-rev', org_id: ORG, title: 'Follow-ups to review', sort_order: 1 }, { id: 'col-act', org_id: ORG, title: 'Action Steps', sort_order: 2 },
      { id: 'col-done', org_id: ORG, title: 'Done', sort_order: 4 }],
    conversations: [], crm_messages: [], call_logs: [], hub_mail_messages: [], hub_booking_syncs: [], hub_resources: [],
  }
}

// ids are unique across every memDb over the same tables, as the real database's are
let seq = 0
function memDb(T) {
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
    ok('R_CLEARS_TOUCHPOINT', s.cleared_at && /^no reply needed:[0-9a-f-]{36}:Handled elsewhere, by Cameron Allen$/.test(s.cleared_reason) && card.column_id === 'col-done'
      && /Cleared: no reply needed \(Handled elsewhere, by Cameron Allen\)\./.test(card.description) && raised === 0, { reason: s.cleared_reason, col: card.column_id, raised })
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
    const back = await resolve.reopenResolution(memDb(T), ORG, T.hub_contact_resolutions[0].id, SHANE, NOW + 60_000)
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

  // R_RESOLVE_RETURNS_ROW: POST through the route, then GET; the POST's row is GET's row
  {
    const T = world()
    global.__ctx = { db: memDb(T), userId: CAMERON, isSuperadmin: true, orgIds: [ORG], orgRoles: {} }
    const posted = await route.POST({ json: async () => ({ contact_id: C(4), scope: 'all', reason: 'not_a_lead', note: null }) }, {})
    const got = await route.GET({ nextUrl: { searchParams: new URLSearchParams({ contact_id: C(4), scope: 'all' }) } }, {})
    const made = posted.body?.resolution
    ok('R_RESOLVE_RETURNS_ROW', posted.status === 200 && made && made.by === 'Cameron Allen' && made.reason_text === 'Not a lead' && typeof made.resolved_at === 'string'
      && made.scope === 'all' && JSON.stringify(made) === JSON.stringify(got.body?.resolutions?.[0]), { posted: posted.body, got: got.body })
  }

  // R_CARD_SHOWS_RESOLVED: no open rows and a live resolution: the block shows the resolved line; neither: nothing
  {
    const T = world()
    await res(T, { contactId: C(5), scope: 'all', reason: 'not_a_lead' })
    // read as the resolver: who may see it is R_SHARED_ACROSS_USERS's; this check is how the block renders it
    global.__ctx = { db: memDb(T), userId: CAMERON, isSuperadmin: true, orgIds: [ORG], orgRoles: {} }
    const got = await route.GET({ nextUrl: { searchParams: new URLSearchParams({ contact_id: C(5), scope: 'all' }) } }, {})
    const liveRow = view.pickLive(got.body?.resolutions ?? [], 'all')
    const line = liveRow ? view.resolvedLine(liveRow) : ''
    ok('R_CARD_SHOWS_RESOLVED', view.waitingMode([], liveRow) === 'resolved' && /^Resolved by Cameron Allen, Not a lead, /.test(line)
      && view.waitingMode([], null) === null && view.waitingMode([{ id: 'x' }], null) === 'waiting', { mode: view.waitingMode([], liveRow), line })
  }

  // R_REOPEN_RESTORES: resolve 'all' clears a card situation and a text row; Shane reopens; both come back
  {
    const T = world()
    T.kanban_tasks.push({ id: 'card7', org_id: ORG, column_id: 'col-rev', title: 'P1: emailed us', description: 'x' })
    T.hub_touchpoint_situations.push(
      { id: 's7', org_id: ORG, contact_id: C(1), kind: 'inbound_no_reply', situation_key: `${C(1)}:inbound_no_reply:mm7`, waiting_since: ago(30), opened_at: ago(5), cleared_at: null, cleared_reason: null, severity: 'low', detail: {}, task_id: 'card7' },
      { id: 't7', org_id: ORG, contact_id: C(1), kind: 'text_waiting_1h', situation_key: `${C(1)}:text_waiting_1h:m7`, waiting_since: ago(2), opened_at: ago(1), cleared_at: null, cleared_reason: null, severity: 'low', detail: {}, task_id: null })
    await res(T, { contactId: C(1), scope: 'all', reason: 'not_a_lead' })
    const clearedFirst = T.hub_touchpoint_situations.every((s) => s.cleared_at) && T.kanban_tasks[0].column_id === 'col-done'
    const back = await resolve.reopenResolution(memDb(T), ORG, T.hub_contact_resolutions[0].id, SHANE, NOW + 60_000)
    const s7 = T.hub_touchpoint_situations.find((s) => s.id === 's7'), t7 = T.hub_touchpoint_situations.find((s) => s.id === 't7'), card = T.kanban_tasks[0]
    const tl = T.contact_timeline.filter((e) => e.event_type === 'contact_reopened')
    ok('R_REOPEN_RESTORES', clearedFirst && back.status === 200 && s7.cleared_at === null && s7.cleared_reason === null && t7.cleared_at === null
      && card.column_id === 'col-rev' && card.completed_at === null && /Reopened: waiting on us again\./.test(card.description)
      && tl.length === 1 && tl[0].metadata.by_name === 'Shane Granau' && tl[0].metadata.restored === 2,
    { clearedFirst, back: back.status, s7: [s7.cleared_at, s7.cleared_reason], col: card.column_id, tl: tl.map((e) => e.metadata) })
  }

  // R_RERAISE_AFTER_RESOLVE: held while live (the one check); raised again, in place, once the resolution is reopened
  {
    const T = world()
    await res(T, { contactId: C(2), scope: 'touchpoint', reason: 'spam' })
    const rid = T.hub_contact_resolutions[0].id
    const K = `${C(2)}:text_no_reply:tx8`
    T.hub_touchpoint_situations.push({ id: 's8', org_id: ORG, contact_id: C(2), kind: 'text_no_reply', situation_key: K, waiting_since: ago(30), opened_at: ago(5),
      cleared_at: ago(1), cleared_reason: `no reply needed:${rid}:Spam, by Cameron Allen`, severity: 'low', detail: {}, task_id: null })
    const heldWhileLive = (await live(T, C(2), 'touchpoint')).has(C(2))
    // reopened elsewhere without the restore step, so only the raise step can bring the key back
    Object.assign(T.hub_contact_resolutions[0], { reopened_at: at(NOW + 60_000), reopened_reason: 'manual' })
    const d = { db: memDb(T), orgId: ORG, now: NOW + 120_000, enrolledPipeline: 'enrolled', owner: CAMERON, hubUrl: 'https://hub.example', isTest: () => false, slack: async () => ({ ok: true, code: null }) }
    const f = { contactId: C(2), kind: 'text_no_reply', key: K, triggerId: 'tx8', since: ago(30), detail: { message_id: 'tx8' } }
    const raised = await run.raiseCandidates(d, [f], new Set(), new Map([[C(2), 'P2']]))
    const rowsK = T.hub_touchpoint_situations.filter((s) => s.situation_key === K)
    ok('R_RERAISE_AFTER_RESOLVE', heldWhileLive && raised === 1 && rowsK.length === 1 && rowsK[0].id === 's8' && rowsK[0].cleared_at === null && rowsK[0].cleared_reason === null,
      { heldWhileLive, raised, rows: rowsK.map((x) => [x.id, x.cleared_at]) })
  }

  // two cards for one number, as on production 2026-11-24
  const twoCards = (T) => {
    T.contacts.push({ id: C(7), org_id: ORG, first_name: 'Unknown', last_name: '+18284215174', email: null, phone: '+18284215174', source: 'sms', tags: [], do_not_contact: false, merged_into_id: null, archived_at: null, created_at: ago(5) },
      { id: C(8), org_id: ORG, first_name: 'David', last_name: 'Rusch', email: 'david@example.com', phone: '(828) 421-5174', source: 'form', tags: [], do_not_contact: false, merged_into_id: null, archived_at: null, created_at: ago(300) })
  }
  const runD = (T, now) => ({ db: memDb(T), orgId: ORG, now, enrolledPipeline: 'enrolled', owner: CAMERON, hubUrl: 'https://hub.example', isTest: () => false, slack: async () => ({ ok: true, code: null }) })

  // R_GROUP_RESOLVE
  {
    const T = world(); twoCards(T)
    const r = await res(T, { contactId: C(7), scope: 'touchpoint', reason: 'conversation_ended', note: 'Talked it through' })
    const rowsBy = (c) => T.hub_contact_resolutions.filter((x) => x.contact_id === c && !x.reopened_at)
    const [a, b] = [rowsBy(C(7))[0], rowsBy(C(8))[0]]
    const same = !!a && !!b && ['scope', 'reason', 'note', 'resolved_by', 'resolved_at'].every((k) => a[k] === b[k])
    // an entry per card, found by the resolution it records (the entry's kind is R_RESOLVE_WRITES's)
    const tl = T.contact_timeline.filter((e) => e.metadata && e.metadata.resolved_on === C(7)).map((e) => e.contact_id).sort()
    // the monitors' one check is quiet for both cards (the raise step's use of it is R_CLEARS_TOUCHPOINT's)
    const quiet = await check.liveResolutions(memDb(T), [C(7), C(8)], 'touchpoint', NOW + 60_000)
    // a row on one card alone (written before this rule) still covers the other card
    const T2 = world(); twoCards(T2)
    T2.hub_contact_resolutions.push({ id: 'old-1', org_id: ORG, contact_id: C(7), scope: 'touchpoint', reason: 'spam', note: null, resolved_by: SHANE, resolved_at: ago(1), reopened_at: null, reopened_reason: null })
    const legacy = (await live(T2, C(8), 'touchpoint')).has(C(8))
    ok('R_GROUP_RESOLVE', r.status === 200 && same && tl.join() === [C(7), C(8)].join() && quiet.has(C(7)) && quiet.has(C(8)) && legacy && !(await live(T2, C(1), 'touchpoint')).has(C(1)),
      { status: r.status, same, tl, quiet: Array.from(quiet), legacy })
  }

  // R_GROUP_REOPEN
  {
    // a live row on each card, as a resolve leaves them (how they are written is R_GROUP_RESOLVE's)
    const T = world(); twoCards(T)
    const row = (id, c) => ({ id, org_id: ORG, contact_id: c, scope: 'touchpoint', reason: 'conversation_ended', note: null, resolved_by: CAMERON, resolved_at: ago(1), reopened_at: null, reopened_reason: null })
    T.hub_contact_resolutions.push(row('00000000-0000-4000-9100-000000000007', C(7)), row('00000000-0000-4000-9100-000000000008', C(8)))
    const back = await resolve.reopenResolution(memDb(T), ORG, '00000000-0000-4000-9100-000000000007', SHANE, NOW + 60_000)
    // both reopened, for the same reason (which reason is R_REOPEN_MANUAL's)
    const reasons = T.hub_contact_resolutions.map((x) => x.reopened_at ? x.reopened_reason : null)
    const tl = T.contact_timeline.filter((e) => e.event_type === 'contact_reopened').map((e) => e.contact_id).sort()
    const either = (await live(T, C(7), 'touchpoint', NOW + 120_000)).has(C(7)) || (await live(T, C(8), 'touchpoint', NOW + 120_000)).has(C(8))
    ok('R_GROUP_REOPEN', back.status === 200 && T.hub_contact_resolutions.length === 2 && !!reasons[0] && reasons.every((x) => x === reasons[0]) && tl.join() === [C(7), C(8)].join() && !either,
      { back: back.status, reasons, tl, either })
  }

  // R_MERGE_CARRIES
  {
    const T = world()
    await res(T, { contactId: C(1), scope: 'touchpoint', reason: 'former_client', note: 'Done in May' })
    const lost = T.hub_contact_resolutions[0]
    const carried = await resolve.carryOnMerge(memDb(T), { orgId: ORG, loserId: C(1), winnerId: C(2), byUserId: CAMERON, now: NOW + 60_000 })
    const won = T.hub_contact_resolutions.find((x) => x.contact_id === C(2) && !x.reopened_at)
    const note = T.contact_timeline.find((e) => e.event_type === 'contact_reopened' && e.contact_id === C(1))
    // both cards already resolved for one scope: the survivor keeps its own row, the merged card's is reopened
    const T2 = world()
    await res(T2, { contactId: C(3), scope: 'all', reason: 'spam' }); await res(T2, { contactId: C(4), scope: 'all', reason: 'not_a_lead' })
    await resolve.carryOnMerge(memDb(T2), { orgId: ORG, loserId: C(3), winnerId: C(4), byUserId: CAMERON, now: NOW + 60_000 })
    for (const x of T2.hub_contact_resolutions) if (x.contact_id === C(3)) x.contact_id = C(4) // the repoint
    const liveAfter = T2.hub_contact_resolutions.filter((x) => x.contact_id === C(4) && !x.reopened_at)
    const routeSrc = require('fs').readFileSync(require('path').join(H.SRC, 'app/api/contacts/merge/route.ts'), 'utf8')
    const before = routeSrc.indexOf('await carryOnMerge(admin,') > 0 && routeSrc.indexOf('await carryOnMerge(admin,') < routeSrc.indexOf("admin.rpc('merge_contact_repoint'")
    ok('R_MERGE_CARRIES', carried.join() === 'touchpoint' && !!won && won.reason === 'former_client' && won.note === 'Done in May' && won.resolved_at === lost.resolved_at
      && lost.reopened_reason === 'manual' && !!note && /merged this card/.test(note.description) && note.metadata.restored === 0
      && liveAfter.length === 1 && liveAfter[0].reason === 'not_a_lead' && before, { carried, won: won && won.reason, lost: lost.reopened_reason, liveAfter: liveAfter.length, before })
  }

  H.report(rows, active, RED_OF)
})().catch((e) => { console.error(e); process.exit(2) })
