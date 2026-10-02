#!/usr/bin/env node
// scripts/agent/golden-goals.cjs   (test a, and the Phase 2 readiness tasks)
//
// Five fixed goals run through the REAL Campaign Builder loop (src/lib/agent/loop.ts) with a
// stub model that returns recorded tool calls, against a stub database holding one small
// org. Asserts the structure each produces: the campaign and its ids, the steps, the entry
// sources, and the follow-up tasks. No network, no database.
//
// TAMPER=<selector> plants one defect; the run must redden exactly the declared set:
//   noresolve     pipeline names must match case exactly           {G1_STRUCT}
//   connectedany  a not-connected source is accepted as a route    {G2_STRUCT,G2_START}
//   nosms         no SMS registration task                         {G2_TASKS}
//   nosender      no sending address task                          {G1_TASKS}
//   noconsent     no marketing consent task                        {G3_TASKS}
//   noclaims      drafted copy skips the claims check              {G5_STRUCT,G5_TASKS}
// TAMPER=1 reddens the union (8, equal to the sum: the selectors are disjoint).
const H = require('./lib/harness.cjs')

const TAMPERS = {
  noresolve: [['lib/agent/tools/draft.ts', 'norm(x.name) === norm(input.entry_pipeline)', 'x.name === input.entry_pipeline']],
  connectedany: [['lib/agent/tools/draft.ts', '} else if (!sourceIsConnected(key, setup.status)) {', '} else if (false) {']],
  nosms: [['lib/agent/readiness.ts', "if (messages.some((s) => s.channel === 'sms')) {", 'if (false) {']],
  nosender: [['lib/agent/readiness.ts', "if (messages.some((s) => s.channel === 'email') && !setup.sender_ready) {", 'if (false) {']],
  noconsent: [['lib/agent/readiness.ts', '    if (!asks) {', '    if (false) {']],
  noclaims: [['lib/agent/tools/draft.ts', 'if (!c.ok) plan.review.push(', 'if (false) plan.review.push(']],
}
const RED_OF = { noresolve: ['G1_STRUCT'], connectedany: ['G2_STRUCT', 'G2_START'], nosms: ['G2_TASKS'], nosender: ['G1_TASKS'], noconsent: ['G3_TASKS'], noclaims: ['G5_STRUCT', 'G5_TASKS'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-golden')
const load = H.install(out)
const { runBuilder } = load('lib/agent/loop.ts')
const { readHubSetup } = load('lib/agent/tools/read.ts')
const { DEFAULT_POLICY } = load('lib/agent/config.ts')

const DATA = {
  pipelines: [{ id: 'P1', org_id: 'O1', name: 'Leads', archived_at: null, position: 0 }],
  pipeline_stages: [
    { id: 's1', org_id: 'O1', pipeline_id: 'P1', name: 'New lead', position: 0, archived_at: null },
    { id: 's2', org_id: 'O1', pipeline_id: 'P1', name: 'Booked a call', position: 1, archived_at: null },
    { id: 's3', org_id: 'O1', pipeline_id: 'P1', name: 'Enrolled', position: 2, archived_at: null }],
  university_assets: [{ id: 'A1', org_id: 'O1', title: 'HRV Guide', description: 'A short guide', active: true }],
  form_definitions: [{ id: 'F1', org_id: 'O1', slug: 'hrv-guide', name: 'HRV guide request', status: 'published', source_key: 'form:hrv-guide',
    consents: [{ id: 'c1', channel: 'email', kind: 'marketing', text: 'Yes, email me.' }] }],
  page_definitions: [],
  org_settings: [{ org_id: 'O1', setting_key: 'crm_twilio', setting_value: { numbers: [{ number: '+18285550199' }] } }],
}
const rpc = (name) => {
  if (name === 'entry_source_status') return { data: { queue: true, stage: true, tag: true }, error: null }
  if (name === 'agent_reserve') return { data: { ok: true, month: '2026-10' }, error: null }
  if (name === 'hub_send_policy') return { data: { from_address: 'Neuro Progeny <hello@sender-not-set.neuroprogeny.com>', from_domain: 'sender-not-set.neuroprogeny.com' }, error: null }
  return { data: null, error: null }
}
let n = 0
const call = (name, input) => ({ type: 'tool_use', id: `tu_${++n}`, name, input })
const reply = (...uses) => ({ model: 'claude-sonnet-5-5', stop_reason: 'tool_use', content: uses, usage: { input_tokens: 1200, output_tokens: 300 } })

const GOALS = {
  G1: { prompt: 'Give away the HRV guide, then nurture for three emails, then invite them to book a call.', replies: [
    reply(call('set_campaign', { name: 'HRV guide giveaway', entry_pipeline: 'leads', entry_stage: 'new lead', goal_stage: 'Booked a call' })),
    reply(call('set_messages', { name: 'HRV guide steps', steps: [
      { channel: 'email', kind: 'service', subject: 'Your HRV guide', body: 'Hi {{first_name}}, here is the guide you asked for.', deliver_asset: 'hrv guide' },
      { channel: 'wait', delay_minutes: 1440 },
      { channel: 'email', kind: 'marketing', subject: 'What your HRV mirrors', body: 'Your HRV is a mirror of your state.', delay_minutes: 1440 },
      { channel: 'email', kind: 'marketing', subject: 'Building capacity', body: 'Capacity grows with practice.', delay_minutes: 2880 },
      { channel: 'email', kind: 'marketing', subject: 'Talk with us', body: 'Book a call when you are ready.', delay_minutes: 2880 }] })),
    reply(call('add_entry_source', { source_key: 'form:hrv-guide' })),
    reply(call('finish', { summary: 'Drafted the giveaway.' })),
  ] },
  G2: { prompt: 'When someone books an intro session, remind them by text.', replies: [
    reply(call('set_campaign', { name: 'Session reminders' })),
    reply(call('set_messages', { name: 'Reminder', steps: [{ channel: 'sms', kind: 'service', body: 'Hi {{first_name}}, a reminder about your session tomorrow.' }] })),
    reply(call('add_entry_source', { source_key: 'booking:intro' })),
    reply(call('add_task', { title: 'Connect bookings to campaigns', kind: 'connect_source', detail: 'Bookings do not raise events yet.' })),
    reply(call('finish', { summary: 'Drafted reminders.' })),
  ] },
  G3: { prompt: 'Welcome people who sign up for the webinar, with a page and a form.', replies: [
    reply(call('set_campaign', { name: 'Webinar welcome' })),
    reply(call('draft_form', { slug: 'webinar', name: 'Webinar sign up', fields: [{ key: 'email', label: 'Email', type: 'email', required: true, maps_to: 'email' }] })),
    reply(call('draft_page', { slug: 'webinar', title: 'Join the webinar', form_slug: 'webinar', blocks: [{ type: 'heading', text: 'Join us' }, { type: 'form' }] })),
    reply(call('add_entry_source', { source_key: 'form:webinar' })),
    reply(call('set_messages', { name: 'Welcome', steps: [{ channel: 'email', kind: 'marketing', subject: 'Welcome', body: 'Thank you for joining.' }] })),
    reply(call('finish', { summary: 'Drafted the webinar welcome.' })),
  ] },
  G4: { prompt: 'When someone is enrolled, send a welcome email.', replies: [
    reply(call('set_campaign', { name: 'Enrolled welcome', entry_pipeline: 'Leads', entry_stage: 'Enrolled' })),
    reply(call('add_entry_source', { source_key: 'stage:s3' })),
    reply(call('set_messages', { name: 'Welcome aboard', steps: [{ channel: 'email', kind: 'service', subject: 'Welcome aboard', body: 'We are glad you are here.' }] })),
    reply(call('finish', { summary: 'Drafted the welcome.' })),
  ] },
  G5: { prompt: 'Announce the certification course.', replies: [
    reply(call('set_campaign', { name: 'Course announcement' })),
    reply(call('set_messages', { name: 'Announcement', steps: [{ channel: 'email', kind: 'marketing', subject: 'Get certified', body: 'Become certified ' + String.fromCharCode(0x2014) + ' guaranteed results.' }] })),
    reply(call('finish', { summary: 'Drafted.' })),
  ] },
}

;(async () => {
  const rows = []
  const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
  const results = {}
  for (const [g, spec] of Object.entries(GOALS)) {
    const db = H.stubDb(DATA, { rpc })
    const setup = await readHubSetup(db, 'O1')
    let i = 0
    const client = { create: async () => spec.replies[i++] || { model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [], usage: { input_tokens: 1, output_tokens: 1 } } }
    results[g] = await runBuilder({ db, client, org: 'O1', userId: 'U1', sessionId: 'SESS', policy: { ...DEFAULT_POLICY }, setup, prompt: spec.prompt })
  }
  const kinds = (r) => (r.plan ? r.plan.tasks.map((t) => t.kind) : [])
  const titles = (r) => (r.plan ? r.plan.tasks.map((t) => t.title) : [])
  const p = (g) => results[g].plan || {}

  const g1 = p('G1')
  check('G1_STRUCT', results.G1.outcome === 'planned' && g1.campaign && g1.campaign.entry_pipeline_id === 'P1' && g1.campaign.entry_stage_id === 's1' && g1.campaign.goal_stage_id === 's2'
    && g1.sequence && g1.sequence.steps.length === 5 && g1.sequence.steps[0].step_type === 'deliver_asset' && g1.sequence.steps[0].asset_id === 'A1'
    && JSON.stringify(g1.routes) === JSON.stringify([{ source_key: 'form:hrv-guide' }]), { outcome: results.G1.outcome, campaign: g1.campaign })
  check('G1_TASKS', kinds(results.G1).includes('copy_review') && kinds(results.G1).includes('sender_or_dns') && !kinds(results.G1).includes('consent'), kinds(results.G1))

  const g2 = p('G2')
  check('G2_STRUCT', results.G2.outcome === 'planned' && g2.routes && g2.routes.length === 0 && g2.sequence && g2.sequence.steps[0].channel === 'sms', { routes: g2.routes })
  check('G2_START', titles(results.G2).includes('Choose what starts this campaign'), titles(results.G2))
  check('G2_TASKS', kinds(results.G2).includes('sms_registration') && kinds(results.G2).includes('connect_source'), kinds(results.G2))

  const g3 = p('G3')
  check('G3_STRUCT', results.G3.outcome === 'planned' && g3.forms && g3.forms.length === 1 && g3.forms[0].status === 'draft' && g3.pages.length === 1
    && g3.pages[0].form_slug === 'webinar' && g3.routes[0].source_key === 'form:webinar', { forms: g3.forms, pages: g3.pages })
  check('G3_TASKS', kinds(results.G3).includes('consent') && titles(results.G3).some((t) => t.startsWith('Publish the form')), titles(results.G3))

  const g4 = p('G4')
  check('G4_STRUCT', results.G4.outcome === 'planned' && g4.campaign && g4.campaign.entry_stage_id === 's3'
    && JSON.stringify(g4.routes) === JSON.stringify([{ source_key: 'stage:s3' }]), { routes: g4.routes })
  check('G4_TASKS', kinds(results.G4).includes('copy_review') && !kinds(results.G4).includes('sms_registration'), kinds(results.G4))

  const g5 = p('G5')
  check('G5_STRUCT', results.G5.outcome === 'planned' && g5.review && g5.review.length === 1 && g5.review[0].issues.length >= 3, g5.review)
  const cr = results.G5.plan && results.G5.plan.tasks.find((t) => t.kind === 'copy_review')
  check('G5_TASKS', cr && /claims check flagged/.test(cr.detail || ''), cr)

  // controls: nothing in any run reached a contact, and the plan never asks to go live
  const all = JSON.stringify(results)
  check('C_NO_PHONE_LEAK', !all.includes('+18285550199'), null)
  check('C_DRAFT_ONLY', Object.values(results).every((r) => !r.plan || !JSON.stringify(r.plan).match(/"(status|live_enabled)":"?(active|true)/)), null)

  H.report(rows, active, RED_OF, () => require('fs').rmSync(out, { recursive: true, force: true }))
})().catch((e) => { console.error(e); process.exit(2) })
