#!/usr/bin/env node
// scripts/metrics/touch-tamper.cjs   (Running List q41, decision c12: one touch rule, src/lib/touch/first-touch.ts)
//
// Runs the REAL touch rule, the REAL speed to lead loader (src/lib/metrics/collect.ts) and the REAL lifecycle
// firstTouchSince (src/lib/lifecycle/scan.ts) against a filtering stub database. Six leads arrive at T0; each has
// one kind of outbound activity after it. Checks, from intent:
//   T_PRIVATE  a reply from a PRIVATE connected mailbox is a touch (its hub_mail_sent row, 30 min after the lead)
//   T_CONTENT  reply content is never read: the only mail table touched is hub_mail_sent, and only its recipient
//              address and sent time are selected; hub_mail_messages (subjects, bodies) is never queried
//   T_DRYRUN   a dry-run send and a skipped send are not touches (the lead that only had those stays untouched)
//   T_SENT     a delivered text (10 min), a sent campaign email (20), a client confirmation (40) and a shared booking
//              link (50) each count; a failed text and the staff copy of a confirmation do not
//   T_AGREE    for every lead, the speed to lead tile and lead_no_touch_24h see the same first touch: the tile's
//              minutes equal the lifecycle touch, and a lead is untouched on the tile exactly when it is owed a task
//   I_IMPORT_NOT_STL an imported contact (an import batch, source sensorium_import, or a source starting 'import')
//              with no touch is neither a speed to lead record nor counted; the leads tile still lists it by source
//
//   sharedonly   the reply touch reads shared mailboxes only (the old rule)         {T_PRIVATE}
//   readbody     the touch also reads the sent message's subject and body          {T_CONTENT}
//   countdry     engine sends count whatever their status or dry run               {T_DRYRUN}
//   nodelivered  a delivered text is not counted                                   {T_SENT}
//   tilebefore   the tiles take a touch from before the lead arrived (an old call)  {T_AGREE}
//   stlimport    the speed to lead set lets imported contacts in                    {I_IMPORT_NOT_STL}
//   tilelength   a contact count tile counts fetched rows (capped at 1,000)          {I_TILE_COUNT}
//   tileimport   the activity tiles let an untouched imported contact in            {I_IMPORT_NOT_IN_TILES}
//   alertimport  the 'no new leads in 48 hours' alert counts an import as an arrival {A_IMPORT_NOT_ARRIVAL}
// TAMPER=1 reddens the sum (9).
const fs = require('fs')
const path = require('path')
const H = require('../agent/lib/harness.cjs')

