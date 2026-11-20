#!/usr/bin/env node
// scripts/drafts/drafts-tamper.cjs   (Running List q10 support drafts, PR 1 of "drafts and review")
//
// Runs the REAL drafting core, support drafter, learning loop and review actions (src/lib/drafts) against an
// in-memory database (filters, and the one-row-per-message unique key), a recording fake Gmail per mailbox, and a
// recording fake model. Sentinels: SECRETBODY and SECRETSUBJECT (the participant's email), DRAFTTEXT (the drafted
// reply), SENTTEXT (the sent copy). Checks, from intent:
//   D_THREAD   the reply is a draft in the message's OWN mailbox and thread, with In-Reply-To and References set to the
//              original Message-ID and a "Re:" subject
//   D_NOSEND   across drafting, learning and rejecting, Gmail is only ever asked POST /drafts, GET /drafts/{id} and
//              DELETE /drafts/{id}: never messages.send or drafts.send
//   D_NOTEXT   no row the Hub writes holds a subject, a body or draft text, and the mail table is read without them
//   D_SKIP     a thank-you, our own reply and an automated notice get no draft
//   D_STOP     clinical, legal and financial questions become needs_person with their class: no draft, no model call
//   D_LESSON   a lesson is one sentence of at most 200 characters; one that quotes the sent email is not kept
//   D_PRIVATE  a private mailbox's drafts are hidden from a superadmin who does not own it, and refused to act on
//   D_OFF      with hub_drafts_mode missing or anything but 'on', nothing is read, drafted or stored
//
//   wrongthread  the draft is made without the thread id            {D_THREAD}
//   sends        the draft is sent instead of saved                  {D_NOSEND}
//   storetext    a preview of the draft is kept on the row           {D_NOTEXT}
//   nothanks     thank-you notes are drafted                         {D_SKIP}
//   noscreen     the deterministic hard stop is skipped              {D_STOP}
//   keepquote    a lesson quoting the email is kept                  {D_LESSON}
//   showprivate  every mailbox counts as visible                     {D_PRIVATE}
//   ignoremode   drafting ignores the mode                           {D_OFF}
// TAMPER=1 reddens the sum (8).
const H = require('../agent/lib/harness.cjs')

