#!/usr/bin/env node
// scripts/touchpoints/touchpoints-tamper.cjs   (Running List q35, touchpoint monitoring Part 1)
//
// Runs the REAL monitor (src/lib/touchpoints: detect.ts, run.ts, rules.ts, with the real one touch rule and the real
// lifecycle activity reader) against an in-memory database that stores rows and applies filters but enforces NO
// unique constraint, so the code's own once-only rules are what is tested. Now is Friday 2026-11-20, 10:00 AM ET.
// Checks, from intent:
//   S_BOOK     a booking link shared 3 days ago with no booking since raises booking_link_not_booked, with a card
//   S_MAIL     an email received 2 days ago with no reply from that mailbox raises inbound_no_reply, with a card
//   S_TEXT     a last inbound text 2 days old with no outbound since raises text_no_reply, with a card
//   S_COURSE   an Enrolled client (stage not Completed) with no lesson or practice for 10 days raises coursework_quiet
//   S_DISC     a discovery booking that ended 3 days ago with no touch since raises discovery_no_followup
//              (each detection check: one situation row for that contact and kind, and its card in Follow-ups to review)
//   S_ONCE     a key raised before (already cleared) is never raised again, and a second run raises nothing new
//   S_CLEAR    an open inbound_no_reply clears when we reply: cleared_at and the reason set, its card in Done with
//              "Cleared on its own: we replied"
//   S_EXCLUDE  a contact tagged test and a staff member's own contact are never eligible for a card
//   S_NOCONTENT the inbound_no_reply check selects no subject, body, snippet or summary, and stores none
//   S_DIGEST   the daily Slack suggestion goes once per recipient on the first run after 8 AM ET, never again that day,
//              and never before 8 AM
//   S_STAFF2   a staff member's second address (their auth user email, not their profile's) gets no card, nor does the
//              address of a platform admin profile that is an owner or admin of THIS Hub org (org_members) with no team row
//   S_MAILBOX  a contact whose email is a connected mailbox address gets no card
//   S_DUP      two contacts sharing an email (case and spaces aside) are one person: ONE situation per kind, on the more
//              recently active contact (its own when it has one), with the other's id in detail.duplicate_of
//   S_CLEARSTAFF an open situation whose contact turns out to be staff is cleared as staff_or_duplicate, with that note
//   S_OTHERORG a platform admin of ANOTHER org (a client running their own University org) is not staff: still eligible
//   S_REOPEN   a situation cleared as staff_or_duplicate reopens, the same row and a new card, once its contact is no
//              longer excluded (the key is unique per org, so it is the same row, not a second one)
//
//   bookskip     the booking-link wait is 100 times longer                 {S_BOOK}
//   mailskip     the email wait is 100 times longer                        {S_MAIL}
//   textskip     the text wait is 100 times longer                         {S_TEXT}
//   courseskip   quiet time is measured from now                           {S_COURSE}
//   discskip     the discovery wait is 100 times longer                    {S_DISC}
//   twice        a key raised before may be raised again                   {S_ONCE}
//   noclearmove  a cleared situation's card stays where it is              {S_CLEAR}
//   letin        test and staff contacts are eligible                      {S_EXCLUDE}
//   readsubject  the inbound check also reads the subject                  {S_NOCONTENT}
//   dailyagain   the daily message ignores today's claim                   {S_DIGEST}
//   staff_second_email     auth user emails are not read                  {S_STAFF2}
//   staff_mailbox_address  connected mailbox addresses are not staff      {S_MAILBOX}
//   duplicate_pair         duplicates are not collapsed                   {S_DUP}
//   clear_on_staff         open rows of staff contacts are not cleared as staff_or_duplicate  {S_CLEARSTAFF}
//   other_org_admin        an admin of any org counts as staff            {S_OTHERORG}
//   reopen_after_clear     a staff_or_duplicate clear blocks the key for good  {S_REOPEN}
// TAMPER=1 reddens the sum (16).
const H = require('../agent/lib/harness.cjs')

