#!/usr/bin/env node
// scripts/agent/org-keys-tamper.cjs   (2026-10-02: references across organizations are refused)
//
// The real campaign save route and the real legacy enroll route run against an in-memory database
// that applies the filters each query sends. The caller is staff of org OA only. For the enroll
// route, which reads as the caller, the database is seen through what RLS would show that caller:
// OA's sequences and contacts only (the sequences and contacts policies; the sequence_enrollments
// policy is the defective one, so it is deliberately NOT modelled as a protection).
//   O_SEQUENCE        the campaign route refuses a sequence_id from org OB with 403, writing nothing
//   O_SIBLINGS        the same for the other four keys it writes: entry pipeline, entry stage, goal
//                     stage and planning campaign
//   O_ENROLL_SEQ      the enroll route refuses OB's sequence with 403 and writes no enrollment
//   O_ENROLL_CONTACT  the enroll route refuses OA's sequence with OB's contact, or with a contact id
//                     that is not anyone's, with 403 and no enrollment; including for a viewer (a
//                     superadmin) whom the contacts policy lets SEE OB's contact
//   C_OWN             control: OA's own ids save (200) and enroll (an enrollment row appears)
//
//   lookuporg   the campaign lookup stops filtering on org         {O_SEQUENCE,O_SIBLINGS}
//   status400   a cross-org id is answered 400, not 403             {O_SEQUENCE,O_SIBLINGS}
//   enrollseq   the enroll route takes the org from the contact     {O_ENROLL_SEQ,O_ENROLL_CONTACT}
//   enrollwho   the enroll route stops checking the contact         {O_ENROLL_CONTACT}
// TAMPER=1 reddens the union (4). lookuporg and status400 share both campaign cases, and enrollseq
// and enrollwho share O_ENROLL_CONTACT; each pushes its shared case red, so none can cancel.
const fs = require('fs')
const H = require('./lib/harness.cjs')

