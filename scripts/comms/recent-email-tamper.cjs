#!/usr/bin/env node
// scripts/comms/recent-email-tamper.cjs   (Running List q31: the contact card's last 7 email conversations)
//
// Runs the real route (GET /api/crm/contacts/[id]/recent-email) against an in-memory database that applies the
// filters and keeps only the selected columns. Two contacts: BIG has 9 one-message threads (for the count and the
// order); SMALL has 4 threads (a private one, a three-message one, one from a merge's alternate address, a shared one),
// so no check on SMALL depends on which 7 of BIG's threads are kept. Checks, from intent:
//   R_SEVEN    exactly 7 lines for a contact with 9 conversations
//   R_ORDER    the lines are newest first (BIG's 7 newest, in order)
//   R_THREAD   one line per thread, not per message: SMALL's 3-message thread is one line, and its last reply is the
//              mailbox owner's name (the latest message was sent)
//   R_PRIVATE  a private mailbox's thread is "1 private conversation" with the date only for another staff member
//              (no subject, no mailbox, no last reply anywhere in the response) and is shown in full to its owner
//   R_NOBODY   no query on a mail table selects a body, snippet or summary, and every line has exactly the line fields
//   R_ALT      a second email on the card (custom_fields.alt_emails) is matched: its thread is listed
//
//   eight        the limit is 8                                   {R_SEVEN}
//   oldest       oldest first                                     {R_ORDER}
//   permessage   one line per message                             {R_THREAD}
//   showall      a thread the viewer may not read is shown        {R_PRIVATE}
//   summary      the received query also selects the AI summary   {R_NOBODY}
//   noalt        only the card's main email is matched            {R_ALT}
// TAMPER=1 reddens the sum (6).
const H = require('../agent/lib/harness.cjs')

const RE = 'lib/comms/recent-email.ts', ROUTE = 'app/api/crm/contacts/[id]/recent-email/route.ts'
const TAMPERS = {
  eight: [[RE, 'export const RECENT_EMAIL_LIMIT = 7', 'export const RECENT_EMAIL_LIMIT = 8']],
  oldest: [[RE, '.sort((a, b) => ms(b.line.at) - ms(a.line.at) || a.k.localeCompare(b.k))', '.sort((a, b) => ms(a.line.at) - ms(b.line.at) || a.k.localeCompare(b.k))']],
  permessage: [[RE, 'const k = `${connectionId}:${threadId}`', 'const k = `${connectionId}:${threadId}:${m.at}`']],
  showall: [[RE, "if (view !== 'full') return", "if (false as boolean) return"]],
  summary: [[RE, "export const RECEIVED_COLUMNS = 'id, connection_id, gmail_thread_id, subject, category, received_at'", "export const RECEIVED_COLUMNS = 'id, connection_id, gmail_thread_id, subject, category, received_at, summary'"]],
  noalt: [[RE, '  for (const e of s.emails) {', '  for (const e of s.emails.slice(0, 1)) {'], [RE, ".in('to_address', s.emails)", ".in('to_address', s.emails.slice(0, 1))"]],
}
const RED_OF = { eight: ['R_SEVEN'], oldest: ['R_ORDER'], permessage: ['R_THREAD'], showall: ['R_PRIVATE'], summary: ['R_NOBODY'], noalt: ['R_ALT'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-recent-email')
const load = H.install(out)
const { LINE_KEYS } = load(RE)
const { GET } = load(ROUTE)

const ORG = '00000000-0000-0000-0000-0000000000a1'
const BIG = '00000000-0000-4000-8000-000000000001', SMALL = '00000000-0000-4000-8000-000000000002'
const OWNER = '00000000-0000-4000-8000-0000000000a1', STAFF = '00000000-0000-4000-8000-0000000000b2'
const PRIV = 'box-private', SHARED = 'box-shared'
const T = (h) => new Date(Date.UTC(2026, 10, 10, h)).toISOString()
const DATA = {
  contacts: [
    { id: BIG, org_id: ORG, email: 'big@example.com', phone: null, merged_into_id: null, custom_fields: {} },
    { id: SMALL, org_id: ORG, email: 'Small@Example.com', phone: null, merged_into_id: null, custom_fields: { alt_emails: ['Second.Address@Example.com'] } },
  ],
  hub_mail_connections: [
    { id: PRIV, org_id: ORG, owner_user_id: OWNER, email_address: 'owner-mailbox@neuroprogeny.com', visibility: 'private' },
    { id: SHARED, org_id: ORG, owner_user_id: OWNER, email_address: 'shared-mailbox@neuroprogeny.com', visibility: 'shared' },
  ],
  team_profiles: [{ user_id: OWNER, display_name: 'Mailbox Owner' }],
  hub_mail_messages: [
    // BIG: nine one-message threads in the shared mailbox, hours 1..9, listed out of order
    ...[5, 1, 9, 3, 7, 2, 8, 4, 6].map((h) => ({ connection_id: SHARED, gmail_thread_id: `big${h}`, from_address: 'big@example.com', subject: `Big ${h}`, summary: 'SECRETSUMMARY', body: 'SECRETBODY', category: 'lead', received_at: T(h) })),
    // SMALL
    { connection_id: PRIV, gmail_thread_id: 'priv1', from_address: 'small@example.com', subject: 'PRIVATESUBJECT', summary: 'SECRETSUMMARY', category: 'lead', received_at: T(20) },
    { connection_id: SHARED, gmail_thread_id: 'multi', from_address: 'small@example.com', subject: 'Three messages', summary: 'SECRETSUMMARY', category: 'lead', received_at: T(10) },
    { connection_id: SHARED, gmail_thread_id: 'multi', from_address: 'small@example.com', subject: 'Re: Three messages', summary: 'SECRETSUMMARY', category: 'lead', received_at: T(12) },
    { connection_id: SHARED, gmail_thread_id: 'alt1', from_address: 'second.address@example.com', subject: 'From my second address', summary: 'SECRETSUMMARY', category: 'lead', received_at: T(11) },
    { connection_id: SHARED, gmail_thread_id: 'solo', from_address: 'small@example.com', subject: 'Nobody answered', summary: 'SECRETSUMMARY', category: 'lead', received_at: T(9) },
  ],
  hub_mail_sent: [{ connection_id: SHARED, gmail_thread_id: 'multi', to_address: 'small@example.com', sent_at: T(14) }],
}
const BANNED = /\b(body|snippet|summary)\b/

function memDb() {
  const calls = []
  return {
    calls,
    from(table) {
      const ops = []
      const b = {}
      for (const m of ['select', 'eq', 'neq', 'is', 'not', 'in', 'gte', 'lte', 'ilike', 'order', 'limit', 'insert', 'update', 'upsert', 'delete']) b[m] = (...a) => { ops.push([m, a]); return b }
      const run = (mode) => {
        calls.push({ table, ops })
        if (ops.some((o) => ['insert', 'update', 'upsert', 'delete'].includes(o[0]))) return { data: null, error: { code: 'WRITE_REFUSED' } }
        let rows = (DATA[table] || []).slice()
        for (const [m, a] of ops) {
          if (m === 'eq') rows = rows.filter((r) => r[a[0]] === a[1])
          if (m === 'is') rows = rows.filter((r) => (r[a[0]] ?? null) === a[1])
          if (m === 'in') rows = rows.filter((r) => a[1].includes(r[a[0]]))
          if (m === 'ilike') rows = rows.filter((r) => String(r[a[0]] ?? '').toLowerCase() === String(a[1]).replace(/\\(.)/g, '$1').toLowerCase())
        }
        const sel = ops.find((o) => o[0] === 'select')
        const cols = sel ? String(sel[1][0]).split(',').map((c) => c.trim()).filter(Boolean) : null
        if (cols && !cols.includes('*')) rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])))
        if (mode === 'one') return { data: rows[0] || null, error: null }
        return { data: rows, error: null }
      }
      b.maybeSingle = () => ({ then: (res, rej) => Promise.resolve(run('one')).then(res, rej) })
      b.single = b.maybeSingle
      b.then = (res, rej) => Promise.resolve(run('many')).then(res, rej)
      return b
    },
  }
}

