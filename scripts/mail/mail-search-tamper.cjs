#!/usr/bin/env node
// scripts/mail/mail-search-tamper.cjs   (Running List q26: POST /api/agent/mail-search)
//
// Drives the real route (src/app/api/agent/mail-search/route.ts), its auth wrapper and src/lib/mail/search.ts end to
// end. The database, the stored sign-ins and Gmail are recording fakes; any real network call fails the run.
// Checks, from intent:
//   S_OWNER    a caller searches only their own private mailboxes and the shared ones of their orgs: another
//              person's private mailbox is never searched, returned or even named (superadmin or not, session or key)
//   S_NOSTORE  nothing from Gmail (subject, sender, snippet, body) is written to the database
//   S_LISTBODY a multi-message search returns no body, only an excerpt of at most 300 characters; a single thread
//              does return the body
//   S_SECRET   the Bearer path accepts only the exact secret, mapped to its one owner; a wrong, missing-prefix, short
//              or unset secret, or a malformed owner id, is refused, and a refused call reads no mailbox
//   S_NOTERMS  the query terms appear in no database write and no log line; the log row carries only their HMAC
//   S_BROKEN   every visible mailbox that is revoked, in error, refuses its sign-in or fails at Gmail is listed in
//              not_searched with a reason; none goes silently missing
//   S_RATE     the per-caller limit holds: once the log shows RATE_MAX searches in the window, the next is refused 429
//              and reads nothing
//
//   otherowner     search reads every connection row, not the visible ones          {S_OWNER}
//   storesbody     the log row also keeps the first result's subject                 {S_NOSTORE}
//   bodyinlist     search results carry a body                                       {S_LISTBODY}
//   nosecretcheck  any well-formed Bearer token is accepted                          {S_SECRET}
//   logsterms      the route's log line prints the query terms                       {S_NOTERMS}
//   hidesbroken    a mailbox whose sign-in is refused is dropped from not_searched   {S_BROKEN}
//   norate         the log count no longer limits                                    {S_RATE}
// TAMPER=1 reddens the sum (7).
const fs = require('fs'), path = require('path')
const H = require('../agent/lib/harness.cjs')

