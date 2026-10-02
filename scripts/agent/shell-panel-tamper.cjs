#!/usr/bin/env node
// scripts/agent/shell-panel-tamper.cjs   (ruling 26 and its four decisions, 2026-10-02)
//
//   S_MOUNTED       the dashboard layout renders AgentShellProvider around the page, and no longer
//                   renders HelpBot itself (comments stripped)
//   S_SINGLE        nothing but the shell renders <AgentPanel, so there is one panel on every screen
//   S_NAVIGATE      the reducer keeps the answer and the step across anything but reset; reset and
//                   hydrate behave; the step cannot run past the last one
//   S_STORAGE       decision 3: stored per user and org, holding the SERVER's scrubbed question and
//                   never the typed one (a planted email in the typed question must not appear)
//   S_SIGNOUT_CLEAR decision 3: sign-out clears every stored panel state on the tab, for every user
//                   and org, and nothing else
//   S_SIGNOUT_WIRED the sidebar clears BEFORE signOut (the redirect can beat a listener), and the
//                   shell clears on SIGNED_OUT
//   S_CAPS          the real GET: guide only with the flag on and the role allowed, builder only for a
//                   superadmin with agent_enabled
//   S_HELPBOT       decision 1: HelpBot hides only for someone the Guide allows; otherwise it shows,
//                   including while the server has not answered
//   S_LAUNCHER      decision 2: the launcher takes HelpBot's corner (bottom-6 right-6) for them
//   S_BUILDER       decision 4: a superadmin with agent_enabled gets the Builder tab from the shell,
//                   with or without the Guide
//   C_*             controls: each check passes with the code as written
//
//   unmount     the layout renders the page outside the shell        {S_MOUNTED}
//   secondpanel a page mounts its own AgentPanel again                {S_SINGLE}
//   resetkeeps  Start over keeps the old answer                       {S_NAVIGATE}
//   typedq      the Guide keeps the question as typed                 {S_STORAGE}
//   noclear     sign-out clearing removes nothing                     {S_SIGNOUT_CLEAR}
//   nosidebar   the sidebar signs out without clearing                {S_SIGNOUT_WIRED}
//   capsflag    the GET stops checking help_bot_enabled               {S_CAPS}
//   hidealways  HelpBot is hidden for everyone                        {S_HELPBOT}
//   launcherpos the Guide's launcher sits above the corner            {S_LAUNCHER}
//   builderguide the Builder tab needs the Guide too                  {S_BUILDER}
// TAMPER=1 reddens the union (10, equal to the sum).
const fs = require('fs'), path = require('path')
const H = require('./lib/harness.cjs')

const TAMPERS = {
  resetkeeps: [['lib/agent/shell-state.ts', "case 'reset': return { ...INITIAL, open: s.open, mode: s.mode }", "case 'reset': return s"]],
  noclear: [['lib/agent/shell-state.ts', '  for (const k of keys) store.removeItem(k)\n', '']],
  capsflag: [['app/api/marketing/agent/route.ts', 'guide: flags.help_bot_enabled && mayUseGuide(', 'guide: mayUseGuide(']],
  hidealways: [['lib/agent/shell-state.ts', 'export const showHelpBot = (caps: Caps | null) => !caps?.guide', 'export const showHelpBot = (caps: Caps | null) => false']],
  launcherpos: [['lib/agent/shell-state.ts', "caps.guide ? 'corner' : 'stacked'", "caps.guide ? 'stacked' : 'stacked'"]],
  builderguide: [['lib/agent/shell-state.ts', "...(caps?.builder ? ['builder' as const] : [])", "...(caps?.builder && caps?.guide ? ['builder' as const] : [])"]],
  // the static ones are applied to the source text this harness reads, below
  unmount: [], secondpanel: [], typedq: [], nosidebar: [],
}
const STATIC = ['unmount', 'secondpanel', 'typedq', 'nosidebar']
const RED_OF = { unmount: ['S_MOUNTED'], secondpanel: ['S_SINGLE'], resetkeeps: ['S_NAVIGATE'], typedq: ['S_STORAGE'], noclear: ['S_SIGNOUT_CLEAR'],
  nosidebar: ['S_SIGNOUT_WIRED'], capsflag: ['S_CAPS'], hidealways: ['S_HELPBOT'], launcherpos: ['S_LAUNCHER'], builderguide: ['S_BUILDER'] }