async function as(contactId, userId) {
  const db = memDb()
  global.__ctx = { userId, orgIds: [ORG], orgRoles: { [ORG]: 'team_member' }, isSuperadmin: false, db }
  const r = await GET({ nextUrl: { searchParams: new URLSearchParams() } }, { params: { id: contactId } })
  return { status: r.status, lines: (r.body && r.body.lines) || [], calls: db.calls, text: JSON.stringify(r.body) }
}

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

;(async () => {
  const big = await as(BIG, OWNER)
  const ownerSmall = await as(SMALL, OWNER), staffSmall = await as(SMALL, STAFF)

  check('R_SEVEN', big.status === 200 && big.lines.length === 7, { n: big.lines.length })

  const labels = big.lines.map((l) => l.label)
  check('R_ORDER', JSON.stringify(labels.slice(0, 3)) === JSON.stringify(['Big 9', 'Big 8', 'Big 7'])
    && big.lines.every((l, i) => i === 0 || Date.parse(big.lines[i - 1].at) >= Date.parse(l.at)), labels)

  const multi = ownerSmall.lines.filter((l) => /Three messages/.test(l.label))
  check('R_THREAD', multi.length === 1 && ownerSmall.lines.filter((l) => l.label === 'Nobody answered').length === 1 && multi[0].lastReply === 'Mailbox Owner' && multi[0].at === T(14)
    && ownerSmall.lines.find((l) => l.label === 'Nobody answered')?.lastReply === 'No reply yet', ownerSmall.lines)

  const hidden = staffSmall.lines.filter((l) => l.hidden)
  const priv = hidden.find((l) => l.at === T(20))
  const ownerPriv = ownerSmall.lines.find((l) => l.at === T(20))
  check('R_PRIVATE', staffSmall.status === 200 && priv && priv.label === '1 private conversation' && priv.mailbox === null && priv.lastReply === null
    && !/PRIVATESUBJECT|owner-mailbox@/.test(staffSmall.text)
    && ownerPriv && !ownerPriv.hidden && ownerPriv.label === 'PRIVATESUBJECT' && ownerPriv.mailbox === 'owner-mailbox@neuroprogeny.com',
  { staff: staffSmall.lines, owner: ownerPriv })

  const mailSelects = [big, ownerSmall, staffSmall].flatMap((r) => r.calls).filter((c) => /^hub_mail_(messages|sent)$/.test(c.table))
    .map((c) => String(c.ops.find((o) => o[0] === 'select')?.[1][0] ?? '*'))
  const keysOk = [big, ownerSmall, staffSmall].every((r) => r.lines.every((l) => JSON.stringify(Object.keys(l).sort()) === JSON.stringify([...LINE_KEYS].sort())))
  check('R_NOBODY', mailSelects.length > 0 && mailSelects.every((s) => s !== '*' && !BANNED.test(s)) && keysOk && ![big, ownerSmall, staffSmall].some((r) => /SECRET/.test(r.text)), mailSelects)

  check('R_ALT', ownerSmall.lines.some((l) => l.label === 'From my second address'), ownerSmall.lines.map((l) => l.label))

  H.report(rows, active, RED_OF)
})().catch((e) => { console.error(e); process.exit(2) })
