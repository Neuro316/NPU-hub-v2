#!/usr/bin/env node
// scripts/agent/leak-tamper.cjs   (test f, ruling 2: no contact data reaches the model)
//
// The read tools run against a stub database whose every row also carries contact-level
// fields full of fixture values (a name, an email, a phone, a message body), and the phone
// lines setting holds a real-looking number. Nothing of that may reach what the model sees.
// Also: every read names its columns, no read touches a contact-bearing table, and a
// person's typed request is scrubbed of emails and phone numbers before it is sent.
//
//   star        a read selects every column                  {L_SELECTS}
//   passthrough raw form consent objects reach the model       {L_OUTPUT}
//   noscrub     the request is sent unscrubbed               {L_PROMPT_SCRUB}
// TAMPER=1 reddens the union (3).
const fs = require('fs'), path = require('path')
const H = require('./lib/harness.cjs')

const TAMPERS = {
  star: [['lib/agent/tools/read.ts', "  pipelines: 'id, name',", "  pipelines: '*',"]],
  passthrough: [
    ['lib/agent/tools/read.ts', 'consents: Array.isArray(x.consents) ? x.consents.map((c: any) => ({ channel: String(c?.channel), kind: String(c?.kind) })) : [] })),', 'consents: x.consents })),'],
    ['lib/agent/tools/read.ts', 'consent_boxes: x.consents.map((c) => `${c.channel} ${c.kind}`) })),', 'consent_boxes: x.consents })),'],
  ],
  noscrub: [['lib/agent/untrusted.ts', "  return String(text ?? '')\n    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi, '[email]')\n    .replace(/(\\+?\\d[\\d\\s().-]{7,}\\d)/g, '[phone]')", "  return String(text ?? '')"]],
}
const RED_OF = { star: ['L_SELECTS'], passthrough: ['L_OUTPUT'], noscrub: ['L_PROMPT_SCRUB'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-leak')
const load = H.install(out)
const { readHubSetup, setupForModel, READ_COLUMNS } = load('lib/agent/tools/read.ts')
const { runBuilder } = load('lib/agent/loop.ts')
const { DEFAULT_POLICY } = load('lib/agent/config.ts')

const PII = { first_name: 'Patricia', last_name: 'Quill', email: 'pat.quill@example.com', phone: '+18285550123', body: 'Private message body 7731' }
const VALUES = Object.values(PII)
const withPii = (r) => ({ ...r, ...PII, contact: { ...PII } })
const DATA = {
  pipelines: [withPii({ id: 'P1', org_id: 'O1', name: 'Leads', archived_at: null })],
  pipeline_stages: [withPii({ id: 's1', org_id: 'O1', pipeline_id: 'P1', name: 'New lead', position: 0, archived_at: null })],
  university_assets: [withPii({ id: 'A1', org_id: 'O1', title: 'Guide', description: 'd', active: true })],
  form_definitions: [withPii({ id: 'F1', org_id: 'O1', slug: 'f', name: 'F', status: 'published', source_key: 'form:f', consents: [{ channel: 'email', kind: 'marketing', text: 'Yes', ...PII }] })],
  page_definitions: [withPii({ slug: 'p', org_id: 'O1' })],
  org_settings: [{ org_id: 'O1', setting_key: 'crm_twilio', setting_value: { numbers: [{ number: PII.phone, owner: PII.email }] } }],
}
// the stub honours only the columns each read names, as PostgREST would
const project = (row, cols) => (cols === '*' ? row : Object.fromEntries(cols.split(',').map((c) => c.trim()).map((c) => [c, row[c]])))
const handlers = {
  rpc: (name) => (name === 'entry_source_status' ? { data: { queue: true, stage: true, tag: true }, error: null }
    : name === 'hub_send_policy' ? { data: { from_address: 'x@y.z', from_domain: 'y.z' }, error: null } : { data: null, error: null }),
  table: (table, ops, mode) => {
    if (ops.some((o) => ['insert', 'update'].includes(o[0]))) return undefined
    const sel = ops.find((o) => o[0] === 'select')
    let rows = (DATA[table] || []).filter((r) => ops.every((o) => o[0] !== 'eq' || r[o[1][0]] === o[1][1]))
    rows = rows.map((r) => project(r, sel ? sel[1][0] : '*'))
    return mode === 'maybeSingle' ? { data: rows[0] || null, error: null } : { data: rows, error: null }
  },
}

;(async () => {
  const rows = []
  const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
  const FORBIDDEN = ['contacts', 'consent_events', 'suppressions', 'message_sends', 'send_log', 'campaign_enrollments', 'form_submissions',
    'campaign_test_contacts', 'tasks', 'kanban_tasks', 'contact_timeline', 'crm_messages', 'conversations', 'call_logs', 'profiles', 'do_not_contact_list']

  const db = H.stubDb({}, handlers)
  const setup = await readHubSetup(db, 'O1')
  const seen = JSON.stringify(setupForModel(setup))

  check('L_COLUMNS', Object.keys(READ_COLUMNS).every((t) => !FORBIDDEN.includes(t)), Object.keys(READ_COLUMNS))
  const reads = db.calls.filter((c) => c.table)
  check('L_SELECTS', reads.every((c) => { const s = c.ops.find((o) => o[0] === 'select'); return s && s[1][0] !== '*' && (READ_COLUMNS[c.table] === s[1][0] || (c.table === 'org_settings' && s[1][0] === 'setting_value')) })
    && reads.every((c) => !FORBIDDEN.includes(c.table)), reads.map((c) => [c.table, (c.ops.find((o) => o[0] === 'select') || [])[1]]))
    const keys = new Set()
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x) } }
  walk(setupForModel(setup))
  const piiKeys = [...keys].filter((k) => Object.keys(PII).includes(k) || k === 'contact')
  check('L_OUTPUT', VALUES.every((v) => !seen.includes(v)) && piiKeys.length === 0, { values: VALUES.filter((v) => seen.includes(v)), piiKeys })

  // static: no agent module reads a contact-bearing table (comments stripped first)
  const dir = path.join(H.SRC, 'lib', 'agent')
  const files = []
  const walkDir = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkDir(p); else if (/\.ts$/.test(e.name) && !p.includes('generated')) files.push(p) } }
  walkDir(dir); files.push(path.join(H.SRC, 'app', 'api', 'marketing', 'agent', 'route.ts'))
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const hits = files.flatMap((f) => FORBIDDEN.filter((t) => new RegExp(`from\\(['"]${t}['"]\\)`).test(strip(fs.readFileSync(f, 'utf8')))).map((t) => `${path.basename(f)}:${t}`))
  check('L_STATIC', hits.length === 0, hits)
  // control: the same scan finds a planted read
  check('C_STATIC_FINDS', FORBIDDEN.filter((t) => new RegExp(`from\\(['"]${t}['"]\\)`).test(strip("db.from('contacts').select('id')"))).length === 1, null)

  // a typed request carrying contact details is scrubbed before the model sees it; a clean setup,
  // so this check is about the request alone
  const CLEAN_SETUP = { pipelines: [], stages: [], sources: [], status: {}, assets: [], forms: [], sender_ready: true, page_slugs: [] }
  let sent = ''
  const client = { create: async (req) => { sent = JSON.stringify(req.messages); return { model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } } } }
  const runDb = H.stubDb({}, { rpc: (n) => (n === 'agent_reserve' ? { data: { ok: true, month: 'm' }, error: null } : { data: null, error: null }) })
  await runBuilder({ db: runDb, client, org: 'O1', userId: 'U1', sessionId: 'S', policy: { ...DEFAULT_POLICY }, setup: CLEAN_SETUP, prompt: `Email ${PII.email} or call ${PII.phone} about the guide.` })
  check('L_PROMPT_SCRUB', sent.includes('[email]') && sent.includes('[phone]') && !sent.includes(PII.email) && !sent.includes(PII.phone), sent.slice(0, 200))

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})().catch((e) => { console.error(e); process.exit(2) })
