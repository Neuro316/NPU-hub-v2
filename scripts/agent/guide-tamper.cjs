#!/usr/bin/env node
// scripts/agent/guide-tamper.cjs   (test k: the Hub Guide, rulings 15 to 21)
//
// The real Guide loop runs against a stub database and a scripted model; the real route runs
// for its gates; the real "Show me" runs against a stub document.
//   G_FLAG_OFF     the route refuses `ask` while help_bot_enabled is off, before any model call
//   G_ROLE         a team member is refused while help_roles holds only superadmin
//   G_CITE         an answer citing an article search did not return is refused, then retried
//   G_TARGET       a step pointing at a control of a different article is refused
//   G_ROUTE        a step naming a page that does not exist is refused
//   G_GAP          no fitting article: a help_gaps row with the question scrubbed, no steps,
//                  and any general pointer labelled as not from the help articles
//   G_READONLY     a Guide question writes only its own run log and help_gaps
//   G_CONTEXT      a route or screen id not in the registry is dropped, never sent or stored
//   G_EMDASH       an em dash in an answer never reaches the person
//   G_CAP          the spend is reserved under mode guide, and a refused reservation stops it
//   G_SHOWME       Show me outlines a known control, refuses unknown ids, and never clicks
//   C_ANSWERS      control: a valid answer is shown, with its citations and steps intact
//   C_ROUTE_ALIVE  control: flag on and allowed, the same route reaches the model
//
//   nocite     the retrieved-articles check is removed          {G_CITE}
//   anytarget  the target-belongs-to-article check is removed   {G_TARGET}
//   anyroute   the route-exists check is removed                {G_ROUTE}
//   noflag     the route stops checking help_bot_enabled        {G_FLAG_OFF}
//   nogap      no help_gaps row is written                      {G_GAP}
//   leakctx    any route is passed through unchecked            {G_CONTEXT}
//   dash       em dashes are kept                               {G_EMDASH}
//   writetask  a Guide question also writes a task              {G_READONLY}
//   clickme    Show me clicks the control                       {G_SHOWME}
// TAMPER=1 reddens the union (9).
const fs = require('fs')
const H = require('./lib/harness.cjs')

const DASH = String.fromCharCode(0x2014)
const TAMPERS = {
  nocite: [['lib/agent/help/walkthrough.ts', "  for (const id of cited) if (!retrieved.has(id)) return", "  for (const id of cited) if (false) return"]],
  anytarget: [['lib/agent/help/walkthrough.ts', "if (target && (!reg.help_ids.includes(target) || !art.help_ids.includes(target))) {", 'if (false) {']],
  anyroute: [['lib/agent/help/walkthrough.ts', 'if (route && !reg.routes.includes(route)) return', 'if (false) return']],
  noflag: [['app/api/marketing/agent/route.ts', "    if (!flags.help_bot_enabled) return forbidden('The Hub Guide is switched off for this organization.')\n", '']],
  nogap: [['lib/agent/guide.ts', "await i.db.from('help_gaps').insert(", "await ({ error: null } as any) ?? i.db.from('help_gaps').insert("]],
  leakctx: [['lib/agent/guide.ts', 'const route = i.route && REGISTRY.routes.includes(i.route) ? i.route : null', 'const route = i.route']],
  dash: [
    ['lib/agent/help/walkthrough.ts', "const text = typeof raw.text === 'string' ? raw.text.trim().replace(EM_DASH, ', ') : ''", "const text = typeof raw.text === 'string' ? raw.text.trim() : ''"],
  ],
  writetask: [['lib/agent/guide.ts', '    if (gErr) console.error(', "    await i.db.from('tasks').insert({ title: 'from the Guide' }); if (gErr) console.error("]],
  clickme: [['lib/agent/help/show-me.ts', "  el.setAttribute(HIGHLIGHT_ATTR, 'on')", "  el.setAttribute(HIGHLIGHT_ATTR, 'on'); (el as any).click?.()"]],
}
const RED_OF = { nocite: ['G_CITE'], anytarget: ['G_TARGET'], anyroute: ['G_ROUTE'], noflag: ['G_FLAG_OFF'], nogap: ['G_GAP'],
  leakctx: ['G_CONTEXT'], dash: ['G_EMDASH'], writetask: ['G_READONLY'], clickme: ['G_SHOWME'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-guide')
const load = H.install(out)
const { runGuide } = load('lib/agent/guide.ts')
const { checkAnswer, REGISTRY } = load('lib/agent/help/walkthrough.ts')
const { articles } = load('lib/agent/help/corpus.ts')
const { showMe } = load('lib/agent/help/show-me.ts')
const { DEFAULT_POLICY } = load('lib/agent/config.ts')
const { POST } = load('app/api/marketing/agent/route.ts')

const usage = { input_tokens: 900, output_tokens: 120 }
const search = (q) => ({ model: 'claude-haiku-4-5', stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: `s${Math.random()}`, name: 'search_help', input: { query: q } }] })
const answer = (input) => ({ model: 'claude-haiku-4-5', stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: `a${Math.random()}`, name: 'answer', input }] })
const scripted = (replies) => {
  const sent = []
  return { sent, create: async (req) => { sent.push(JSON.stringify(req)); const r = replies.shift(); if (!r) throw new Error('script ran out'); return r } }
}
const reserveOk = { rpc: (n) => (n === 'agent_reserve' ? { data: { ok: true, month: '2026-10-01' }, error: null } : { data: null, error: null }) }
const guide = async (client, over = {}, dbHandlers = reserveOk) => {
  const db = H.stubDb({}, dbHandlers)
  const res = await runGuide({ db, client, org: 'O1', userId: 'U1', sessionId: 'S1', policy: { ...DEFAULT_POLICY }, question: 'How do I test a campaign?',
    route: '/campaigns', helpId: 'campaigns', ...over })
  return { res, db }
}
const writes = (db) => db.calls.filter((c) => c.table && c.ops.some((o) => ['insert', 'update', 'upsert', 'delete'].includes(o[0])))
const STEP = { article: 'test-funnel', text: 'Open the campaign and press Test drive.', route: '/campaigns', target: 'funnel.test-drive' }
const GOOD = { found: true, text: 'Use a test drive on the campaign page.', cited: ['test-funnel'], steps: [STEP], handoff: false }