const S = 'lib/drafts/support.ts', C = 'lib/drafts/compose.ts', G = 'lib/drafts/gmail-drafts.ts', R = 'lib/drafts/rules.ts', V = 'lib/drafts/review.ts'
const TAMPERS = {
  wrongthread: [[S, 'const made = await createDraft(box.gmail, raw, m.gmail_thread_id)', "const made = await createDraft(box.gmail, raw, '')"]],
  sends: [[G, "const { status, data } = await gmail('POST', '/drafts', { message: { raw, threadId } })", "const { status, data } = await gmail('POST', '/drafts/send', { message: { raw, threadId } })"]],
  storetext: [[S, 'draft_shape: shapeOf(r.draft.body, contact?.first_name ?? null) })', 'draft_shape: { ...shapeOf(r.draft.body, contact?.first_name ?? null), preview: r.draft.body.slice(0, 80) } })']],
  nothanks: [[C, "if (kind === 'support' && thanksOnly(ctx.body)) return { ok: false, skip: 'thanks_only' }", "if (false as boolean) return { ok: false, skip: 'thanks_only' }"]],
  noscreen: [[C, 'const stop = hardStop(ctx.subject, ctx.body)', 'const stop = null as ReturnType<typeof hardStop>']],
  keepquote: [[R, '  if (sources.some((src) => quotes(s, src))) return null\n', '']],
  showprivate: [[V, ".filter((b) => mailView(viewer, b, null) === 'full')", '.filter(() => true)']],
  ignoremode: [[S, "  if (out.mode !== 'on') return out\n", '']],
}
const RED_OF = { wrongthread: ['D_THREAD'], sends: ['D_NOSEND'], storetext: ['D_NOTEXT'], nothanks: ['D_SKIP'], noscreen: ['D_STOP'], keepquote: ['D_LESSON'],
  showprivate: ['D_PRIVATE'], ignoremode: ['D_OFF'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-drafts')
const load = H.install(out)
const support = load(S), learn = load('lib/drafts/learn.ts'), review = load(V)

const ORG = '00000000-0000-0000-0000-0000000000a1'
const OWNER = '00000000-0000-4000-8000-0000000000a1', OTHER = '00000000-0000-4000-8000-0000000000b2'
const PRIV = 'box-private', SHARED = 'box-shared'
const NOW = Date.parse('2026-11-20T15:00:00Z')
const ago = (h) => new Date(NOW - h * 3_600_000).toISOString()

// the participant emails: id -> what Gmail returns for it (in memory only)
const MAIL = {
  g1: { from: 'jo@example.com', name: 'Jo Doe', subject: 'Tuesday call SECRETSUBJECT', body: 'Hi Cameron, which Zoom link do I use for the Tuesday call? SECRETBODY', rfc: '<orig-1@mail.example>', refs: '<orig-0@mail.example>' },
  g2: { from: 'jo@example.com', name: 'Jo Doe', subject: 'Re: call', body: 'Thank you so much, see you then! SECRETBODY' },
  g3: { from: 'cameron@neuroprogeny.com', name: 'Cameron', subject: 'Re: call', body: 'Here is the link. SECRETBODY' },
  g4: { from: 'no-reply@zoom.us', name: 'Zoom', subject: 'Waiting for host', body: 'Your participant is waiting. SECRETBODY' },
  g5: { from: 'sam@example.com', name: 'Sam', subject: 'Phase 2', body: 'Can I get a refund for phase 2? SECRETBODY' },
  g6: { from: 'kim@example.com', name: 'Kim', subject: 'Question', body: 'Should I keep taking my medication during the program? SECRETBODY' },
  g7: { from: 'lee@example.com', name: 'Lee', subject: 'Question', body: 'My lawyer asked about the agreement, can you send it? SECRETBODY' },
  g8: { from: 'pat@example.com', name: 'Pat', subject: 'Login SECRETSUBJECT', body: 'How do I log in to the new University site? SECRETBODY', rfc: '<orig-8@mail.example>' },
  sA: { from: 'admin@neuroprogeny.com', name: 'Cameron', subject: 'Re: x', body: 'ALPHA Hi Jo, the Tuesday call link is in your welcome email and starts at noon eastern time. Warmly, Cameron SENTTEXT' },
  sB: { from: 'admin@neuroprogeny.com', name: 'Cameron', subject: 'Re: y', body: 'BRAVO Hi Pat, you can sign in with the same email you used before and your progress carries over. SENTTEXT' },
}
const msgRow = (id, box, thread, gid, h) => ({ id, connection_id: box, gmail_message_id: gid, gmail_thread_id: thread, from_address: MAIL[gid].from, received_at: ago(h),
  category: 'participant_support', subject: MAIL[gid].subject, summary: 'SECRETBODY summary' })

function world(mode = 'on') {
  return {
    org_settings: mode === null ? [] : [{ org_id: ORG, setting_key: 'hub_drafts_mode', setting_value: mode }],
    hub_mail_connections: [
      { id: PRIV, org_id: ORG, owner_user_id: OWNER, email_address: 'cameron@neuroprogeny.com', visibility: 'private', status: 'active' },
      { id: SHARED, org_id: ORG, owner_user_id: OWNER, email_address: 'admin@neuroprogeny.com', visibility: 'shared', status: 'active' },
    ],
    hub_mail_messages: [
      msgRow('m1', SHARED, 'aa01', 'g1', 5), msgRow('m2', PRIV, 'aa02', 'g2', 5), msgRow('m3', PRIV, 'aa03', 'g3', 5), msgRow('m4', PRIV, 'aa04', 'g4', 5),
      msgRow('m5', PRIV, 'aa05', 'g5', 5), msgRow('m6', PRIV, 'aa06', 'g6', 5), msgRow('m7', PRIV, 'aa07', 'g7', 5), msgRow('m8', PRIV, 'aa08', 'g8', 5),
    ],
    hub_mail_sent: [], hub_drafts: [], sequences: [], sequence_steps: [],
    contacts: [{ id: 'c-jo', org_id: ORG, email: 'jo@example.com', first_name: 'Jo', last_name: 'Doe', merged_into_id: null }],
  }
}

function memDb(T, writes) {
  const cmp = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return Number.isNaN(x) || Number.isNaN(y) ? String(a).localeCompare(String(b)) : x - y }
  let seq = 0
  const calls = []
  return {
    calls,
    rpc: async () => ({ data: null, error: null }),
    from(table) {
      const ops = []
      const b = {}
      for (const m of ['select', 'eq', 'neq', 'is', 'not', 'in', 'gt', 'gte', 'ilike', 'order', 'limit', 'insert', 'update']) b[m] = (...a) => { ops.push([m, a]); return b }
      const filt = (rows) => {
        for (const [m, a] of ops) {
          if (m === 'eq') rows = rows.filter((r) => r[a[0]] === a[1])
          if (m === 'neq') rows = rows.filter((r) => r[a[0]] !== a[1])
          if (m === 'is') rows = rows.filter((r) => (r[a[0]] ?? null) === a[1])
          if (m === 'not' && a[1] === 'is') rows = rows.filter((r) => (r[a[0]] ?? null) !== a[2])
          if (m === 'in') rows = rows.filter((r) => a[1].includes(r[a[0]]))
          if (m === 'gt') rows = rows.filter((r) => r[a[0]] != null && cmp(r[a[0]], a[1]) > 0)
          if (m === 'gte') rows = rows.filter((r) => r[a[0]] != null && cmp(r[a[0]], a[1]) >= 0)
          if (m === 'ilike') rows = rows.filter((r) => String(r[a[0]] ?? '').toLowerCase() === String(a[1]).replace(/\\(.)/g, '$1').toLowerCase())
        }
        return rows
      }
      const exec = (mode) => {
        calls.push({ table, ops })
        T[table] = T[table] || []
        const ins = ops.find((o) => o[0] === 'insert'), upd = ops.find((o) => o[0] === 'update')
        if (ins) {
          const list = (Array.isArray(ins[1][0]) ? ins[1][0] : [ins[1][0]]).map((r) => ({ id: `${table}-${++seq}`, ...r }))
          if (table === 'hub_drafts' && list.some((r) => T.hub_drafts.some((x) => x.source_table === r.source_table && x.source_id === r.source_id && x.kind === r.kind))) return { data: null, error: { code: '23505' } }
          writes.push({ table, row: JSON.stringify(list) })
          T[table].push(...list)
          return { data: mode === 'one' ? list[0] : list, error: null }
        }
        if (upd) { const rows = filt(T[table]); writes.push({ table, row: JSON.stringify(upd[1][0]) }); for (const r of rows) Object.assign(r, upd[1][0]); return { data: rows, error: null } }
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

// a fake Gmail per mailbox, recording every call; drafts it holds, by id
function fakeGmail(log, drafts) {
  let n = 0
  return (connectionId) => Promise.resolve({
    gmail: async (method, path, body) => {
      log.push({ connectionId, method, path, body })
      if (method === 'POST' && path.startsWith('/drafts')) { const id = `r${++n}${connectionId.slice(4, 8)}`; drafts.set(id, body); return { status: 200, data: { id, message: { id: `d${n}`, threadId: body?.message?.threadId } } } }
      if (method === 'GET' && path.startsWith('/drafts/')) { const id = decodeURIComponent(path.split('/')[2].split('?')[0]); return drafts.has(id) ? { status: 200, data: { message: { payload: { mimeType: 'text/plain', body: { data: Buffer.from('DRAFTTEXT kept draft').toString('base64url') } } } } } : { status: 404, data: {} } }
      if (method === 'DELETE' && path.startsWith('/drafts/')) { drafts.delete(path.split('/')[2]); return { status: 204, data: {} } }
      return { status: 404, data: {} }
    },
    read: async (gid) => { const m = MAIL[gid]; return { threadId: 't', fromName: m.name, fromAddress: m.from, subject: m.subject, receivedAt: ago(5), body: m.body, rfcMessageId: m.rfc ?? null, references: m.refs ?? null } },
  })
}

function fakeModel(log, lessonFor = () => 'Cameron keeps replies short.') {
  return {
    async create(req) {
      const sys = req.system.map((s) => s.text).join('\n')
      const user = String(req.messages[0].content)
      log.push({ kind: /compare a reply draft/.test(sys) ? 'lesson' : 'compose', user })
      if (/compare a reply draft/.test(sys)) return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ lesson: lessonFor(user) }) }] }
      const name = (user.match(/First name to greet: (\w+)/) ?? [])[1]
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ hard_stop: 'none', is_question: true, subject: 'Re: your question',
        body: `Hi ${name ?? 'there'},\n\nDRAFTTEXT Thanks for asking. The details are on the way.\n\nWarmly,\nCameron` }) }] }
    },
  }
}

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
const raw = (b) => Buffer.from(String(b?.message?.raw ?? ''), 'base64url').toString('utf8')

