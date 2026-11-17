#!/usr/bin/env node
// scripts/crm/contact-fixes-tamper.cjs   (Running List q30: Contacts search and contact card fixes)
//
// Checks, from intent:
//   S_LATEST   every new search filters, and only the newest request's results are applied: a slower, older
//              response that lands last is dropped (src/lib/contacts/search.ts latestOnly, and the Contacts page
//              checks it before setting the list)
//   S_QUERY    the search text reaches PostgREST safely: a comma or parenthesis cannot break the filter, two
//              different names give two different filters, and "first last" also matches first and last name
//   C_SOURCE   the card's Calls, Texts and Emails counts are counted from the same touches the Communications
//              section shows (countTouches over useCommunications), never from the old contacts.total_* columns
//   C_PRIVATE  a private mail the viewer may not read (a redacted row) is not counted as one of their emails; it is
//              reported apart, so emails + private equals the email rows in their list
//
//   olderwins     every response counts as the newest, so an older one can win   {S_LATEST}
//   rawquery      the search text goes into the filter uncleaned                  {S_QUERY}
//   oldcounts     the Calls count reads contacts.total_calls again                {C_SOURCE}
//   countprivate  redacted private mail counts as the viewer's email             {C_PRIVATE}
// TAMPER=1 reddens the sum (4).
const fs = require('fs'), path = require('path')
const H = require('../agent/lib/harness.cjs')

const S = 'lib/contacts/search.ts', C = 'lib/comms/counts.ts'
const TAMPERS = {
  olderwins: [[S, '    isLatest: (n: number) => n === seq,', '    isLatest: (n: number) => n > 0,']],
  rawquery: [[S, "  return String(q ?? '').replace(/[,()*%\\\\\"'`]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 80)", "  return String(q ?? '').trim()"]],
  oldcounts: [],
  countprivate: [[C, "else if (t.type === 'email') { if (t.redacted) out.privateEmails++; else out.emails++ }", "else if (t.type === 'email') out.emails++"]],
}
const RED_OF = { olderwins: ['S_LATEST'], rawquery: ['S_QUERY'], oldcounts: ['C_SOURCE'], countprivate: ['C_PRIVATE'] }
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
  const unsafe = (f) => /[(),]/.test(f.replace(/and\(|\)$|\),/g, '').replace(/,(first_name|last_name|email|phone)\.ilike/g, ''))
  check('S_QUERY', f1 && f2 && f1 !== f2 && f1.includes('Erika') && f2.includes('Sharon') && search.contactSearchFilter('  ') === null
    && !/[(),]/.test(search.cleanSearch('Smith, Erika (WNW)')) && !unsafe(comma)
    && full.includes('and(first_name.ilike.*Erika*,last_name.ilike.*Smith*)'), { f1, comma, full })
}

// C_SOURCE
{
  let card = read('src/components/crm/contact-detail.tsx')
  if (active.includes('oldcounts')) card = card.replace("{comms.touches ? commCounts.calls : '-'}", '{(contact as any).total_calls || 0}')
  const noOld = !/total_(calls|texts|emails)/.test(card)
  const shared = card.includes('const comms = useCommunications(contactId)') && card.includes('countTouches(comms.touches ?? [])')
    && card.includes('<CommunicationsHistory state={comms}') && ['commCounts.calls', 'commCounts.texts', 'commCounts.emails'].every((k) => card.includes(k))
  const touches = [{ type: 'call' }, { type: 'call' }, { type: 'text' }, { type: 'email' }, { type: 'meeting' }, { type: 'lifecycle', muted: true }].map((t) => ({ redacted: false, muted: false, ...t }))
  const c = counts.countTouches(touches)
  check('C_SOURCE', noOld && shared && c.calls === 2 && c.texts === 1 && c.emails === 1, { noOld, shared, c })
}

// C_PRIVATE
{
  const list = [{ type: 'email', redacted: true, muted: false }, { type: 'email', redacted: false, muted: false }]
  const nonOwner = counts.countTouches(list)
  const owner = counts.countTouches(list.map((t) => ({ ...t, redacted: false })))
  check('C_PRIVATE', nonOwner.emails === 1 && nonOwner.privateEmails === 1 && owner.emails === 2 && owner.privateEmails === 0, { nonOwner, owner })
}

H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
