#!/usr/bin/env node
// scripts/crm/contact-fixes-tamper.cjs   (Running List q30: Contacts search and contact card fixes)
//
// Checks, from intent:
//   S_LATEST   every new search filters, and only the newest request's results are applied: a slower, older
//              response that lands last is dropped (src/lib/contacts/search.ts latestOnly, and the Contacts page
//              checks it before setting the list)
//   S_QUERY    the search text reaches PostgREST safely: a comma or parenthesis cannot break the filter, two
//              different names give two different filters, and "first last" also matches first and last name
//   S_QUERY also covers "Last, First": "Bauer, Heather" matches last name Bauer and first name Heather
//   C_SOURCE   EVERY Calls, Texts or Emails tile on the card, on any tab, shows commCounts (countTouches over the
//              shared useCommunications touches); no component the card renders reads contacts.total_*. (The removed
//              Stats tab read those columns, which an app route and a database trigger both bump, so they doubled.)
//   C_CLICK    a tile click switches the card to the tab that holds Communications, opens it and filters it to the
//              tile's type (commsTileAction, applied by openComms, wired to each tile)
//   C_PRIVATE  a private mail the viewer may not read (a redacted row) is not counted as one of their emails; it is
//              reported apart, so emails + private equals the email rows in their list
//
//   olderwins     every response counts as the newest, so an older one can win   {S_LATEST}
//   rawquery      the search text goes into the filter uncleaned                  {S_QUERY}
//   oldcounts     the Calls count reads contacts.total_calls again                {C_SOURCE}
//   countprivate  redacted private mail counts as the viewer's email             {C_PRIVATE}
//   noswitch      a tile click leaves the card on another tab                    {C_CLICK}
// TAMPER=1 reddens the sum (5).
const fs = require('fs'), path = require('path')
const H = require('../agent/lib/harness.cjs')

