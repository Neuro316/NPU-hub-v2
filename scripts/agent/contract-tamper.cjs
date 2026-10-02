#!/usr/bin/env node
// scripts/agent/contract-tamper.cjs   (test c)
//
// The tool JSON schemas the model sees must accept exactly what the real validators and the
// database accept. Each enum in a schema is compared with what the validator lets through
// (probed) or with the CHECK constraint in the migration that defines the column (read from
// the file), so the engine and the agent cannot drift apart without this failing.
//
//   channel   set_messages offers a channel the validator refuses   {K_CHANNELS}
//   taskkind  the agent offers a task kind the table refuses        {K_TASKS}
//   block     draft_page offers a block type pages do not support   {K_BLOCKS}
// TAMPER=1 reddens the union (3).
const fs = require('fs'), path = require('path')
const H = require('./lib/harness.cjs')

const TAMPERS = {
  channel: [['lib/agent/tools/draft.ts', "channel: { type: 'string', enum: ['email', 'sms', 'wait'] }, kind:", "channel: { type: 'string', enum: ['email', 'sms', 'wait', 'task'] }, kind:"]],
  taskkind: [['lib/agent/tools/draft.ts', "'sms_registration', 'other'] as const", "'sms_registration', 'other', 'invoice'] as const"]],
  block: [['lib/agent/tools/draft.ts', "enum: ['heading', 'text', 'list', 'image', 'button', 'form'] }", "enum: ['heading', 'text', 'list', 'image', 'button', 'form', 'html'] }"]],
}
const RED_OF = { channel: ['K_CHANNELS'], taskkind: ['K_TASKS'], block: ['K_BLOCKS'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-contract')
const load = H.install(out)
const { BUILDER_TOOLS, TASK_KINDS } = load('lib/agent/tools/draft.ts')
const { checkSteps } = load('lib/marketing/validate/sequence.ts')
const { checkPage } = load('lib/marketing/validate/page.ts')
const { checkSourceKey } = load('lib/marketing/validate/route.ts')

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
const tool = (n) => BUILDER_TOOLS.find((t) => t.name === n).input_schema
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
const sql = (f) => fs.readFileSync(path.join(H.ROOT, 'supabase', 'migrations', f), 'utf8')
const checkList = (text, col) => {
  const m = new RegExp(`${col}\\s+text[^\\n]*check \\(${col} in \\(([^)]*)\\)`).exec(text)
  return m ? m[1].split(',').map((x) => x.trim().replace(/'/g, '')) : null
}

// channels: the enum against what checkSteps accepts, probed with every candidate
const stepItem = tool('set_messages').properties.steps.items.properties
const offered = stepItem.channel.enum
const accepted = ['email', 'sms', 'wait', 'task', 'fax'].filter((c) => checkSteps([{ channel: c, subject: 's', body: 'b' }], new Set()).ok)
check('K_CHANNELS', sameSet(offered, accepted), { offered, accepted })
const stepKinds = ((/add column kind text check \(kind in \(([^)]*)\)\)/.exec(sql('hub_211_marketing_engine.sql')) || [])[1] || '')
  .split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean)
check('K_KINDS', stepKinds.length > 0 && sameSet(stepItem.kind.enum, stepKinds), { offered: stepItem.kind.enum, db: stepKinds })

// task kinds: the enum and the constant against the CHECK on campaign_tasks.kind in hub_213
const dbKinds = checkList(sql('hub_213_campaign_builder_agent.sql'), 'kind')
check('K_TASKS', dbKinds && sameSet(TASK_KINDS, dbKinds) && sameSet(tool('add_task').properties.kind.enum, dbKinds), { agent: TASK_KINDS, db: dbKinds })

// page blocks: every offered type must pass checkPage with minimal content; an unknown type must not
const SAMPLE = { heading: { text: 'H' }, text: { text: 'T' }, list: { items: ['a'] }, image: { url: 'https://x.example/a.png', alt: 'a' }, button: { label: 'Go', href: '/x' }, form: {}, html: { text: '<b>x</b>' } }
const blockEnum = tool('draft_page').properties.blocks.items.properties.type.enum
const blockOk = blockEnum.every((t) => checkPage({ slug: 'p', title: 'P', form_slug: 'f', blocks: [{ type: t, ...(SAMPLE[t] || {}) }] }).ok)
check('K_BLOCKS', blockOk && !checkPage({ slug: 'p', title: 'P', blocks: [{ type: 'script', text: 'x' }] }).ok, { blockEnum })

// form field types and mappings against the types the intake module declares
const intake = fs.readFileSync(path.join(H.SRC, 'lib', 'marketing', 'intake.ts'), 'utf8')
const union = (name) => (new RegExp(`export type ${name} = ([^\\n]+)`).exec(intake) || [])[1].split('|').map((x) => x.trim().replace(/'/g, ''))
const fieldProps = tool('draft_form').properties.fields.items.properties
check('K_FIELDS', sameSet(fieldProps.type.enum, union('FieldType')) && sameSet(fieldProps.maps_to.enum, union('MapsTo')), { types: fieldProps.type.enum })

// the concrete source keys the model is told about must pass the route validator
check('K_SOURCE_KEYS', ['call:missed', 'call:answered', 'form:a-b', 'stage:2b9d6a6e-0000-0000-0000-000000000000'].every((k) => checkSourceKey(k).ok), null)

// control: the comparison can tell sets apart
check('C_SETS_DIFFER', !sameSet(['a', 'b'], ['a', 'c']), null)

H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
