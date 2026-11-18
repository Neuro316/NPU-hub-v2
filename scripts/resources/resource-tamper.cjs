#!/usr/bin/env node
// scripts/resources/resource-tamper.cjs   (Running List q33: resource and link database, tracked links)
//
// Runs the real src/lib/resources/links.ts and src/app/api/resources/links/route.ts against an in-memory
// database, and reads src/app/r/[code]/route.ts. Checks, from intent:
//   R_ACTIVE   the redirect follows only an existing, unrevoked code whose resource is active: an unknown,
//              malformed or revoked code and a retired resource never resolve; an active one does
//   R_CONTACT  a click is recorded on the link's own contact: the timeline entry names that contact and the
//              click updates that link only
//   R_NOSEND   making a share link only creates the link: it writes hub_resource_links and contact_timeline and
//              nothing else, and neither the share code nor its route imports a mail, SMS or provider module
//   R_STAFF    resources are read only by those the Resource Library allows: a staff member who is not a
//              platform superadmin gets 403 from the share route and no resource is read; both share handlers
//              sit behind withStaff
//   R_NOIP     the redirect reads nothing about the visitor (no headers, IP, user agent, referrer, geo) and a
//              click writes only the click time and count
//   R_TIME     the timeline text shows the latest click as a readable time in the org's time zone
//              (hub_send_policy.default_timezone, else America/New_York), never the raw ISO string; the columns
//              and metadata keep the ISO time
//
//   retiredgo     a retired resource still redirects                       {R_ACTIVE}
//   wrongcontact  the click's timeline entry goes to another contact       {R_CONTACT}
//   sends         making a link also queues a text                         {R_NOSEND}
//   openread      the share route drops the superadmin rule                {R_STAFF}
//   storeip       the redirect saves the visitor's address                 {R_NOIP}
//   rawtime       the timeline text shows the raw ISO click time           {R_TIME}
// TAMPER=1 reddens the sum (6).
const fs = require('fs'), path = require('path')
const H = require('../agent/lib/harness.cjs')