const active = H.selectors(TAMPERS)
const out = H.compile(Object.fromEntries(Object.entries(TAMPERS).filter(([k]) => !STATIC.includes(k))), active.filter((t) => !STATIC.includes(t)), 'hub-shell')
const load = H.install(out)
const S = load('lib/agent/shell-state.ts')
const { GET } = load('app/api/marketing/agent/route.ts')

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const src = (rel) => fs.readFileSync(path.join(H.SRC, rel), 'utf8').replace(/\r\n/g, '\n')
const on = (t) => active.includes(t)
const swap = (s, from, to) => { if (!s.includes(from)) { console.error(`dead anchor: ${from.slice(0, 50)}`); process.exit(2) } return s.split(from).join(to) }
const fakeStore = (init = {}) => {
  const m = new Map(Object.entries(init))
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => Array.from(m.keys())[i] ?? null, get length() { return m.size } }
}

;(async () => {
  const rows = []
  const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

  // S_MOUNTED
  let layout = src('app/(dashboard)/layout.tsx')
  if (on('unmount')) layout = swap(swap(layout, '<AgentShellProvider>', '<>'), '</AgentShellProvider>', '</>')
  const L = strip(layout)
  const wrapsPage = /<AgentShellProvider>[\s\S]*<DashboardContent>[\s\S]*<\/AgentShellProvider>/.test(L)
  check('S_MOUNTED', /import\s*\{\s*AgentShellProvider\s*\}\s*from\s*'@\/components\/marketing\/agent\/agent-shell'/.test(L) && wrapsPage && !/<HelpBot\b/.test(L), { wrapsPage })

  // S_SINGLE: every file under src that renders <AgentPanel
  const renders = []
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx$/.test(e.name)) {
    let t = src(path.relative(H.SRC, p)); if (on('secondpanel') && p.endsWith('funnels-panel.tsx')) t += '\nconst X = () => <AgentPanel />\n'
    if (/<AgentPanel\b/.test(strip(t))) renders.push(path.relative(H.SRC, p).replace(/\\/g, '/')) } } }
  walk(H.SRC)
  check('S_SINGLE', JSON.stringify(renders) === JSON.stringify(['components/marketing/agent/agent-shell.tsx']), renders)

  // S_NAVIGATE
  const ans = { found: true, text: 'Do it', cited: ['test-funnel'], steps: [{ article: 'test-funnel', text: 'a', route: '/campaigns', target: null }, { article: 'test-funnel', text: 'b', route: '/crm/settings', target: null }], handoff: false }
  let st = S.reducer(S.INITIAL, { type: 'open', mode: 'guide' })
  st = S.reducer(st, S.answeredAction({ session_id: 'SS', question: 'q', message: 'm', answer: ans }))
  st = S.reducer(st, { type: 'step', to: 1 })
  const kept = S.reducer(st, { type: 'mode', mode: 'guide' })
  const past = S.reducer(st, { type: 'step', to: 9 })
  const reset = S.reducer(st, { type: 'reset' })
  const back = S.reducer(S.INITIAL, { type: 'hydrate', state: S.persistable(st) })
  check('S_NAVIGATE', kept.guide.step === 1 && kept.guide.sessionId === 'SS' && past.guide.step === 1 && reset.guide === null && reset.open === true
    && back.guide.step === 1 && back.open === true, { kept: kept.guide.step, past: past.guide.step, reset: reset.guide, back: back.guide && back.guide.step })

  // S_STORAGE: the typed question carries a planted email; the server returned it scrubbed
  let flow = src('components/marketing/agent/guide-flow.tsx')
  if (on('typedq')) flow = swap(flow, 'dispatch(answeredAction(res))', 'dispatch(answeredAction({ ...res, question: q }))')
  const typed = 'how do I email jane.doe@example.com about her booking'
  const serverRes = { session_id: 'SS', question: 'how do I email [email] about her booking', message: 'm', answer: ans }
  // what guide-flow dispatches, read from its source: the response alone, or the response with the typed question
  const usesTyped = /answeredAction\(\{\s*\.\.\.res,\s*question:\s*q\s*\}\)/.test(strip(flow))
  const action = usesTyped ? S.answeredAction({ ...serverRes, question: typed }) : S.answeredAction(serverRes)
  const store = fakeStore()
  S.saveShell(store, 'U1', 'O1', S.reducer(S.INITIAL, action))
  const raw = store.getItem(S.storageKey('U1', 'O1')) || ''
  check('S_STORAGE', /answeredAction\(res\)/.test(strip(flow)) && !raw.includes('jane.doe') && raw.includes('[email]') && S.storageKey('U1', 'O1') !== S.storageKey('U1', 'O2')
    && S.storageKey('U1', 'O1') !== S.storageKey('U2', 'O1'), raw.slice(0, 160))

  // S_SIGNOUT_CLEAR
  const st2 = fakeStore({ 'hub-agent-shell:U1:O1': '{}', 'hub-agent-shell:U1:O2': '{}', 'hub-agent-shell:U2:O1': '{}', 'other-app:keep': 'x' })
  const removed = S.clearShellStorage(st2)
  check('S_SIGNOUT_CLEAR', st2.length === 1 && st2.getItem('other-app:keep') === 'x' && removed === 3, { left: Array.from(st2.m.keys()), removed })

  // S_SIGNOUT_WIRED
  let side = src('components/sidebar.tsx')
  if (on('nosidebar')) side = swap(side, 'try { clearShellStorage(window.sessionStorage) }', 'try { void 0 }')
  const sideCode = strip(side)
  const fnBody = (sideCode.match(/const handleSignOut = async \(\) => \{[\s\S]*?\n {2}\}/) || [''])[0]
  const clearAt = fnBody.indexOf('clearShellStorage('), outAt = fnBody.indexOf('auth.signOut(')
  const shellSrc = strip(src('components/marketing/agent/agent-shell.tsx'))
  check('S_SIGNOUT_WIRED', clearAt > -1 && outAt > clearAt && /event === 'SIGNED_OUT'[\s\S]{0,120}clearShellStorage\(/.test(shellSrc), { clearAt, outAt })

  // S_CAPS: the real GET
  const caps = async ({ flags = {}, roles, team = 'admin', superadmin = false }) => {
    const settings = [{ org_id: 'O1', setting_key: 'hub_marketing_flags', setting_value: flags }]
    if (roles) settings.push({ org_id: 'O1', setting_key: 'hub_agent_policy', setting_value: { help_roles: roles } })
    const db = H.stubDb({ org_settings: settings })
    global.__ctx = { userId: 'U1', orgIds: ['O1'], orgRoles: { O1: team }, isSuperadmin: superadmin, db }
    return (await GET({ url: 'https://hub.test/api/marketing/agent?org_id=O1' }, { params: {} })).body
  }
  const off = await caps({ flags: {}, superadmin: true })
  const notRole = await caps({ flags: { help_bot_enabled: 'on' }, roles: ['superadmin'], team: 'admin' })
  const allowed = await caps({ flags: { help_bot_enabled: 'on' }, roles: ['superadmin', 'admin'], team: 'admin' })
  const notSuper = await caps({ flags: { agent_enabled: 'on', help_bot_enabled: 'on' }, roles: ['admin'], team: 'admin' })
  const sup = await caps({ flags: { agent_enabled: 'on' }, superadmin: true })
  check('S_CAPS', off.guide === false && off.builder === false && notRole.guide === false && notSuper.builder === false && sup.guide === false, { off, notRole, notSuper, sup })
  check('C_CAPS_ALLOWED', allowed.guide === true && sup.builder === true, { allowed, sup })

  // S_HELPBOT (decision 1)
  check('S_HELPBOT', S.showHelpBot(null) === true && S.showHelpBot({ guide: false, builder: false }) === true && S.showHelpBot({ guide: false, builder: true }) === true
    && S.showHelpBot({ guide: true, builder: false }) === false && /\{showHelpBot\(caps\) && <HelpBot \/>\}/.test(shellSrc), null)

  // S_LAUNCHER (decision 2): HelpBot's own corner, read from help-bot.tsx
  const corner = /fixed bottom-6 right-6/.test(src('components/help-bot.tsx'))
  check('S_LAUNCHER', corner && S.launcherPlacement({ guide: true, builder: false }) === 'corner' && S.launcherPlacement({ guide: true, builder: true }) === 'corner'
    && S.launcherPlacement({ guide: false, builder: true }) === 'stacked' && S.launcherPlacement({ guide: false, builder: false }) === 'none'
    && /place === 'corner' \? 'bottom-6' : 'bottom-24'/.test(shellSrc) && /fixed right-6/.test(shellSrc), null)

  // S_BUILDER (decision 4): from the shell, on every screen, with or without the Guide
  check('S_BUILDER', JSON.stringify(S.panelModes({ guide: false, builder: true })) === JSON.stringify(['builder'])
    && JSON.stringify(S.panelModes({ guide: true, builder: true })) === JSON.stringify(['guide', 'builder']) && JSON.stringify(S.panelModes(null)) === '[]'
    && /modes=\{modes\}/.test(shellSrc), null)

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})().catch((e) => { console.error(e); process.exit(2) })