const TAMPERS = {
  lookuporg: [['lib/marketing/validate/campaign.ts', ".select('id').eq('id', id).eq('org_id', org).maybeSingle()", ".select('id').eq('id', id).maybeSingle()"]],
  status400: [['app/api/marketing/campaigns/route.ts', 'return check.notInOrg ? forbidden(check.message) : bad(check.message)', 'return bad(check.message)']],
  // the org must come from the SEQUENCE; taking it from the contact means the sequence is never checked
  enrollseq: [['app/api/sequences/enroll/route.ts', 'const sequenceOrg = seqOrg?.org_id;', 'const sequenceOrg = who?.org_id;']],
  enrollwho: [['app/api/sequences/enroll/route.ts', 'if (!who || who.org_id !== sequenceOrg) return', 'if (false) return']],
}
const RED_OF = { lookuporg: ['O_SEQUENCE', 'O_SIBLINGS'], status400: ['O_SEQUENCE', 'O_SIBLINGS'], enrollseq: ['O_ENROLL_SEQ', 'O_ENROLL_CONTACT'], enrollwho: ['O_ENROLL_CONTACT'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-orgkeys')
const supa = { createServerSupabase: () => global.__userDb, createAdminSupabase: () => global.__userDb }
const load = H.install(out, { '@/lib/supabase': supa, '@/lib/twilio': { sendSms: async () => ({}) } })
const { POST: CAMPAIGNS } = load('app/api/marketing/campaigns/route.ts')
const { POST: ENROLL } = load('app/api/sequences/enroll/route.ts')

const fresh = () => ({
  pipelines: [{ id: 'PA', org_id: 'OA' }, { id: 'PB', org_id: 'OB' }],
  pipeline_stages: [{ id: 'SA', org_id: 'OA', pipeline_id: 'PA' }, { id: 'SB', org_id: 'OB', pipeline_id: 'PB' }],
  sequences: [{ id: 'QA', org_id: 'OA' }, { id: 'QB', org_id: 'OB' }],
  campaigns: [{ id: 'KA', org_id: 'OA' }, { id: 'KB', org_id: 'OB' }],
  contacts: [{ id: 'CA', org_id: 'OA' }, { id: 'CB', org_id: 'OB' }],
  funnel_campaigns: [{ id: 'F', org_id: 'OA', name: 'F', status: 'draft', sequence_id: null }],
  sequence_steps: [], sequence_enrollments: [], university_assets: [],
})
// what RLS would show an OA member: sequences and contacts of OA only; everything else as stored
const VISIBLE = { sequences: (r) => r.org_id === 'OA', contacts: (r) => r.org_id === 'OA' }
// a superadmin's view: the contacts policy admits every org's contacts, sequences stay membership-scoped
const WIDE = { sequences: (r) => r.org_id === 'OA', contacts: () => true }
function memDb(D, asUser) {
  let n = 0
  const match = (row, ops) => ops.every(([m, a]) => m === 'eq' ? row[a[0]] === a[1] : m === 'is' ? (row[a[0]] ?? null) === a[1]
    : m === 'in' ? a[1].includes(row[a[0]]) : m === 'not' ? (row[a[0]] ?? null) !== a[2] : true)
  const db = H.stubDb({}, {
    rpc: () => ({ data: null, error: null }),
    table: (table, ops, mode) => {
      const all = D[table] || (D[table] = [])
      const vis = asUser === 'wide' ? WIDE : VISIBLE
      const rows = asUser && vis[table] ? all.filter(vis[table]) : all
      const ins = ops.find((o) => o[0] === 'insert'), up = ops.find((o) => o[0] === 'update')
      if (ins) { const r = { id: `${table}-new-${++n}`, ...ins[1][0] }; all.push(r); return mode === 'many' ? { data: [{ ...r }], error: null } : { data: { ...r }, error: null } }
      const hit = rows.filter((r) => match(r, ops))
      if (up) { for (const r of hit) Object.assign(r, up[1][0]); return { data: hit.map((r) => ({ ...r })), error: null } }
      return mode === 'many' ? { data: hit.map((r) => ({ ...r })), error: null } : { data: hit[0] ? { ...hit[0] } : null, error: null }
    },
  })
  db.auth = { getUser: async () => ({ data: { user: { id: 'U' } } }) }
  return db
}
const post = (fn, body) => fn({ json: async () => body }, { params: {} })
const save = async (patch) => {
  const D = fresh(); const db = memDb(D, false)
  global.__ctx = { userId: 'U', orgIds: ['OA'], orgRoles: { OA: 'admin' }, isSuperadmin: false, db }
  const before = JSON.stringify(D)
  const r = await post(CAMPAIGNS, { org_id: 'OA', id: 'F', name: 'F', status: 'draft', ...patch })
  return { status: r.status, unchanged: JSON.stringify(D) === before }
}
const enroll = async (sequence_id, contact_id, view = true) => {
  const D = fresh(); global.__userDb = memDb(D, view)
  const r = await ENROLL({ json: async () => ({ sequence_id, contact_id }) })
  return { status: r.status, enrolled: D.sequence_enrollments.length }
}

;(async () => {
  const rows = []
  const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

  const seq = await save({ sequence_id: 'QB' })
  check('O_SEQUENCE', seq.status === 403 && seq.unchanged, seq)
  const sib = []
  for (const p of [{ entry_pipeline_id: 'PB' }, { entry_pipeline_id: 'PA', entry_stage_id: 'SB' }, { goal_stage_id: 'SB' }, { planning_campaign_id: 'KB' }]) sib.push(await save(p))
  check('O_SIBLINGS', sib.every((s) => s.status === 403 && s.unchanged), sib)

  const es = await enroll('QB', 'CA')
  check('O_ENROLL_SEQ', es.status === 403 && es.enrolled === 0, es)
  const ec = [await enroll('QA', 'CB'), await enroll('QA', 'not-a-contact'), await enroll('QA', 'CB', 'wide')]
  check('O_ENROLL_CONTACT', ec.every((e) => e.status === 403 && e.enrolled === 0), ec)

  const own = await save({ sequence_id: 'QA', entry_pipeline_id: 'PA', entry_stage_id: 'SA', goal_stage_id: 'SA', planning_campaign_id: 'KA' })
  const ownEnroll = await enroll('QA', 'CA')
  check('C_OWN', own.status === 200 && ownEnroll.status === 200 && ownEnroll.enrolled === 1, { own, ownEnroll })

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})().catch((e) => { console.error(e); process.exit(2) })
