#!/usr/bin/env node
// scripts/comms/comms-tamper.cjs   (Running List q02: Communications on the contact card)
//
// Runs the real route (GET /api/crm/contacts/[id]/communications) against a small in-memory database that keeps
// only the selected columns and applies eq, in, ilike and is, as viewed by three people: the mailbox owner, a
// staff member who is neither owner nor superadmin, and a superadmin who is not the owner. Checks, from intent:
//   C_PRIVATE    a private mailbox's subject, summary and address reach only its owner; everyone else (superadmins
//                included) gets "Email (private inbox)" with no subject; sensitive triage categories are "Private
//                email" to all but the owner; shared mailboxes are full to superadmins only
//   C_NOBODY     no row carries a message body, every row has exactly the Touch fields, and no query selects a
//                body column (body, transcript, rendered_body, media_urls)
//   C_BROWSER    no browser-side file (a 'use client' file, or anything under src/components, src/lib/hooks or the
//                app's page folders) reads hub_mail_messages or hub_mail_sent
//   C_LIFECYCLE  lifecycle dry-run rows reach superadmins only, as muted "Would have" rows; for anyone else the
//                table is not even queried
//   C_MERGED     touches of a contact merged into this one are included: its text, its call, and an email from
//                its old address (in a SHARED mailbox, so this check never overlaps C_PRIVATE)
//   C_ALT        the alternates a merge records in custom_fields are matched: a text from an alt_phones number
//                (on a conversation not linked to the contact) and an email from an alt_emails address
//
//   privateopen   a private mailbox row is shown in full to a non-owner            {C_PRIVATE}
//   body          the text row selects and returns the message body                {C_NOBODY}
//   browserread   a client component reads hub_mail_messages                       {C_BROWSER}
//   lifecycleall  dry-run lifecycle rows are shown to every staff member           {C_LIFECYCLE}
//   nomerged      contacts merged into this one are left out                       {C_MERGED}
//   noalt         custom_fields alt_emails and alt_phones are ignored              {C_ALT}
// TAMPER=1 reddens the sum (6).
const fs = require('fs'), path = require('path')
const H = require('../agent/lib/harness.cjs')