const L = 'lib/resources/links.ts', ROUTE = 'app/api/resources/links/route.ts', R = 'app/r/[code]/route.ts'
const TAMPERS = {
  retiredgo: [[L, '  if (!r || r.archived_at || !(r.url || r.storage_path)) return', '  if (!r || !(r.url || r.storage_path)) return']],
  wrongcontact: [[L, "      org_id: l.org_id, contact_id: l.contact_id, event_type: 'resource_link_opened'", "      org_id: l.org_id, contact_id: l.created_by, event_type: 'resource_link_opened'"]],
  sends: [[L, "  const linkId = (link as any).id as string\n", "  const linkId = (link as any).id as string\n  await db.from('hub_sms_outbox').insert({ org_id: i.orgId, contact_id: i.contactId, body: linkUrl(i.origin, code) })\n"]],
  openread: [[ROUTE, "export const GET = withStaff(async (req: NextRequest, ctx) => {\n  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)\n", "export const GET = withStaff(async (req: NextRequest, ctx) => {\n"]],
  rawtime: [[L, 'Latest: ${clickTimeLabel(at, await orgTimeZone(db, l.org_id))}.', 'Latest: ${at}.']],
  storeip: [[R, '  const r = await recordClick(db, code, new Date())\n', "  const r = await recordClick(db, code, new Date())\n  await db.from('hub_resource_links').update({ last_ip: _req.headers.get('x-forwarded-for') }).eq('code', code)\n"]],
}
const RED_OF = { retiredgo: ['R_ACTIVE'], wrongcontact: ['R_CONTACT'], sends: ['R_NOSEND'], openread: ['R_STAFF'], storeip: ['R_NOIP'], rawtime: ['R_TIME'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-resources')
const load = H.install(out, {
  'next/server': { NextResponse: { json: (body, init) => ({ status: (init && init.status) || 200, body }) } },
})
const links = load(L), route = load(ROUTE)

const ORG = '00000000-0000-0000-0000-000000000001'
const C1 = '00000000-0000-4000-8000-0000000c0001', C2 = '00000000-0000-4000-8000-0000000c0002'
const STAFF = '00000000-0000-4000-8000-0000000000a1'
const RES_ON = '00000000-0000-4000-8000-0000000000e1', RES_OFF = '00000000-0000-4000-8000-0000000000f2'
const NOW = new Date('2026-11-18T15:00:00Z')

function memDb() {
  const T = {
    contacts: [{ id: C1, org_id: ORG, merged_into_id: null }, { id: C2, org_id: ORG, merged_into_id: null }],
    hub_resources: [
      { id: RES_ON, org_id: ORG, name: 'Discovery call booking', url: 'https://university.neuroprogeny.com/book/neuro-progeny/discovery-call', storage_path: null, archived_at: null },
      { id: RES_OFF, org_id: ORG, name: 'Old checkout', url: 'https://example.com/old', storage_path: null, archived_at: '2026-11-01T00:00:00Z' },
    ],
    hub_resource_links: [
      { id: 'L1', org_id: ORG, resource_id: RES_ON, contact_id: C1, code: 'AAAAbbbb1111', created_by: STAFF, first_clicked_at: null, click_count: 0, revoked_at: null },
      { id: 'L2', org_id: ORG, resource_id: RES_OFF, contact_id: C1, code: 'RETIRED00000', created_by: STAFF, first_clicked_at: null, click_count: 0, revoked_at: null },
      { id: 'L3', org_id: ORG, resource_id: RES_ON, contact_id: C2, code: 'REVOKED00000', created_by: STAFF, first_clicked_at: null, click_count: 0, revoked_at: '2026-11-10T00:00:00Z' },
    ],
    contact_timeline: [],
  }
  const writes = []
  const db = H.stubDb({}, {
    table: (table, ops, mode) => {
      const w = ops.find((o) => ['insert', 'update', 'upsert', 'delete'].includes(o[0]))
      let rows = (T[table] || []).slice()
      for (const [m, a] of ops) {
        if (m === 'eq') rows = rows.filter((r) => r[a[0]] === a[1])
        if (m === 'is') rows = rows.filter((r) => (r[a[0]] ?? null) === a[1])
      }
      if (w) {
        const payload = Array.isArray(w[1][0]) ? w[1][0][0] : w[1][0]
        writes.push({ table, op: w[0], payload, where: ops.filter((o) => o[0] === 'eq').map((o) => o[1]) })
        if (w[0] === 'insert') {
          const row = { id: `${table}-${(T[table] || []).length + 1}`, ...payload }
          ;(T[table] = T[table] || []).push(row)
          return { data: mode === 'many' ? [row] : row, error: null }
        }
        for (const r of rows) Object.assign(r, payload)
        return { data: null, error: null }
      }
      return mode === 'maybeSingle' || mode === 'single' ? { data: rows[0] || null, error: null } : { data: rows, error: null }
    },
  })
  return { db, T, writes }
}

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

;(async () => {
  // R_ACTIVE
  {
    const { db } = memDb()
    const good = await links.recordClick(db, 'AAAAbbbb1111', NOW)
    const results = {
      unknown: await links.recordClick(db, 'ZZZZzzzz9999', NOW),
      malformed: await links.recordClick(db, 'short', NOW),
      revoked: await links.recordClick(db, 'REVOKED00000', NOW),
      retired: await links.recordClick(db, 'RETIRED00000', NOW),
    }
    const refused = Object.values(results).every((r) => r.ok === false)
    check('R_ACTIVE', good.ok && good.target.kind === 'url' && /discovery-call$/.test(good.target.url) && refused,
      { good: good.ok, refused: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.ok])) })
  }

  // R_CONTACT
  {
    const { db, T, writes } = memDb()
    await links.recordClick(db, 'AAAAbbbb1111', NOW)
    await links.recordClick(db, 'AAAAbbbb1111', new Date(NOW.getTime() + 60_000))
    const tl = T.contact_timeline.filter((t) => t.event_type === 'resource_link_opened')
    const linkUpdates = writes.filter((w) => w.table === 'hub_resource_links' && w.op === 'update')
    const onlyL1 = linkUpdates.length === 2 && linkUpdates.every((w) => w.where.some(([k, v]) => k === 'id' && v === 'L1'))
    const tlUpdate = writes.find((w) => w.table === 'contact_timeline' && w.op === 'update')
    const l1 = T.hub_resource_links.find((l) => l.id === 'L1')
    check('R_CONTACT', tl.length === 1 && tl[0].contact_id === C1 && onlyL1 && !!tlUpdate && tlUpdate.where.some(([k, v]) => k === 'contact_id' && v === C1)
      && l1.click_count === 2 && l1.first_clicked_at === NOW.toISOString(),
      { timeline: tl.map((t) => t.contact_id), onlyL1, clicks: l1.click_count })
  }

  // R_NOSEND
  {
    const { db, writes } = memDb()
    const r = await links.createShareLink(db, { orgId: ORG, contactId: C2, resourceId: RES_ON, userId: STAFF, origin: 'https://hub.example.com', now: NOW, code: 'NEWcode00001' })
    const tables = Array.from(new Set(writes.map((w) => w.table))).sort()
    const BAD = /(mail|gmail|resend|twilio|sms|outbox|notify|send)/i
    const imports = (rel) => Array.from(fs.readFileSync(path.join(H.SRC, rel), 'utf8').matchAll(/from '([^']+)'/g)).map((m) => m[1])
    const badImports = [...imports(L), ...imports(ROUTE)].filter((m) => BAD.test(m))
    const retired = await links.createShareLink(db, { orgId: ORG, contactId: C2, resourceId: RES_OFF, userId: STAFF, origin: 'https://hub.example.com', now: NOW })
    check('R_NOSEND', r.ok && r.url === 'https://hub.example.com/r/NEWcode00001' && JSON.stringify(tables) === JSON.stringify(['contact_timeline', 'hub_resource_links'])
      && badImports.length === 0 && retired.ok === false,
      { tables, badImports, retired: retired.ok })
  }

  // R_STAFF
  {
    const { db } = memDb()
    const req = { nextUrl: { searchParams: new URLSearchParams(`contact_id=${C1}`), origin: 'https://hub.example.com' }, json: async () => ({ contact_id: C1, resource_id: RES_ON }) }
    global.__ctx = { userId: STAFF, orgIds: [ORG], orgRoles: { [ORG]: 'team_member' }, isSuperadmin: false, db }
    const g = await route.GET(req, {})
    const p = await route.POST(req, {})
    const readRes = db.calls.some((c) => c.table === 'hub_resources' || c.table === 'hub_resource_links')
    global.__ctx = { userId: STAFF, orgIds: [ORG], orgRoles: { [ORG]: 'super_admin' }, isSuperadmin: true, db }
    const ok = await route.GET(req, {})
    const src = fs.readFileSync(path.join(H.SRC, ROUTE), 'utf8')
    const wrapped = /export const GET = withStaff\(/.test(src) && /export const POST = withStaff\(/.test(src)
    check('R_STAFF', g.status === 403 && p.status === 403 && !readRes && wrapped && ok.status === 200 && ok.body.resources.length === 1,
      { get: g.status, post: p.status, readRes, superadmin: ok.status })
  }

  // R_NOIP
  {
    const code = strip(fs.readFileSync(path.join(out, R.replace(/\.ts$/, '.js')), 'utf8'))
    const visitor = /\.headers\b|x-forwarded|x-real-ip|\.ip\b|user-agent|\.geo\b|cookies\(|referer/i.test(code)
    const { db, writes } = memDb()
    await links.recordClick(db, 'AAAAbbbb1111', NOW)
    const keys = writes.filter((w) => w.table === 'hub_resource_links').flatMap((w) => Object.keys(w.payload))
    const allowed = ['first_clicked_at', 'last_clicked_at', 'click_count']
    const meta = writes.filter((w) => w.table === 'contact_timeline').flatMap((w) => Object.keys(w.payload.metadata || {}))
    const metaOk = meta.every((k) => ['link_id', 'resource_id', 'first_clicked_at', 'last_clicked_at', 'clicks'].includes(k))
    check('R_NOIP', !visitor && keys.length > 0 && keys.every((k) => allowed.includes(k)) && metaOk, { visitor, keys, meta })
  }

  // R_TIME
  {
    const ISO = '2026-11-18T17:12:55.131Z'
    const labels = { ny: links.clickTimeLabel(ISO, 'America/New_York'), chi: links.clickTimeLabel(ISO, 'America/Chicago'), bad: links.clickTimeLabel(ISO, 'Not/AZone') }
    const { db, T, writes } = memDb()
    T.org_settings = [{ org_id: ORG, setting_key: 'hub_send_policy', setting_value: { default_timezone: 'America/Chicago' } }]
    await links.recordClick(db, 'AAAAbbbb1111', NOW)
    await links.recordClick(db, 'AAAAbbbb1111', new Date(NOW.getTime() + 60_000))
    // what the second click WRITES to the timeline (independent of which row it lands on: that is R_CONTACT)
    const tlWrite = writes.filter((w) => w.table === 'contact_timeline' && w.op === 'update').pop()?.payload ?? {}
    const linkWrite = writes.filter((w) => w.table === 'hub_resource_links' && w.op === 'update').pop()?.payload ?? {}
    const isoKept = linkWrite.last_clicked_at === '2026-11-18T15:01:00.000Z' && tlWrite.metadata?.last_clicked_at === '2026-11-18T15:01:00.000Z'
    check('R_TIME', labels.ny === 'Nov 18, 12:12 PM EST' && labels.chi === 'Nov 18, 11:12 AM CST' && labels.bad === labels.ny
      && tlWrite.description === 'Opened 2 times. Latest: Nov 18, 9:01 AM CST.' && !/\d{4}-\d\d-\d\dT/.test(tlWrite.description || '') && isoKept,
      { labels, description: tlWrite.description, isoKept })
  }

  delete global.__ctx
  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})()