const D = 'lib/touchpoints/detect.ts', RUN = 'lib/touchpoints/run.ts', RU = 'lib/touchpoints/rules.ts'
const TAMPERS = {
  bookskip: [[D, 'if (now - Date.parse(l.created_at) < THRESHOLDS.booking_link_not_booked) continue', 'if (now - Date.parse(l.created_at) < THRESHOLDS.booking_link_not_booked * 100) continue']],
  mailskip: [[D, 'now - Date.parse(waiting.received_at) < THRESHOLDS.inbound_no_reply)', 'now - Date.parse(waiting.received_at) < THRESHOLDS.inbound_no_reply * 100)']],
  textskip: [[D, 'now - Date.parse(last.created_at) < THRESHOLDS.text_no_reply)', 'now - Date.parse(last.created_at) < THRESHOLDS.text_no_reply * 100)']],
  courseskip: [[D, 'const last = Math.max(Date.parse(pos.moved_at) || 0, ...times)', 'const last = Math.max(now, Date.parse(pos.moved_at) || 0, ...times)']],
  discskip: [[D, 'if (now - Date.parse(h.at) < THRESHOLDS.discovery_no_followup) continue', 'if (now - Date.parse(h.at) < THRESHOLDS.discovery_no_followup * 100) continue']],
  twice: [[RU, '    if (knownKeys.has(s.key)) continue\n', '']],
  noclearmove: [[RUN, '  if (doneCol) patch.column_id = doneCol\n', '']],
  letin: [[RUN, 'if (c.do_not_contact || d.isTest(c)) continue', 'if (c.do_not_contact) continue']],
  staff_second_email: [[RUN, '    addE(r?.data?.user?.email)\n', '']],
  staff_mailbox_address: [[RUN, '  for (const b of (boxes ?? []) as any[]) addE(b.email_address)\n', '']],
  duplicate_pair: [[RUN, "    return dups?.length ? { ...f, detail: { ...f.detail, duplicate_of: dups.join(',') } } : f", '    return f']],
  clear_on_staff: [[RUN, 'const reason = elig.excluded.has(r.contact_id) ? STAFF_OR_DUPLICATE : clearReason(', 'const reason = clearReason(']],
  other_org_admin: [[RUN, ".from('org_members').select('user_id').eq('organization_id', orgId).eq('status', 'active')", ".from('org_members').select('user_id').eq('status', 'active')"]],
  reopen_after_clear: [[RUN, '.filter((r) => r.cleared_reason === STAFF_OR_DUPLICATE)', '.filter(() => false)']],
  readsubject: [[D, "export const INBOUND_COLUMNS = 'id, connection_id, gmail_thread_id, from_address, received_at'", "export const INBOUND_COLUMNS = 'id, connection_id, gmail_thread_id, from_address, received_at, subject'"]],
  dailyagain: [[RU, '  return claimedDays.includes(day) ? null : day', '  return day']],
}
const RED_OF = { bookskip: ['S_BOOK'], mailskip: ['S_MAIL'], textskip: ['S_TEXT'], courseskip: ['S_COURSE'], discskip: ['S_DISC'], twice: ['S_ONCE'],
  noclearmove: ['S_CLEAR'], letin: ['S_EXCLUDE'], readsubject: ['S_NOCONTENT'], dailyagain: ['S_DIGEST'],
  staff_second_email: ['S_STAFF2'], staff_mailbox_address: ['S_MAILBOX'], duplicate_pair: ['S_DUP'], clear_on_staff: ['S_CLEARSTAFF'],
  other_org_admin: ['S_OTHERORG'], reopen_after_clear: ['S_REOPEN'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-touchpoints')
const load = H.install(out)
const run = load(RUN)

const ORG = 'org-1', OWNER = 'owner-1', STAFF_USER = 'staff-1'
const NOW = Date.parse('2026-11-20T15:00:00Z') // 10:00 AM ET
const ago = (h) => new Date(NOW - h * 3_600_000).toISOString()
const contact = (id, extra = {}) => ({ id, org_id: ORG, first_name: id, last_name: null, email: `${id}@example.com`, phone: null, tags: [], do_not_contact: false, merged_into_id: null, archived_at: null, ...extra })

function world() {
  return {
    contacts: [contact('cbook'), contact('cmail'), contact('ctext'), contact('ccourse'), contact('cdisc'),
      contact('ctest', { tags: ['Test'] }), contact('cstaff', { email: 'staff@neuroprogeny.com' }),
      contact('csecond', { email: 'staff.second@gmail.com' }), contact('cadmin', { email: 'admin.person@gmail.com' }), contact('cbox', { email: 'admin@neuroprogeny.com' }), contact('cother', { email: 'other.admin@gmail.com' }),
      contact('cdupa', { email: 'dup@example.com', last_email_at: ago(1) }), contact('cdupb', { email: ' DUP@Example.com ', last_email_at: ago(200) })],
    team_profiles: [{ org_id: ORG, user_id: STAFF_USER, role: 'team_member', status: 'active', display_name: 'Staff' },
      { org_id: ORG, user_id: OWNER, role: 'super_admin', status: 'active', display_name: 'Owner' }],
    profiles: [{ id: STAFF_USER, email: 'staff@neuroprogeny.com', role: 'participant' }, { id: 'u-course', email: 'ccourse@example.com', role: 'participant' },
      { id: 'u-admin2', email: 'admin.person@gmail.com', role: 'admin' }, { id: 'u-other', email: 'other.admin@gmail.com', role: 'admin' }],
    // u-admin2 runs THIS Hub org; u-other is an admin of another org only (a client with their own University org)
    org_members: [{ user_id: 'u-admin2', organization_id: ORG, role: 'owner', status: 'active' }, { user_id: 'u-other', organization_id: 'org-client', role: 'admin', status: 'active' }],
    auth_users: [{ id: STAFF_USER, email: 'staff.second@gmail.com' }],
    hub_mail_connections: [{ id: 'box1', org_id: ORG, email_address: 'admin@neuroprogeny.com', owner_user_id: OWNER, visibility: 'private' }],
    hub_resources: [{ id: 'res-book', org_id: ORG, kind: 'booking_link' }],
    hub_resource_links: [
      { id: 'link1', org_id: ORG, resource_id: 'res-book', contact_id: 'cbook', created_at: ago(72), revoked_at: null },
      { id: 'link-test', org_id: ORG, resource_id: 'res-book', contact_id: 'ctest', created_at: ago(72), revoked_at: null },
    ],
    hub_booking_syncs: [{ org_id: ORG, booking_id: 'bk1', contact_id: 'cdisc', appointment_type: 'Discovery Call', starts_at: ago(73), ends_at: ago(72), status: 'arrived', first_synced_at: ago(100) }],
    hub_mail_messages: [{ id: 'mm1', connection_id: 'box1', gmail_thread_id: 'th1', from_address: 'cmail@example.com', received_at: ago(48), subject: 'SECRET', body: 'SECRET', summary: 'SECRET' },
      ...['staff.second@gmail.com', 'admin.person@gmail.com', 'admin@neuroprogeny.com', 'dup@example.com'].map((a, i) => ({ id: `mx${i}`, connection_id: 'box1', gmail_thread_id: `tx${i}`, from_address: a, received_at: ago(50) }))],
    hub_mail_sent: [],
    conversations: [{ id: 'cv1', org_id: ORG, contact_id: 'ctext', last_message_at: ago(48) }, { id: 'cv2', org_id: ORG, contact_id: 'cstaff', last_message_at: ago(48) }],
    crm_messages: [{ id: 'tx0', conversation_id: 'cv1', direction: 'outbound', created_at: ago(60) }, { id: 'tx1', conversation_id: 'cv1', direction: 'inbound', created_at: ago(48) },
      { id: 'tx9', conversation_id: 'cv2', direction: 'inbound', created_at: ago(48) }],
    pipelines: [{ id: 'pl-en', org_id: ORG, legacy_key: 'enrolled', name: 'Enrolled', position: 1, archived_at: null }],
    pipeline_stages: [{ id: 'st-active', org_id: ORG, pipeline_id: 'pl-en', legacy_key: 'active', name: 'Active', position: 1, archived_at: null }],
    contact_pipeline_positions: [{ org_id: ORG, contact_id: 'ccourse', pipeline_id: 'pl-en', stage_id: 'st-active', moved_at: ago(20 * 24), source: 'x' }],
    lesson_progress: [{ user_id: 'u-course', started_at: ago(10 * 24), completed_at: null }],
    hub_lifecycle_events: [],
    kanban_columns: [{ id: 'col-cap', org_id: ORG, title: 'Capture', sort_order: 0 }, { id: 'col-act', org_id: ORG, title: 'Action Steps', sort_order: 1 },
      { id: 'col-done', org_id: ORG, title: 'Done', sort_order: 4 }, { id: 'col-trash', org_id: ORG, title: 'Trash', sort_order: 6 }],
    kanban_tasks: [], hub_touchpoint_situations: [], job_runs: [],
  }
}

function memDb(T) {
  const calls = []
  let seq = 0
  const cmp = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return Number.isNaN(x) || Number.isNaN(y) ? String(a).localeCompare(String(b)) : x - y }
  return {
    calls,
    auth: { admin: { getUserById: async (id) => ({ data: { user: (T.auth_users || []).find((u) => u.id === id) ?? null }, error: null }) } },
    rpc: async () => ({ data: null, error: null }),
    from(table) {
      const ops = []
      const b = {}
      for (const m of ['select', 'eq', 'neq', 'is', 'not', 'in', 'gte', 'lte', 'like', 'ilike', 'order', 'limit', 'range', 'insert', 'update', 'upsert']) b[m] = (...a) => { ops.push([m, a]); return b }
      const filt = (rows) => {
        for (const [m, a] of ops) {
          if (m === 'eq') rows = rows.filter((r) => r[a[0]] === a[1])
          if (m === 'neq') rows = rows.filter((r) => r[a[0]] !== a[1])
          if (m === 'is') rows = rows.filter((r) => (r[a[0]] ?? null) === a[1])
          if (m === 'not' && a[1] === 'is') rows = rows.filter((r) => (r[a[0]] ?? null) !== a[2])
          if (m === 'in') rows = rows.filter((r) => a[1].includes(r[a[0]]))
          if (m === 'gte') rows = rows.filter((r) => r[a[0]] != null && cmp(r[a[0]], a[1]) >= 0)
          if (m === 'lte') rows = rows.filter((r) => r[a[0]] != null && cmp(r[a[0]], a[1]) <= 0)
          if (m === 'like') rows = rows.filter((r) => String(r[a[0]] ?? '').startsWith(String(a[1]).replace(/%$/, '')))
          if (m === 'ilike') rows = rows.filter((r) => String(r[a[0]] ?? '').toLowerCase() === String(a[1]).replace(/\\(.)/g, '$1').toLowerCase())
        }
        return rows
      }
      const exec = (mode) => {
        calls.push({ table, ops })
        T[table] = T[table] || []
        const ins = ops.find((o) => o[0] === 'insert'), upd = ops.find((o) => o[0] === 'update')
        if (ins) {
          const list = (Array.isArray(ins[1][0]) ? ins[1][0] : [ins[1][0]]).map((r) => ({ id: `${table}-${++seq}`, cleared_at: null, ...r }))
          T[table].push(...list)
          return { data: mode === 'one' ? list[0] : list, error: null }
        }
        if (upd) { const rows = filt(T[table]); for (const r of rows) Object.assign(r, upd[1][0]); return mode === "one" ? (rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116" } }) : { data: rows, error: null } }
        let rows = filt(T[table].slice())
        const ord = ops.find((o) => o[0] === 'order')
        if (ord) rows.sort((x, y) => (ord[1][1]?.ascending === false ? -1 : 1) * cmp(x[ord[1][0]], y[ord[1][0]]))
        const rg = ops.find((o) => o[0] === 'range'); if (rg) rows = rows.slice(rg[1][0], rg[1][1] + 1)
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

const isTest = (c) => (c.tags ?? []).some((t) => /\btest\b/i.test(String(t)))
function deps(T, now = NOW, sent = []) {
  return { db: memDb(T), orgId: ORG, now, enrolledPipeline: 'enrolled', owner: OWNER, hubUrl: 'https://hub.example', isTest,
    slack: async (org, user, text) => { sent.push({ user, text }); return { ok: true, code: null } } }
}
const situ = (T, contactId, kind) => T.hub_touchpoint_situations.filter((s) => s.contact_id === contactId && s.kind === kind)
const reviewCol = (T) => T.kanban_columns.find((c) => c.title === 'Follow-ups to review')

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

;(async () => {
  // ── detection, one world ──
  const W = world()
  await run.runTouchpoints(deps(W))
  for (const [id, c, kind] of [['S_BOOK', 'cbook', 'booking_link_not_booked'], ['S_MAIL', 'cmail', 'inbound_no_reply'], ['S_TEXT', 'ctext', 'text_no_reply'],
    ['S_COURSE', 'ccourse', 'coursework_quiet'], ['S_DISC', 'cdisc', 'discovery_no_followup']]) {
    const s = situ(W, c, kind)
    const card = s[0] && W.kanban_tasks.find((t) => t.id === s[0].task_id)
    const col = reviewCol(W)
    check(id, s.length === 1 && card && col && card.column_id === col.id && card.title === `${c}: ${require(`${out}/lib/touchpoints/rules.js`).PLAIN[kind]}`
      && col.sort_order === 1 && W.kanban_columns.find((x) => x.title === 'Action Steps').sort_order === 2, { rows: s.length, card: card?.title })
  }

  // ── S_ONCE: a cleared key is never raised again; a second run raises nothing new ──
  {
    const T = world()
    T.hub_touchpoint_situations.push({ id: 'old', org_id: ORG, contact_id: 'cbook', kind: 'booking_link_not_booked', situation_key: 'cbook:booking_link_not_booked:link1',
      waiting_since: ago(72), opened_at: ago(20), cleared_at: ago(10), cleared_reason: 'they booked a call', detail: {}, task_id: null })
    await run.runTouchpoints(deps(T))
    const after1 = T.hub_touchpoint_situations.length
    const r2 = await run.runTouchpoints(deps(T, NOW + 30 * 60_000))
    const keys = T.hub_touchpoint_situations.map((s) => s.situation_key)
    // and the rule itself, on a found situation whose key was raised before (independent of what was detected)
    const rules = require(`${out}/lib/touchpoints/rules.js`)
    const again = rules.toRaise([{ contactId: 'cbook', kind: 'booking_link_not_booked', key: 'cbook:booking_link_not_booked:link1' }], new Set(['cbook:booking_link_not_booked:link1']), new Set())
    check('S_ONCE', again.length === 0 && keys.filter((k) => k === 'cbook:booking_link_not_booked:link1').length === 1 && r2.raised === 0 && T.hub_touchpoint_situations.length === after1
      && new Set(keys).size === keys.length, { keys, raised2: r2.raised })
  }

  // ── S_CLEAR: an open email situation clears when we reply, and its card moves to Done ──
  {
    const T = world()
    T.kanban_tasks.push({ id: 'card-m', org_id: ORG, column_id: 'col-act', title: 'cmail: emailed us, no reply yet', description: 'Emailed one of our mailboxes 2 days ago, no reply' })
    T.hub_touchpoint_situations.push({ id: 'open-m', org_id: ORG, contact_id: 'cmail', kind: 'inbound_no_reply', situation_key: 'cmail:inbound_no_reply:mm1',
      waiting_since: ago(48), opened_at: ago(20), cleared_at: null, cleared_reason: null, severity: 'low', detail: { message_id: 'mm1' }, task_id: 'card-m' })
    T.hub_mail_sent.push({ connection_id: 'box1', to_address: 'cmail@example.com', sent_at: ago(5) })
    await run.runTouchpoints(deps(T))
    const s = T.hub_touchpoint_situations.find((x) => x.id === 'open-m')
    const card = T.kanban_tasks.find((t) => t.id === 'card-m')
    check('S_CLEAR', s.cleared_at && s.cleared_reason === 'we replied' && card.column_id === 'col-done' && /Cleared on its own: we replied\./.test(card.description)
      && situ(T, 'cmail', 'inbound_no_reply').length === 1, { situation: s, card })
  }

  // ── S_EXCLUDE: test and staff contacts are never eligible ──
  {
    const T = world()
    const { contacts } = await run.eligibleContacts(deps(T))
    check('S_EXCLUDE', !contacts.has('ctest') && !contacts.has('cstaff') && contacts.has('cbook'), Array.from(contacts.keys()))
  }

  // ── S_NOCONTENT: the inbound check reads and stores no content ──
  {
    const T = world()
    const d = deps(T)
    await run.runTouchpoints(d)
    const sels = d.db.calls.filter((c) => c.table === 'hub_mail_messages').map((c) => String(c.ops.find((o) => o[0] === 'select')?.[1][0] ?? '*'))
    const stored = JSON.stringify(T.hub_touchpoint_situations.map((s) => s.detail)) + JSON.stringify(T.kanban_tasks)
    check('S_NOCONTENT', sels.length > 0 && sels.every((s) => s !== '*' && !/\b(subject|body|snippet|summary)\b/.test(s)) && !/SECRET/.test(stored), sels)
  }

  // ── S_DIGEST: once a day per recipient, first run after 8 AM ET, never before ──
  {
    const T = world()
    for (let i = 0; i < 3; i++) T.hub_touchpoint_situations.push({ id: `t${i}`, org_id: ORG, contact_id: `x${i}`, kind: 'text_no_reply', situation_key: `x${i}:text_no_reply:m`,
      waiting_since: ago(80), opened_at: ago(40), cleared_at: ago(10), cleared_reason: 'we texted back', detail: {}, task_id: null })
    const sent = []
    const early = world(); early.hub_touchpoint_situations = T.hub_touchpoint_situations.map((s) => ({ ...s }))
    const sentEarly = []
    await run.runTouchpoints(deps(early, Date.parse('2026-11-20T12:30:00Z'), sentEarly)) // 7:30 AM ET
    await run.runTouchpoints(deps(T, NOW, sent))
    await run.runTouchpoints(deps(T, NOW + 30 * 60_000, sent))
    await run.runTouchpoints(deps(T, NOW + 4 * 3_600_000, sent))
    const users = sent.map((s) => s.user).sort()
    check('S_DIGEST', sentEarly.length === 0 && sent.length === 2 && new Set(users).size === 2 && /texted us, no reply yet: [3-9] in the last 7 days/.test(sent[0].text)
      && /Suggested fix:/.test(sent[0].text), { early: sentEarly.length, sent: sent.length })
  }

  // ── staff under any known address, duplicates, and clearing ──
  {
    // staff is decided by eligibility, before any detector runs, so these checks do not depend on what was detected
    const e = await run.eligibleContacts(deps(world()))
    const isStaff = (c) => !e.contacts.has(c) && e.excluded.get(c) === 'staff'
    check('S_STAFF2', isStaff('csecond') && isStaff('cadmin'), { csecond: e.excluded.get('csecond') ?? null, cadmin: e.excluded.get('cadmin') ?? null })
    check('S_MAILBOX', isStaff('cbox'), { cbox: e.excluded.get('cbox') ?? null })
    // the grouping, then the collapse on the found situations of both contacts (independent of which detector ran)
    const f = (c, t) => ({ contactId: c, kind: 'inbound_no_reply', key: `${c}:inbound_no_reply:${t}`, triggerId: t, since: ago(50), detail: { message_id: t } })
    const one = run.collapseDuplicates([f('cdupb', 'm-b'), f('cdupa', 'm-a')], e)
    const moved = run.collapseDuplicates([f('cdupb', 'm-b')], e)
    check('S_DUP', e.primaryOf.get('cdupb') === 'cdupa' && e.excluded.get('cdupb') === 'duplicate' && one.length === 1 && one[0].contactId === 'cdupa' && one[0].triggerId === 'm-a'
      && String(one[0].detail.duplicate_of) === 'cdupb' && moved.length === 1 && moved[0].contactId === 'cdupa' && String(moved[0].detail.duplicate_of) === 'cdupb', { one, moved })
  }
  {
    const T = world()
    T.kanban_tasks.push({ id: 'card-s', org_id: ORG, column_id: 'col-act', title: 'csecond: emailed us', description: 'x' })
    T.hub_touchpoint_situations.push({ id: 'open-s', org_id: ORG, contact_id: 'cstaff', kind: 'text_no_reply', situation_key: 'cstaff:text_no_reply:tx9',
      waiting_since: ago(48), opened_at: ago(20), cleared_at: null, cleared_reason: null, severity: 'low', detail: {}, task_id: 'card-s' })
    await run.runTouchpoints(deps(T))
    const s = T.hub_touchpoint_situations.find((x) => x.id === 'open-s'), c = T.kanban_tasks.find((x) => x.id === 'card-s')
    check('S_CLEARSTAFF', s.cleared_at && s.cleared_reason === 'staff_or_duplicate' && /staff, or a duplicate/.test(c.description), { reason: s.cleared_reason, note: c.description })
  }

  // ── an admin of another org is not staff; a staff_or_duplicate clear reopens ──
  {
    const e = await run.eligibleContacts(deps(world()))
    check('S_OTHERORG', e.contacts.has('cother') && !e.excluded.has('cother'), { cother: e.excluded.get('cother') ?? 'eligible' })
  }
  {
    const T = world()
    T.kanban_tasks.push({ id: 'card-old', org_id: ORG, column_id: 'col-done', title: 'cother: emailed us', description: 'Cleared on its own' })
    T.hub_touchpoint_situations.push({ id: 'was', org_id: ORG, contact_id: 'cother', kind: 'inbound_no_reply', situation_key: 'cother:inbound_no_reply:mo1',
      waiting_since: ago(50), opened_at: ago(20), cleared_at: ago(5), cleared_reason: 'staff_or_duplicate', severity: 'low', detail: {}, task_id: 'card-old' })
    // the raise step itself, on the situation the detector finds for cother (independent of the detectors)
    const f = { contactId: 'cother', kind: 'inbound_no_reply', key: 'cother:inbound_no_reply:mo1', triggerId: 'mo1', since: ago(50), detail: { message_id: 'mo1' } }
    const n = await run.raiseCandidates(deps(T), [f], new Set(), new Map([['cother', 'Other Admin']]))
    const rowsFor = T.hub_touchpoint_situations.filter((x) => x.situation_key === f.key)
    const card = T.kanban_tasks.find((t) => t.id === rowsFor[0]?.task_id)
    check('S_REOPEN', n === 1 && rowsFor.length === 1 && rowsFor[0].id === 'was' && rowsFor[0].cleared_at === null && rowsFor[0].cleared_reason === null
      && card && card.id !== 'card-old' && card.column_id === reviewCol(T)?.id, { n, rows: rowsFor.map((r) => ({ id: r.id, cleared: r.cleared_at, task: r.task_id })) })
  }

  H.report(rows, active, RED_OF)
})().catch((e) => { console.error(e); process.exit(2) })