const P = 'lib/comms/privacy.ts', HIST = 'lib/comms/history.ts', ROUTE = 'app/api/crm/contacts/[id]/communications/route.ts'
const TAMPERS = {
  privateopen: [[P, "  if (box.visibility === 'shared') return viewer.isSuperadmin ? 'full' : 'shared_inbox'\n  return 'private_inbox'", "  if (box.visibility === 'shared') return viewer.isSuperadmin ? 'full' : 'shared_inbox'\n  return 'full'"]],
  body: [[HIST, "const cols = 'id, direction, status, sent_by, sent_at, created_at, msg_type, from_e164, to_e164'", "const cols = 'id, direction, status, sent_by, sent_at, created_at, msg_type, from_e164, to_e164, body'"],
    [HIST, "summary: `${what} ${out ? 'sent' : 'received'}${status}` })", "summary: `${what} ${out ? 'sent' : 'received'}${status}: ${m.body}` })"]],
  browserread: [],
  lifecycleall: [[HIST, '  if (!viewer.isSuperadmin) return []\n', '']],
  nomerged: [[HIST, 'const all = [c, ...(merged ?? [])] as any[]', 'const all = [c] as any[]; void merged']],
  noalt: [[HIST, "  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []", '  void v; return []']],
}
const RED_OF = { privateopen: ['C_PRIVATE'], body: ['C_NOBODY'], browserread: ['C_BROWSER'], lifecycleall: ['C_LIFECYCLE'], nomerged: ['C_MERGED'], noalt: ['C_ALT'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-comms')
const load = H.install(out)
const privacy = load(P)
const { GET } = load(ROUTE)

const ORG = '00000000-0000-0000-0000-0000000000a1'
const C = '00000000-0000-4000-8000-000000000001', M = '00000000-0000-4000-8000-000000000002'
const OWNER = '00000000-0000-4000-8000-0000000000u1'.replace('u', 'a'), STAFF = '00000000-0000-4000-8000-0000000000b2', SUPER = '00000000-0000-4000-8000-0000000000c3'
const BOX = 'box-private-1', SHARED = 'box-shared-1'
const T = (h) => new Date(Date.UTC(2026, 10, 10, h)).toISOString()
const DATA = {
  contacts: [
    { id: C, org_id: ORG, email: 'Client@Example.com', phone: '(828) 555-0100', merged_into_id: null, custom_fields: { alt_emails: ['Alt.Person@Example.com'], alt_phones: ['+18285550177'] } },
    { id: M, org_id: ORG, email: 'old-address@example.com', phone: '(828) 555-0199', merged_into_id: C },
  ],
  hub_mail_connections: [
    { id: BOX, org_id: ORG, owner_user_id: OWNER, email_address: 'owner-mailbox@neuroprogeny.com', visibility: 'private' },
    { id: SHARED, org_id: ORG, owner_user_id: OWNER, email_address: 'shared-mailbox@neuroprogeny.com', visibility: 'shared' },
  ],
  hub_mail_messages: [
    { id: 'mm1', connection_id: BOX, from_address: 'client@example.com', subject: 'SECRETSUBJECT', summary: 'SECRETSUMMARY', category: 'lead', received_at: T(1), body: 'SECRETBODY' },
    { id: 'mm2', connection_id: BOX, from_address: 'client@example.com', subject: 'CLINICALSUBJECT', summary: 'x', category: 'clinical', received_at: T(2) },
    { id: 'mm3', connection_id: SHARED, from_address: 'old-address@example.com', subject: 'Hello again', summary: 'A short check-in', category: 'lead', received_at: T(8) },
    { id: 'mm4', connection_id: SHARED, from_address: 'alt.person@example.com', subject: 'From my other address', summary: 'Same person', category: 'lead', received_at: T(9) },
  ],
  hub_mail_sent: [{ id: 'ms1', connection_id: BOX, to_address: 'client@example.com', sent_at: T(3) }],
  conversations: [{ id: 'cv1', contact_id: M }],
  crm_messages: [
    { id: 'tx1', conversation_id: 'cv1', org_id: ORG, direction: 'inbound', body: 'SECRETBODY', status: 'received', created_at: T(4), msg_type: 'sms' },
    { id: 'tx2', conversation_id: 'cv-unlinked', org_id: ORG, direction: 'inbound', body: 'SECRETBODY', status: 'received', created_at: T(10), msg_type: 'sms', from_e164: '+18285550177', to_e164: '+18285550000' },
  ],
  call_logs: [{ id: 'cl1', contact_id: M, org_id: ORG, direction: 'outbound', status: 'completed', started_at: T(5), duration_seconds: 300, transcript: 'SECRETBODY', ai_summary: 'Talked about scheduling', team_member_id: 'tm1' }],
  team_members: [{ id: 'tm1', display_name: 'Cameron Allen' }],
  message_sends: [{ id: 'snd1', contact_id: C, channel: 'email', status: 'dry_run', dry_run: true, rendered_body: 'SECRETBODY', subject: 'SECRETBODY', claimed_at: T(6) }],
  send_log: [],
  hub_lifecycle_events: [{ id: 'lc1', contact_id: C, event_type: 'booking_made', occurred_at: T(7), mode: 'dry_run' }],
}
const BODY_COLS = /\b(body|transcript|rendered_body|media_urls)\b/

function memDb() {
  const calls = []
  const db = {
    calls,
    rpc: async () => ({ data: null, error: null }),
    from(table) {
      const ops = []
      const b = {}
      for (const m of ['select', 'eq', 'neq', 'is', 'not', 'in', 'gte', 'gt', 'lte', 'lt', 'like', 'ilike', 'or', 'order', 'limit', 'insert', 'update', 'upsert', 'delete']) b[m] = (...a) => { ops.push([m, a]); return b }
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
        if (mode === 'single' || mode === 'maybeSingle') return { data: rows[0] || null, error: null }
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

async function as(userId, isSuperadmin) {
  const db = memDb()
  global.__ctx = { userId, orgIds: [ORG], orgRoles: { [ORG]: 'team_member' }, isSuperadmin, db }
  const r = await GET({ nextUrl: { searchParams: new URLSearchParams() } }, { params: { id: C } })
  return { status: r.status, touches: (r.body && r.body.touches) || [], calls: db.calls, text: JSON.stringify(r.body) }
}

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

;(async () => {
  const owner = await as(OWNER, false), staff = await as(STAFF, false), sup = await as(SUPER, true)

  // C_PRIVATE
  {
    const PRIVATE_IDS = ['mail:mm1', 'mail:mm2', 'sent:ms1']
    const mailOf = (v) => v.touches.filter((t) => PRIVATE_IDS.includes(t.id))
    const hidden = (v) => !/SECRETSUBJECT|SECRETSUMMARY|CLINICALSUBJECT|owner-mailbox/.test(v.text)
    const redactedOk = (v) => mailOf(v).length === 3 && mailOf(v).every((t) => t.redacted && t.who === null && /^(Email \(private inbox\)|Private email)$/.test(t.summary))
    const ownerFull = mailOf(owner).length === 3 && owner.text.includes('SECRETSUBJECT') && owner.text.includes('CLINICALSUBJECT')
      && mailOf(owner).some((t) => t.summary === 'Email sent from owner-mailbox@neuroprogeny.com')
    const v = (u, s) => ({ userId: u, isSuperadmin: s })
    const shared = { id: 'b', owner_user_id: OWNER, email_address: 'x@neuroprogeny.com', visibility: 'shared' }
    const pure = privacy.mailView(v(SUPER, true), shared, 'lead') === 'full' && privacy.mailView(v(STAFF, false), shared, 'lead') === 'shared_inbox'
      && privacy.mailView(v(SUPER, true), shared, 'legal_financial') === 'private_email' && privacy.mailView(v(OWNER, false), shared, 'clinical') === 'full'
    check('C_PRIVATE', staff.status === 200 && hidden(staff) && hidden(sup) && redactedOk(staff) && redactedOk(sup) && ownerFull && pure,
      { staff: mailOf(staff).map((t) => t.summary), sup: mailOf(sup).map((t) => t.summary), pure })
  }

  // C_NOBODY
  {
    const keysOk = (v) => v.touches.every((t) => JSON.stringify(Object.keys(t).sort()) === JSON.stringify([...privacy.TOUCH_KEYS].sort()))
    const bodySelects = [owner, staff, sup].flatMap((v) => v.calls).filter((c) => { const s = c.ops.find((o) => o[0] === 'select'); return s && BODY_COLS.test(String(s[1][0])) }).map((c) => c.table)
    check('C_NOBODY', [owner, staff, sup].every((v) => !v.text.includes('SECRETBODY') && keysOk(v)) && bodySelects.length === 0, { bodySelects })
  }

  // C_BROWSER
  {
    const files = new Map()
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.set(path.relative(H.ROOT, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')) } }
    walk(path.join(H.ROOT, 'src'))
    if (active.includes('browserread')) files.set('src/components/crm/planted-inbox.tsx', "'use client'\nexport async function x(s: any) { return s.from('hub_mail_messages').select('subject') }\n")
    const browser = (f, s) => /^\s*['"]use client['"]/.test(s) || /^src\/(components|lib\/hooks)\//.test(f) || /^src\/app\/\((dashboard|public)\)\//.test(f)
    const bad = Array.from(files.entries()).filter(([f, s]) => !f.startsWith('src/app/api/') && browser(f, s) && /from\(\s*['"]hub_mail_(messages|sent)['"]\s*\)/.test(s)).map(([f]) => f)
    check('C_BROWSER', bad.length === 0, bad)
  }

  // C_LIFECYCLE
  {
    const lc = (v) => v.touches.filter((t) => t.type === 'lifecycle')
    const queried = staff.calls.some((c) => c.table === 'hub_lifecycle_events')
    check('C_LIFECYCLE', lc(staff).length === 0 && lc(owner).length === 0 && !queried && lc(sup).length === 1 && lc(sup)[0].muted && /^Would have: /.test(lc(sup)[0].summary),
      { staff: lc(staff).length, queried, sup: lc(sup).map((t) => t.summary) })
  }

  // C_MERGED
  {
    const ids = staff.touches.map((t) => t.id)
    check('C_MERGED', ids.includes('text:tx1') && ids.includes('call:cl1') && ids.includes('mail:mm3'), ids)
  }

  // C_ALT
  {
    const ids = staff.touches.map((t) => t.id)
    check('C_ALT', ids.includes('text:tx2') && ids.includes('mail:mm4'), ids)
  }

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})()