const S = 'lib/mail/search.ts', A = 'lib/mail/search-auth.ts', ROUTE = 'app/api/agent/mail-search/route.ts'
const TAMPERS = {
  otherowner: [[S, "  const rows = await listVisible(caller)\n  if (!rows) return null\n", "  const { data: all } = await caller.db.from('hub_mail_connections').select('*')\n  return all as any\n  const rows = await listVisible(caller)\n  if (!rows) return null\n"]],
  storesbody: [[S, "{ status: 'done', mailbox_ids: r.searched_ids,", "{ status: 'done', first_subject: r.results[0]?.subject ?? null, mailbox_ids: r.searched_ids,"]],
  bodyinlist: [[S, "      for (const m of p.value.metas) if (m.status === 'fulfilled') results.push(hitOf(row, m.value))", "      for (const m of p.value.metas) if (m.status === 'fulfilled') results.push({ ...hitOf(row, m.value), body: m.value.snippet })"]],
  nosecretcheck: [[A, '  return timingSafeEqual(sha(m[1]), sha(secret.trim())) ? ownerId : null', '  return ownerId']],
  logsterms: [[ROUTE, 'messages=${r.results.length}`)', 'messages=${r.results.length} terms=${JSON.stringify(parsed.input)}`)']],
  hidesbroken: [[S, '    } catch {\n      skip(r, REASON.token)\n    }', '    } catch {\n      // dropped\n    }']],
  norate: [[S, "  if ((count ?? 0) >= RATE_MAX) return 'limited'\n", '']],
}
const RED_OF = { otherowner: ['S_OWNER'], storesbody: ['S_NOSTORE'], bodyinlist: ['S_LISTBODY'], nosecretcheck: ['S_SECRET'], logsterms: ['S_NOTERMS'], hidesbroken: ['S_BROKEN'], norate: ['S_RATE'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-mailsearch')

// ── fixtures ────────────────────────────────────────────────────────────────
const NP = '00000000-0000-0000-0000-000000000001', OTHER_ORG = '00000000-0000-0000-0000-0000000000ff'
const SHANE = '00000000-0000-4000-8000-00000000000a', CAM = '00000000-0000-4000-8000-00000000000b', THIRD = '00000000-0000-4000-8000-00000000000c'
const SECRET = 'k'.repeat(48), LOG_KEY = 'h'.repeat(48)
const conn = (id, owner, visibility, status, org = NP) => ({ id, org_id: org, owner_user_id: owner, email_address: `${id}@example.com`, visibility, status, scopes: [], connected_at: '2026-11-01T00:00:00Z', last_checked_at: null, last_error: null })
const CONNS = [
  conn('c-own', SHANE, 'private', 'active'), conn('c-cam', CAM, 'private', 'active'), conn('c-ops', CAM, 'shared', 'active'),
  conn('c-rev', SHANE, 'private', 'revoked'), conn('c-err', SHANE, 'private', 'error'), conn('c-bad', SHANE, 'private', 'active'),
  conn('c-gf', SHANE, 'shared', 'active'), conn('c-far', THIRD, 'shared', 'active', OTHER_ORG),
]
const SENT = { subject: 'SECRET-SUBJECT', from: 'Sender <secret.sender@example.net>', snippet: 'SECRET-SNIPPET ' + 'x'.repeat(600), body: 'SECRET-BODY full text' }
const TERMS = { emails: ['david.term@example.org'], names: ['Termy Person'], phones: ['8285550199'] }
const GMAIL_CONTENT = /SECRET-SUBJECT|secret\.sender|SECRET-SNIPPET|SECRET-BODY/
const TERM_TEXT = /david\.term@example\.org|Termy Person|8285550199|555-0199/

function memDb(logRows = []) {
  const writes = [], reads = []
  const T = {
    team_profiles: [{ user_id: SHANE, org_id: NP, role: 'super_admin', status: 'active' }, { user_id: CAM, org_id: NP, role: 'super_admin', status: 'active' }],
    profiles: [{ id: SHANE, role: 'superadmin' }, { id: CAM, role: 'superadmin' }],
    hub_mail_connections: CONNS, hub_mail_search_log: logRows,
  }
  const db = H.stubDb({}, {
    rpc: () => { throw new Error('rpc must not be reached') },
    table: (table, ops, mode) => {
      const w = ops.find((o) => ['insert', 'update', 'upsert', 'delete'].includes(o[0]))
      if (w) {
        writes.push({ table, op: w[0], payload: w[1][0] })
        if (w[0] === 'insert') { const row = { id: `log-${T[table].length + 1}`, ...w[1][0] }; T[table].push(row); return { data: row, error: null } }
        return { data: null, error: null }
      }
      reads.push(table)
      let rows = (T[table] || []).slice()
      for (const [m, a] of ops) {
        if (m === 'eq') rows = rows.filter((r) => r[a[0]] === a[1])
        if (m === 'gte') rows = rows.filter((r) => String(r[a[0]]) >= String(a[1]))
      }
      const sel = ops.find((o) => o[0] === 'select')
      if (sel && sel[1][1] && sel[1][1].head) return { data: null, count: rows.length, error: null }
      return mode === 'maybeSingle' || mode === 'single' ? { data: rows[0] || null, error: null } : { data: rows, error: null }
    },
  })
  return { db, T, writes, reads }
}

// ── stubs: the real google.ts rules, fake sign-ins; fake Gmail; the stub db; a session user ───────────────────
global.fetch = async () => { throw new Error('network must not be reached') }
const realGoogle = require(path.join(out, 'lib/mail/google.js'))
const gmailCalls = []
let current = memDb()
const realGuard = { STAFF_TEAM_ROLES: ['super_admin', 'admin', 'team_member'] }
const load = H.install(out, {
  'next/server': { NextResponse: { json: (body, init) => ({ status: (init && init.status) || 200, body }) } },
  '@/lib/api-guard': realGuard,
  '@/lib/supabase': {
    createAdminSupabase: () => current.db,
    createServerSupabase: () => ({ auth: { getUser: async () => ({ data: { user: global.__user ?? null } }) } }),
  },
  '@/lib/mail/google': {
    ...realGoogle,
    refreshTokenFor: async (_db, id) => { if (id === 'c-bad') throw new realGoogle.MailError('refused', 'token_error'); return `rt-${id}` },
    accessTokenFor: async (rt) => `at-${rt.slice(3)}`,
  },
  '@/lib/mail/gmail': {
    searchMessageIds: async (token, q) => { gmailCalls.push({ token, q }); if (token === 'at-c-gf') throw new Error('gmail down'); return [{ id: 'a1', threadId: 'abc123' }, { id: 'a2', threadId: 'abc123' }] },
    getMessageMeta: async (token, id) => ({ id, threadId: 'abc123', date: '2026-11-16T12:00:00.000Z', from: SENT.from, to: 'me@example.com', subject: SENT.subject, labels: ['INBOX'], snippet: SENT.snippet }),
    getThreadFull: async (token, threadId) => [{ id: 'a1', threadId, date: '2026-11-16T12:00:00.000Z', from: SENT.from, to: 'me@example.com', subject: SENT.subject, labels: ['INBOX'], snippet: SENT.snippet, body: SENT.body }],
  },
})
process.env.MAIL_SEARCH_AGENT_SECRET = SECRET
process.env.MAIL_SEARCH_AGENT_USER_ID = CAM
process.env.MAIL_SEARCH_LOG_KEY = LOG_KEY
const route = load(ROUTE), auth = load(A)

const req = (body, authz) => ({ headers: { get: (n) => (n.toLowerCase() === 'authorization' ? authz ?? null : null) }, json: async () => body })
const logs = []
const origLog = console.log, origErr = console.error
console.log = (...a) => logs.push(a.join(' ')); console.error = (...a) => logs.push(a.join(' '))
async function call(body, { user = null, authz, logRows } = {}) {
  current = memDb(logRows)
  global.__user = user ? { id: user } : null
  gmailCalls.length = 0
  const res = await route.POST(req(body, authz))
  return { res, ...current, gmail: gmailCalls.slice() }
}

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

;(async () => {
  const shane = await call(TERMS, { user: SHANE })
  const cam = await call(TERMS, { authz: `Bearer ${SECRET}` })
  const thread = await call({ thread_id: 'abc123', mailbox: 'c-own@example.com' }, { user: SHANE })

  // S_OWNER
  {
    const named = (r) => JSON.stringify(r.res.body)
    const shaneOk = shane.res.status === 200 && !/c-cam|c-far/.test(named(shane)) && shane.res.body.mailboxes_searched.includes('c-own@example.com') && shane.res.body.mailboxes_searched.includes('c-ops@example.com')
    const camOk = cam.res.status === 200 && !/c-own|c-rev|c-err|c-bad|c-far/.test(named(cam)) && cam.res.body.mailboxes_searched.includes('c-cam@example.com')
    const tokens = [...shane.gmail, ...cam.gmail].map((g) => g.token)
    const otherThread = await call({ thread_id: 'abc123', mailbox: 'c-cam@example.com' }, { user: SHANE })
    check('S_OWNER', shaneOk && camOk && !shane.gmail.some((g) => g.token === 'at-c-cam') && !cam.gmail.some((g) => g.token === 'at-c-own') && otherThread.res.status === 404,
      { shane: shane.res.body.mailboxes_searched, cam: cam.res.body.mailboxes_searched, tokens, otherThread: otherThread.res.status })
  }

  // S_NOSTORE
  {
    const all = [...shane.writes, ...cam.writes, ...thread.writes]
    const leaked = all.filter((w) => GMAIL_CONTENT.test(JSON.stringify(w.payload)))
    const tables = Array.from(new Set(all.map((w) => w.table)))
    check('S_NOSTORE', all.length > 0 && leaked.length === 0 && tables.length === 1 && tables[0] === 'hub_mail_search_log', { tables, leaked: leaked.length })
  }

  // S_LISTBODY
  {
    const list = shane.res.body.results
    const listOk = list.length > 0 && list.every((h) => !('body' in h) && typeof h.excerpt === 'string' && h.excerpt.length <= 300 && h.excerpt.startsWith('SECRET-SNIPPET'))
    const t = thread.res.body
    check('S_LISTBODY', listOk && t.mode === 'thread' && t.results.length === 1 && t.results[0].body === SENT.body, { listBodies: list.filter((h) => 'body' in h).length, threadBody: !!t.results[0]?.body })
  }

  // S_SECRET
  {
    const ac = auth.agentCaller
    const pure = [
      ac(`Bearer ${SECRET}`, SECRET, CAM) === CAM,
      ac('Bearer wrong-token-of-some-length-000000000000', SECRET, CAM) === null,
      ac(SECRET, SECRET, CAM) === null,
      ac(`Basic ${SECRET}`, SECRET, CAM) === null,
      ac(`Bearer ${SECRET}`, undefined, CAM) === null,
      ac('Bearer short', 'short', CAM) === null,
      ac(`Bearer ${SECRET}`, SECRET, 'not-a-uuid') === null,
    ]
    const bad = await call(TERMS, { authz: 'Bearer wrong-token-of-some-length-000000000000', user: SHANE })
    const none = await call(TERMS, {})
    check('S_SECRET', pure.every(Boolean) && bad.res.status === 401 && none.res.status === 401 && bad.gmail.length === 0 && !bad.reads.includes('hub_mail_connections'),
      { pure, bad: bad.res.status, none: none.res.status, badReads: bad.reads })
  }

  // S_NOTERMS
  {
    const all = [...shane.writes, ...cam.writes]
    const inDb = all.filter((w) => TERM_TEXT.test(JSON.stringify(w.payload)))
    const inLogs = logs.filter((l) => TERM_TEXT.test(l))
    const ins = shane.writes.find((w) => w.op === 'insert')
    check('S_NOTERMS', inDb.length === 0 && inLogs.length === 0 && /^[0-9a-f]{64}$/.test(ins?.payload?.terms_hash ?? '') && ins.payload.term_count === 3,
      { inDb: inDb.length, inLogs: inLogs.length, hash: ins?.payload?.terms_hash?.length })
  }

  // S_BROKEN
  {
    const ns = shane.res.body.not_searched
    const ids = ns.map((n) => n.connection_id).sort()
    const covered = new Set([...shane.res.body.mailboxes_searched.map((m) => m.replace('@example.com', '')), ...ids])
    check('S_BROKEN', JSON.stringify(ids) === JSON.stringify(['c-bad', 'c-err', 'c-gf', 'c-rev']) && ns.every((n) => n.reason && n.reason.length > 10)
      && ['c-own', 'c-ops', 'c-rev', 'c-err', 'c-bad', 'c-gf'].every((c) => covered.has(c)), { not_searched: ids })
  }

  // S_RATE
  {
    const now = new Date().toISOString()
    const full = Array.from({ length: 10 }, (_, k) => ({ id: `old-${k}`, caller_user_id: SHANE, searched_at: now }))
    const r = await call(TERMS, { user: SHANE, logRows: full })
    const other = await call(TERMS, { authz: `Bearer ${SECRET}`, logRows: full.map((x) => ({ ...x })) })
    check('S_RATE', r.res.status === 429 && r.gmail.length === 0 && !r.writes.length && other.res.status === 200, { status: r.res.status, gmail: r.gmail.length, otherCaller: other.res.status })
  }

  console.log = origLog; console.error = origErr
  delete global.__user
  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})()