const FT = 'lib/touch/first-touch.ts', COL = 'lib/metrics/collect.ts', TILES = 'lib/metrics/contact-tiles.ts', ALERTS = 'lib/metrics/alerts.ts'
const TAMPERS = {
  sharedonly: [[FT, "db.from('hub_mail_sent').select(MAIL_SENT_COLUMNS).in('to_address', ch)", "db.from('hub_mail_sent').select(MAIL_SENT_COLUMNS).eq('visibility', 'shared').in('to_address', ch)"]],
  readbody: [[FT, '  return touches\n}', "  if (addrs.length) await db.from('hub_mail_messages').select('subject, body').in('from_address', addrs)\n  return touches\n}"]],
  countdry: [[FT, ".eq('status', 'sent').eq('dry_run', false).not('sent_at', 'is', null)", ".not('sent_at', 'is', null)"]],
  nodelivered: [[FT, "export const TEXT_SENT = ['queued', 'sending', 'sent', 'delivered']", "export const TEXT_SENT = ['queued', 'sending', 'sent']"]],
  stlimport: [[COL, '  const inbound = leads.filter(c => SCORECARD_CHANNELS(leadChannel(c.source)) && !isImportedLead(c))', '  const inbound = leads.filter(c => SCORECARD_CHANNELS(leadChannel(c.source)))']],
  tilelength: [[TILES, "  let q: any = db.from('contacts').select('id', { count: 'exact', head: true })", "  let q: any = db.from('contacts').select('id')"],
    [TILES, '  const { count, error } = await q\n', '  const { data, error } = await q\n  const count = (data ?? []).length\n']],
  tileimport: [[TILES, 'export const inActivityTiles = (c: TileContact): boolean => !isImportedLead(c) || !!c.last_contacted_at', 'export const inActivityTiles = (c: TileContact): boolean => true']],
  alertimport: [[ALERTS, 'SCORECARD_CHANNELS(leadChannel(c.source)) && !isImportedLead(c)).length', 'SCORECARD_CHANNELS(leadChannel(c.source))).length']],
  tilebefore: [[COL, 'stlLeads.map(c => ({ id: c.id, email: c.email, since: c.created_at }))', "stlLeads.map(c => ({ id: c.id, email: c.email, since: '1970-01-01T00:00:00Z' }))"]],
}
const RED_OF = { sharedonly: ['T_PRIVATE'], readbody: ['T_CONTENT'], countdry: ['T_DRYRUN'], nodelivered: ['T_SENT'], tilebefore: ['T_AGREE'], stlimport: ['I_IMPORT_NOT_STL'], tilelength: ['I_TILE_COUNT'], tileimport: ['I_IMPORT_NOT_IN_TILES'], alertimport: ['A_IMPORT_NOT_ARRIVAL'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-touch')
const load = H.install(out)
const touch = load(FT)
const collect = load(COL)
const scan = load('lib/lifecycle/scan.ts')
const rules = load('lib/lifecycle/rules.ts')

// ── fixture ──
const T0 = Date.parse('2026-11-10T15:00:00Z')
const at = (min) => new Date(T0 + min * 60_000).toISOString()
const NOW = new Date(T0 + 3 * 86_400_000)
const lead = (id, email) => ({ id, first_name: id, last_name: null, email, phone: null, tags: [], source: 'website', created_at: at(0), merged_into_id: null })
const DATA = {
  contacts: [lead('priv', 'priv@example.com'), lead('text', 'text@example.com'), lead('mail', 'mail@example.com'),
    lead('dry', 'dry@example.com'), lead('conf', 'conf@example.com'), lead('book', 'book@example.com')],
  hub_mail_connections: [{ id: 'mb1', visibility: 'private' }],
  hub_mail_sent: [{ connection_id: 'mb1', gmail_message_id: 'a1', gmail_thread_id: 'b1', to_address: 'priv@example.com', sent_at: at(30) }],
  hub_mail_messages: [{ connection_id: 'mb1', from_address: 'priv@example.com', subject: 'private', body: 'private' }],
  conversations: [{ id: 'cv1', contact_id: 'text' }],
  call_logs: [{ contact_id: 'mail', direction: 'outbound', started_at: at(-60), created_at: at(-60) }],  // before the lead: never its touch
  crm_messages: [
    { conversation_id: 'cv1', direction: 'outbound', status: 'failed', sent_at: at(2), created_at: at(2) },
    { conversation_id: 'cv1', direction: 'outbound', status: 'delivered', sent_at: at(10), created_at: at(10) },
  ],
  message_sends: [
    { contact_id: 'mail', status: 'sent', dry_run: false, sent_at: at(20) },
    { contact_id: 'dry', status: 'dry_run', dry_run: true, sent_at: at(5) },
    { contact_id: 'dry', status: 'skipped', dry_run: false, sent_at: at(6) },
  ],
  stage_email_sends: [
    { contact_id: 'conf', recipient: 'internal', status: 'sent', sent_at: at(1) },
    { contact_id: 'conf', recipient: 'client', status: 'sent', sent_at: at(40) },
  ],
  hub_resources: [{ id: 'r1', kind: 'booking_link' }, { id: 'r2', kind: 'pdf' }],
  hub_resource_links: [
    { contact_id: 'book', resource_id: 'r2', created_at: at(3), revoked_at: null },
    { contact_id: 'book', resource_id: 'r1', created_at: at(50), revoked_at: null },
  ],
}
const WANT = { priv: 30, text: 10, mail: 20, dry: null, conf: 40, book: 50 }

// a stub that applies the filters, and records every table and select
function db() {
  const calls = []
  const cmp = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return Number.isNaN(x) || Number.isNaN(y) ? (a < b ? -1 : a > b ? 1 : 0) : x - y }
  return {
    calls,
    from(table) {
      const ops = []
      const b = {}
      for (const m of ['select', 'eq', 'neq', 'is', 'not', 'in', 'gte', 'gt', 'lte', 'lt', 'order', 'limit', 'range']) b[m] = (...a) => { ops.push([m, a]); return b }
      const run = (mode) => {
        calls.push({ table, ops })
        let rows = (DATA[table] || []).slice()
        for (const [m, a] of ops) {
          if (m === 'eq') rows = rows.filter((r) => r[a[0]] === a[1])
          if (m === 'neq') rows = rows.filter((r) => r[a[0]] !== a[1])
          if (m === 'is') rows = rows.filter((r) => (r[a[0]] ?? null) === a[1])
          if (m === 'not' && a[1] === 'is') rows = rows.filter((r) => (r[a[0]] ?? null) !== a[2])
          if (m === 'in') rows = rows.filter((r) => a[1].includes(r[a[0]]))
          if (m === 'gte') rows = rows.filter((r) => r[a[0]] != null && cmp(r[a[0]], a[1]) >= 0)
          if (m === 'gt') rows = rows.filter((r) => r[a[0]] != null && cmp(r[a[0]], a[1]) > 0)
          if (m === 'lte') rows = rows.filter((r) => r[a[0]] != null && cmp(r[a[0]], a[1]) <= 0)
          if (m === 'lt') rows = rows.filter((r) => r[a[0]] != null && cmp(r[a[0]], a[1]) < 0)
          if (m === 'range') rows = rows.slice(a[0], a[1] + 1)
        }
        return mode === 'one' ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }
      }
      b.maybeSingle = () => ({ then: (res, rej) => Promise.resolve(run('one')).then(res, rej) })
      b.single = b.maybeSingle
      b.then = (res, rej) => Promise.resolve(run('many')).then(res, rej)
      return b
    },
  }
}

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
const mins = (t) => (t == null ? null : Math.round((t - T0) / 60_000))