const S = 'lib/contacts/search.ts', C = 'lib/comms/counts.ts'
const TAMPERS = {
  olderwins: [[S, '    isLatest: (n: number) => n === seq,', '    isLatest: (n: number) => n > 0,']],
  rawquery: [[S, "  return String(q ?? '').replace(/[,()*%\\\\\"'`]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 80)", "  return String(q ?? '').trim()"]],
  oldcounts: [],
  countprivate: [[C, "else if (t.type === 'email') { if (t.redacted) out.privateEmails++; else out.emails++ }", "else if (t.type === 'email') out.emails++"]],
  noswitch: [[C, "  return { tab: 'overview', open: true, filter: type }", "  return { tab: 'stats' as any, open: true, filter: type }"]],
}
const RED_OF = { olderwins: ['S_LATEST'], rawquery: ['S_QUERY'], oldcounts: ['C_SOURCE'], countprivate: ['C_PRIVATE'], noswitch: ['C_CLICK'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-contactfix')
const load = H.install(out)
const search = load(S), counts = load(C)
const read = (rel) => fs.readFileSync(path.join(H.ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

// S_LATEST: search "Erika", then "Sharon"; the "Erika" response arrives LAST
{
  const seq = search.latestOnly()
  let shown = 'initial'
  const apply = (n, result) => { if (seq.isLatest(n)) shown = result }
  const a = seq.begin(), b = seq.begin()
  apply(b, 'sharon results')
  apply(a, 'erika results')        // older, slower response
  const third = seq.begin()
  apply(third, 'third results')    // a further change still filters
  const page = read('src/app/(dashboard)/crm/contacts/page.tsx')
  const guarded = /const seq = loadSeq\.current\.begin\(\)[\s\S]*?if \(!loadSeq\.current\.isLatest\(seq\)\) return\s*\n\s*setContacts\(res\.contacts\)/.test(page)
  check('S_LATEST', shown === 'third results' && guarded && (() => { const s2 = search.latestOnly(); const x = s2.begin(); s2.begin(); return !s2.isLatest(x) })(), { shown, guarded })
}

// S_QUERY
{
  const f1 = search.contactSearchFilter('Erika'), f2 = search.contactSearchFilter('Sharon')
  const comma = search.contactSearchFilter('Smith, Erika (WNW)')
  const full = search.contactSearchFilter('Erika Smith')
  const lastFirst = search.contactSearchFilter('Bauer, Heather')
  const unsafe = (f) => /[(),]/.test(f.replace(/and\(|\)$|\),/g, '').replace(/,(first_name|last_name|email|phone)\.ilike/g, ''))
  check('S_QUERY', f1 && f2 && f1 !== f2 && f1.includes('Erika') && f2.includes('Sharon') && search.contactSearchFilter('  ') === null
    && !/[(),]/.test(search.cleanSearch('Smith, Erika (WNW)')) && !unsafe(comma)
    && full.includes('and(first_name.ilike.*Erika*,last_name.ilike.*Smith*)')
    && lastFirst.includes('and(last_name.ilike.*Bauer*,first_name.ilike.*Heather*)') && !/Bauer,/.test(lastFirst), { f1, comma, full, lastFirst })
}

// C_SOURCE
{
  let card = read('src/components/crm/contact-detail.tsx')
  if (active.includes('oldcounts')) card = card.replace("{comms.touches ? commCounts.calls : '-'}", '{(contact as any).total_calls || 0}')
  // the card and every crm component it imports (any tab renders one of these)
  const imported = Array.from(card.matchAll(/from '@\/components\/crm\/([a-z0-9-]+)'/g)).map((m) => `src/components/crm/${m[1]}.tsx`)
    .filter((f) => fs.existsSync(path.join(H.ROOT, f)))
  const files = [['contact-detail', card], ...imported.map((f) => [f, read(f)])]
  // a count DISPLAYED from the old columns: a JSX expression naming total_* that renders into markup (a write path,
  // such as the email composer bumping total_emails after a send, is not a displayed count)
  const readsOld = files.filter(([, t]) => /\{[^{}]*total_(calls|texts|emails)[^{}]*\}\s*</.test(t)).map(([f]) => f)
  // every tile: the label paragraph is preceded, inside its button, by a commCounts value
  const tiles = []
  for (const [f, t] of files) for (const m of t.matchAll(/>(Calls|Texts|Emails)[<{]/g)) {
    const before = t.slice(Math.max(0, m.index - 400), m.index)
    const key = { Calls: 'calls', Texts: 'texts', Emails: 'emails' }[m[1]]
    tiles.push({ f, label: m[1], ok: before.includes(`commCounts.${key}`) })
  }
  const shared = card.includes('const comms = useCommunications(contactId)') && card.includes('countTouches(comms.touches ?? [])')
    && card.includes('<CommunicationsHistory state={comms}') && !card.includes('ContactCommPanel')
  const touches = [{ type: 'call' }, { type: 'call' }, { type: 'text' }, { type: 'email' }, { type: 'meeting' }, { type: 'lifecycle', muted: true }].map((t) => ({ redacted: false, muted: false, ...t }))
  const c = counts.countTouches(touches)
  check('C_SOURCE', readsOld.length === 0 && tiles.length === 3 && tiles.every((x) => x.ok) && shared && c.calls === 2 && c.texts === 1 && c.emails === 1,
    { readsOld, tiles, shared, c })
}

// C_CLICK
{
  const card = read('src/components/crm/contact-detail.tsx')
  const a = counts.commsTileAction('text')
  // the tab that holds the Communications section
  const ov = card.indexOf("{tab === 'overview' && (")
  const next = card.indexOf('{tab === ', ov + 10)
  const holder = ov >= 0 && card.indexOf('<CommunicationsHistory', ov) > ov && card.indexOf('<CommunicationsHistory', ov) < next ? 'overview' : null
  const applies = /const a = commsTileAction\(type\)\s*\n\s*setTab\(a\.tab\); setCommsFilter\(a\.filter\); setCommsOpen\(a\.open\)/.test(card)
  const wired = ['call', 'text', 'email'].every((t) => card.includes(`onClick={() => openComms('${t}')}`))
  check('C_CLICK', a.tab === holder && a.open === true && a.filter === 'text' && applies && wired, { a, holder, applies, wired })
}

// C_PRIVATE
{
  const list = [{ type: 'email', redacted: true, muted: false }, { type: 'email', redacted: false, muted: false }]
  const nonOwner = counts.countTouches(list)
  const owner = counts.countTouches(list.map((t) => ({ ...t, redacted: false })))
  check('C_PRIVATE', nonOwner.emails === 1 && nonOwner.privateEmails === 1 && owner.emails === 2 && owner.privateEmails === 0, { nonOwner, owner })
}

H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