;(async () => {
  // ── one drafting run over the eight emails ──
  const T = world('on'), writes = [], gmailLog = [], modelLog = [], drafts = new Map()
  const db = memDb(T, writes)
  const mailbox = fakeGmail(gmailLog, drafts)
  const r1 = await support.runSupportDrafts({ db, orgId: ORG, now: NOW, model: fakeModel(modelLog), mailbox })
  const byMsg = (id) => T.hub_drafts.filter((d) => d.source_id === id)

  // D_THREAD
  {
    const post = gmailLog.find((c) => c.method === 'POST' && c.connectionId === SHARED)
    const mime = raw(post?.body)
    const row = byMsg('m1')[0]
    check('D_THREAD', post && post.body.message.threadId === 'aa01' && /^In-Reply-To: <orig-1@mail\.example>$/m.test(mime)
      && /^References: <orig-0@mail\.example> <orig-1@mail\.example>$/m.test(mime) && /^Subject: Re: Tuesday call/m.test(mime) && /^To: jo@example\.com$/m.test(mime)
      && row?.status === 'drafted' && row.connection_id === SHARED && row.gmail_thread_id === 'aa01', { threadId: post?.body?.message?.threadId, mime: mime.split('\r\n').slice(0, 6) })
  }

  // ── learning and a rejection, on rows like the ones above ──
  const L = world('on')
  L.hub_drafts.push(
    { id: 'dA', org_id: ORG, connection_id: SHARED, gmail_thread_id: 'bb0a', gmail_draft_id: 'rA', status: 'approved', reviewed_at: ago(2), draft_shape: { words: 20 }, kind: 'support', source_table: 'hub_mail_messages', source_id: 'x1' },
    { id: 'dB', org_id: ORG, connection_id: SHARED, gmail_thread_id: 'bb0b', gmail_draft_id: 'rB', status: 'edited', reviewed_at: ago(2), draft_shape: { words: 30 }, kind: 'support', source_table: 'hub_mail_messages', source_id: 'x2' })
  L.hub_mail_sent.push({ connection_id: SHARED, gmail_thread_id: 'bb0a', gmail_message_id: 'sA', sent_at: ago(1) }, { connection_id: SHARED, gmail_thread_id: 'bb0b', gmail_message_id: 'sB', sent_at: ago(1) })
  const lWrites = [], lGmail = [], lModel = []
  const long = 'Cameron points the participant to the welcome email for links, names the start time in their own time zone, and closes warmly with a short invitation to reply if anything is unclear before the call next week, every time he answers a scheduling question like this one.'
  await learn.runLearn({ db: memDb(L, lWrites), now: NOW, model: fakeModel(lModel, (u) => (/ALPHA/.test(u) ? long : 'Cameron says you can sign in with the same email you used before.')), mailbox: fakeGmail(lGmail, new Map()) })
  const A = L.hub_drafts.find((d) => d.id === 'dA'), B = L.hub_drafts.find((d) => d.id === 'dB')

  const rejectLog = []
  const rd = T.hub_drafts.find((d) => d.source_id === 'm1')
  const rj = await review.act(memDb(T, writes), { userId: OWNER, isSuperadmin: true }, [ORG], rd.id, 'reject', fakeGmail(rejectLog, drafts), new Date(NOW))

  // D_NOSEND
  {
    const all = [...gmailLog, ...lGmail, ...rejectLog]
    const bad = all.filter((c) => /send/i.test(c.path) || !((c.method === 'POST' && c.path === '/drafts') || (c.method === 'GET' && /^\/drafts\/[^/]+(\?|$)/.test(c.path)) || (c.method === 'DELETE' && /^\/drafts\/[^/?]+$/.test(c.path))))
    check('D_NOSEND', all.length > 0 && bad.length === 0 && rj.status === 200 && rejectLog.some((c) => c.method === 'DELETE'), bad.map((c) => `${c.method} ${c.path}`))
  }

  // D_NOTEXT
  {
    const stored = [...writes, ...lWrites].map((w) => w.row).join('\n')
    const sels = db.calls.filter((c) => c.table === 'hub_mail_messages').map((c) => String(c.ops.find((o) => o[0] === 'select')?.[1][0] ?? '*'))
    check('D_NOTEXT', !/SECRETBODY|SECRETSUBJECT|DRAFTTEXT|SENTTEXT|Tuesday call|Zoom link/.test(stored) && sels.length > 0 && sels.every((s) => s !== '*' && !/\b(subject|body|summary|snippet)\b/.test(s)),
      { leaked: (stored.match(/SECRETBODY|SECRETSUBJECT|DRAFTTEXT|SENTTEXT/g) ?? []).slice(0, 3), sels })
  }

  // D_SKIP
  {
    const draftedFor = (id) => byMsg(id).some((d) => d.status === 'drafted')
    check('D_SKIP', !draftedFor('m2') && !draftedFor('m3') && !draftedFor('m4') && byMsg('m2')[0]?.status === 'skipped' && byMsg('m3').length === 0 && byMsg('m4').length === 0
      && !gmailLog.some((c) => c.method === 'POST' && raw(c.body).includes('To: no-reply@zoom.us')), { m2: byMsg('m2')[0]?.status, m3: byMsg('m3').length, m4: byMsg('m4').length })
  }

  // D_STOP
  {
    const want = { m5: 'financial', m6: 'clinical', m7: 'legal' }
    const ok = Object.entries(want).every(([m, cls]) => byMsg(m).length === 1 && byMsg(m)[0].status === 'needs_person' && byMsg(m)[0].reason === cls && !byMsg(m)[0].gmail_draft_id)
    const modelSaw = modelLog.filter((l) => /refund|medication|lawyer/.test(l.user)).length
    check('D_STOP', ok && modelSaw === 0 && r1.needs_person === 3, { rows: Object.keys(want).map((m) => byMsg(m)[0]?.status), modelSaw })
  }

  // D_LESSON
  {
    check('D_LESSON', A.status === 'sent' && typeof A.lesson === 'string' && A.lesson.length > 0 && A.lesson.length <= 200 && !/SENTTEXT|ALPHA/.test(A.lesson)
      && B.status === 'sent' && B.lesson === null && lModel.length === 2, { A: A.lesson, B: B.lesson })
  }

  // D_PRIVATE
  {
    const viewOwner = await review.listDrafts(memDb(T, []), { userId: OWNER, isSuperadmin: true }, [ORG])
    const viewOther = await review.listDrafts(memDb(T, []), { userId: OTHER, isSuperadmin: true }, [ORG])
    const privDraft = T.hub_drafts.find((d) => d.connection_id === PRIV && d.status === 'drafted')
    const tryAct = await review.act(memDb(T, []), { userId: OTHER, isSuperadmin: true }, [ORG], privDraft.id, 'approve', fakeGmail([], new Map()), new Date(NOW))
    check('D_PRIVATE', viewOwner.drafts.some((d) => d.mailbox === 'cameron@neuroprogeny.com') && !viewOther.drafts.some((d) => d.mailbox === 'cameron@neuroprogeny.com')
      && viewOther.drafts.some((d) => d.mailbox === 'admin@neuroprogeny.com') && tryAct.status === 404, { other: viewOther.drafts.map((d) => d.mailbox), act: tryAct.status })
  }

  // D_OFF
  {
    const results = []
    for (const mode of [null, 'off', 'ON', { mode: 'yes' }]) {
      const W = world(mode), g = [], m = []
      const o = await support.runSupportDrafts({ db: memDb(W, []), orgId: ORG, now: NOW, model: fakeModel(m), mailbox: fakeGmail(g, new Map()) })
      results.push({ mode: o.mode, gmail: g.length, model: m.length, rows: W.hub_drafts.length })
    }
    check('D_OFF', results.every((x) => x.mode === 'off' && x.gmail === 0 && x.model === 0 && x.rows === 0), results)
  }

  H.report(rows, active, RED_OF)
})().catch((e) => { console.error(e); process.exit(2) })