;(async () => {
  const rows = []
  const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

  // control: a valid answer is shown as given
  {
    const c = scripted([search('test a campaign'), answer(GOOD)])
    const { res } = await guide(c)
    check('C_ANSWERS', res.outcome === 'answered' && res.answer.cited.join() === 'test-funnel' && res.answer.steps[0].target === 'funnel.test-drive', res)
  }
  // a citation of an article never retrieved is refused, and the corrected answer is shown
  {
    const c = scripted([search('test a campaign'), answer({ ...GOOD, cited: ['forms'], steps: [] }), answer(GOOD)])
    const { res, db } = await guide(c)
    const log = JSON.stringify(db.calls.find((x) => x.table === 'agent_runs' && x.ops[0][0] === 'update')?.ops[0][1][0].tool_calls)
    check('G_CITE', res.outcome === 'answered' && res.answer.cited.join() === 'test-funnel' && /did not return/.test(log), { outcome: res.outcome, log })
  }
  // structural checks straight on the validator, against the real corpus and registry
  const byId = new Map(articles().map((a) => [a.id, a]))
  const retrieved = new Map([['test-funnel', byId.get('test-funnel')], ['forms', byId.get('forms')]])
  {
    const wrongArticle = checkAnswer({ ...GOOD, steps: [{ ...STEP, target: 'forms.new' }] }, retrieved)
    const unknown = checkAnswer({ ...GOOD, steps: [{ ...STEP, target: 'nowhere.button' }] }, retrieved)
    // the valid answer must pass the same validator, or the refusals above prove nothing
    const valid = checkAnswer(GOOD, retrieved)
    check('G_TARGET', valid.ok && !wrongArticle.ok && !unknown.ok, { valid, wrongArticle, unknown })
    const badRoute = checkAnswer({ ...GOOD, steps: [{ ...STEP, route: '/settings/secret-page' }] }, retrieved)
    check('G_ROUTE', valid.ok && !badRoute.ok && REGISTRY.routes.includes('/campaigns'), badRoute)
  }
  // no fitting article
  {
    const c = scripted([search('payroll export'), answer({ found: false, text: 'Payroll is not part of the Hub. Ask your administrator.', cited: [], steps: [], handoff: false })])
    const { res, db } = await guide(c, { question: 'How do I export payroll for jane.doe@example.com, 828-555-0199?' })
    const gap = db.calls.find((x) => x.table === 'help_gaps')
    const q = gap ? gap.ops[0][1][0].question : ''
    check('G_GAP', res.outcome === 'no_answer' && res.answer.steps.length === 0 && res.message.startsWith('This is not from the Hub help articles: ')
      && gap && q.includes('[email]') && q.includes('[phone]') && !q.includes('jane.doe') && !q.includes('555-0199'), { outcome: res.outcome, message: res.message, q })
    const tables = [...new Set(writes(db).map((x) => x.table))].sort()
    check('G_READONLY', tables.includes('agent_runs') && tables.every((t) => t === 'agent_runs' || t === 'help_gaps'), tables)
  }
  // context without data: an unknown route and screen are neither sent nor stored
  {
    const c = scripted([search('test a campaign'), answer(GOOD)])
    const { res, db } = await guide(c, { route: '/contacts/9a1f?name=Jane%20Doe', helpId: 'contact.jane-doe' })
    const run = db.calls.find((x) => x.table === 'agent_runs' && x.ops[0][0] === 'insert').ops[0][1][0]
    check('G_CONTEXT', res.outcome === 'answered' && run.route === null && run.help_id === null && !c.sent.join('').includes('Jane'), { route: run.route, help_id: run.help_id })
  }
  // em dashes never reach the person
  {
    const c = scripted([search('test a campaign'), answer({ ...GOOD, text: `Open the campaign ${DASH} then test it.`, steps: [{ ...STEP, text: `Press Test drive ${DASH} wait five minutes.` }] })])
    const { res } = await guide(c)
    check('G_EMDASH', res.outcome === 'answered' && !JSON.stringify(res).includes(DASH), res.message)
  }
  // the reservation is under the guide mode, and a refusal stops before the model
  {
    const c = scripted([search('test a campaign'), answer(GOOD)])
    const { db } = await guide(c)
    const modes = db.calls.filter((x) => x.rpc === 'agent_reserve').map((x) => x.args.p_mode)
    const capped = scripted([search('x')])
    const { res: r2 } = await guide(capped, {}, { rpc: (n) => (n === 'agent_reserve' ? { data: { ok: false }, error: null } : { data: null, error: null }) })
    check('G_CAP', modes.length > 0 && modes.every((m) => m === 'guide') && r2.outcome === 'cap_hit' && capped.sent.length === 0, { modes, capped: r2.outcome })
  }
  // Show me: outline only
  {
    const actions = []
    const el = { scrollIntoView: () => actions.push('scroll'), setAttribute: (k) => actions.push(`set:${k}`), removeAttribute: () => {}, click: () => actions.push('CLICK') }
    const doc = { querySelector: (s) => (s === '[data-help-id="funnel.test-drive"]' ? el : null) }
    const ok = showMe(doc, 'funnel.test-drive', REGISTRY.help_ids, 1)
    const unknown = showMe(doc, 'evil"]script', REGISTRY.help_ids, 1)
    const away = showMe(doc, 'forms.new', REGISTRY.help_ids, 1)
    check('G_SHOWME', ok.ok && !actions.includes('CLICK') && actions.includes('set:data-help-highlight') && !unknown.ok && unknown.reason === 'unknown_target'
      && !away.ok && away.reason === 'not_on_this_page', { actions, unknown, away })
  }
  // the route's gates
  const callRoute = async ({ flagOn, roles, team, superadmin }) => {
    const settings = []
    if (flagOn) settings.push({ org_id: 'O1', setting_key: 'hub_marketing_flags', setting_value: { help_bot_enabled: 'on' } })
    if (roles) settings.push({ org_id: 'O1', setting_key: 'hub_agent_policy', setting_value: { help_roles: roles } })
    const db = H.stubDb({ org_settings: settings }, reserveOk)
    global.__ctx = { userId: 'U1', orgIds: ['O1'], orgRoles: { O1: team }, isSuperadmin: superadmin, db }
    const res = await POST({ json: async () => ({ action: 'ask', org_id: 'O1', question: 'How do I test a campaign?', route: '/campaigns' }) }, { params: {} })
    return { status: res.status, db, touched: db.calls.some((x) => x.rpc === 'agent_reserve' || x.table === 'agent_runs') }
  }
  {
    const off = await callRoute({ flagOn: false, team: 'super_admin', superadmin: true })
    check('G_FLAG_OFF', off.status === 403 && !off.touched, off.status)
    const member = await callRoute({ flagOn: true, roles: ['superadmin'], team: 'team_member', superadmin: false })
    const memberAllowed = await callRoute({ flagOn: true, roles: ['superadmin', 'team_member'], team: 'team_member', superadmin: false })
    check('G_ROLE', member.status === 403 && !member.touched && memberAllowed.touched, { member: member.status, allowed: memberAllowed.status })
    const alive = await callRoute({ flagOn: true, team: 'super_admin', superadmin: true })
    check('C_ROUTE_ALIVE', alive.touched, alive.status)
  }

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})().catch((e) => { console.error(e); process.exit(2) })