;(async () => {
  const d = db()
  const leads = DATA.contacts.map((c) => ({ id: c.id, email: c.email, since: c.created_at }))
  const first = await touch.firstTouches(d, leads)
  const got = Object.fromEntries(leads.map((l) => [l.id, mins(first.get(l.id))]))

  check('T_PRIVATE', got.priv === WANT.priv, { priv: got.priv })

  const mailCalls = d.calls.filter((c) => /^hub_mail/.test(c.table))
  const sentSelects = mailCalls.filter((c) => c.table === 'hub_mail_sent').map((c) => c.ops.find((o) => o[0] === 'select')?.[1][0])
  check('T_CONTENT', mailCalls.length > 0 && mailCalls.every((c) => c.table === 'hub_mail_sent') && sentSelects.every((s) => s === 'to_address, sent_at'),
    { tables: Array.from(new Set(mailCalls.map((c) => c.table))), sentSelects })

  check('T_DRYRUN', got.dry === null, { dry: got.dry })

  check('T_SENT', got.text === WANT.text && got.mail === WANT.mail && got.conf === WANT.conf && got.book === WANT.book, got)

  // T_AGREE: the tiles (speed_to_lead and self_booked_leads items) against lifecycle firstTouchSince and leadOwedTask
  const ctx = { db: db(), from: '2026-11-10', to: '2026-11-10', today: '2026-11-13', now: NOW,
    filter: { isTestContact: () => false, isTestEmail: () => false, isTestProfile: () => false, isTestPromo: () => false, isTestProgramName: () => false, testProfileIds: new Set(), stats: {} } }
  const items = await collect.LOADERS.contacts(ctx)
  const tile = new Map(items.filter((i) => i.metric === 'speed_to_lead').map((i) => [i.rec.id, i]))
  const bad = []
  for (const c of DATA.contacts) {
    const t = await scan.firstTouchSince(db(), c.id, c.email, c.created_at)
    const it = tile.get(c.id)
    const untouchedOnTile = !it || /no outbound touch yet/.test(it.rec.sub)
    const owed = rules.leadOwedTask(T0, t, null, NOW.getTime())
    const same = it && (t === null ? untouchedOnTile : !untouchedOnTile && it.value === mins(t))
    if (!same || owed !== untouchedOnTile) bad.push({ id: c.id, tile: it ? it.rec.sub : null, lifecycle: mins(t), owed })
  }
  check('T_AGREE', tile.size === DATA.contacts.length && bad.length === 0, bad)

  // I_IMPORT_NOT_STL: three imported contacts, untouched, beside the six leads
  const imported = [{ ...lead('imp-batch', 'imp1@example.com'), import_batch_id: 'batch-1' }, { ...lead('imp-sens', 'imp2@example.com'), source: 'sensorium_import' },
    { ...lead('imp-csv', 'imp3@example.com'), source: 'import_csv' }]
  DATA.contacts.push(...imported)
  const items2 = await collect.LOADERS.contacts(ctx)
  DATA.contacts.splice(-imported.length)
  const ids = new Set(imported.map((c) => c.id))
  const stl = items2.filter((i) => (i.metric === 'speed_to_lead' || i.metric === 'self_booked_leads') && ids.has(i.rec.id))
  const leadsTile = items2.filter((i) => i.metric === 'leads' && i.rec?.id === 'imp-batch')
  const stlCount = items2.filter((i) => i.metric === 'speed_to_lead').length
  check('I_IMPORT_NOT_STL', stl.length === 0 && stlCount === tile.size && leadsTile.length === 1, { stl: stl.map((i) => i.rec.id), stlCount, leadsTile: leadsTile.length })

  // I_TILE_COUNT: 1,500 contacts behind a PostgREST-like 1,000-row cap; the count tile and the paged read both see 1,500,
  // and the CRM Dashboard and Analytics count tiles read the count, never a row list's length
  const tiles = load(TILES)
  const big = Array.from({ length: 1500 }, (_, i) => ({ id: `c${String(i).padStart(4, '0')}`, org_id: 'org', merged_into_id: null, archived_at: null }))
  const capped = H.stubDb({ contacts: big }, { table: (t, ops) => {
    const sel = ops.find((o) => o[0] === 'select'); if (sel && sel[1][1] && sel[1][1].head) return undefined
    const r = ops.find((o) => o[0] === 'range'); const [a, b] = r ? r[1] : [0, 999]
    return { data: big.slice(a, Math.min(b + 1, a + 1000)), error: null }
  } })
  const counted = await tiles.countContacts(capped, 'org'), paged = await tiles.loadContactRows(capped, 'org', 'id')
  const read = (rel) => fs.readFileSync(path.join(H.ROOT, rel), 'utf8')
  const dash = read('src/app/(dashboard)/crm/page.tsx'), ana = read('src/app/(dashboard)/crm/analytics/page.tsx')
  const pagesUseCounts = /label="Total Contacts" value=\{counts \? counts\.total/.test(dash) && /label="Contacts" value=\{totalContacts/.test(ana)
    && !/value=\{contacts\.length\}/.test(dash + ana) && !/contacts\.forEach\(c => \{\s*const s = \(c as any\)\.mastermind_status/.test(dash) && !/fetchContacts\(/.test(dash + ana)
  check('I_TILE_COUNT', counted === 1500 && paged.length === 1500 && pagesUseCounts, { counted, paged: paged.length, pagesUseCounts })

  // I_IMPORT_NOT_IN_TILES: imported today and untouched stays out of new / this month / never contacted; touched, it counts
  const DAY = 86_400_000, NOWT = T0
  const iso = (d) => new Date(NOWT - d * DAY).toISOString()
  const tc = [
    { id: 'n1', created_at: iso(1), last_contacted_at: null, source: 'website', import_batch_id: null },
    { id: 'i1', created_at: iso(1), last_contacted_at: null, source: 'cold', import_batch_id: 'batch-1' },
    { id: 'i2', created_at: iso(2), last_contacted_at: null, source: 'sensorium_import', import_batch_id: null },
    { id: 'i3', created_at: iso(20), last_contacted_at: null, source: 'import_csv', import_batch_id: null },
    { id: 'i4', created_at: iso(3), last_contacted_at: iso(1), source: 'podcast', import_batch_id: 'batch-1' },
  ]
  const at2 = tiles.activityTiles(tc, NOWT, () => true)
  check('I_IMPORT_NOT_IN_TILES', at2.newThisWeek === 2 && at2.thisMonth === 2 && at2.neverContacted === 1 && at2.stale14d === 0
    && !tiles.inActivityTiles(tc[1]) && tiles.inActivityTiles(tc[4]) && /activityTiles\(contacts, now,/.test(ana), at2)

  // A_IMPORT_NOT_ARRIVAL: the alert run (a Tuesday, so no Monday scorecard) sees only imported contacts in the last 48 hours,
  // by batch, by source 'sensorium_import' and by a source starting 'import': it is a day with no new leads and the text goes.
  // With one real website lead beside them, it does not.
  const alerts = load(ALERTS)
  const AT = new Date('2026-11-24T20:05:00Z'), recent = new Date(AT.getTime() - 3_600_000).toISOString()
  const ic = (id, extra) => ({ id, email: `${id}@example.com`, phone: null, tags: [], source: 'website', import_batch_id: null, created_at: recent, merged_into_id: null, ...extra })
  const imports = [ic('ia', { import_batch_id: 'batch-1' }), ic('ib', { source: 'sensorium_import' }), ic('ic', { source: 'import_csv' })]
  const onlyImports = await alerts.runAlerts(H.stubDb({ contacts: imports }), AT)
  const withLead = await alerts.runAlerts(H.stubDb({ contacts: [...imports, ic('real', {})] }), AT)
  check('A_IMPORT_NOT_ARRIVAL', onlyImports.leads48 === 0 && onlyImports.sent.includes('no_leads_48h') && withLead.leads48 === 1 && !withLead.sent.includes('no_leads_48h'),
    { onlyImports: [onlyImports.leads48, onlyImports.sent], withLead: [withLead.leads48, withLead.sent] })

  H.report(rows, active, RED_OF)
})().catch((e) => { console.error(e); process.exit(2) })
