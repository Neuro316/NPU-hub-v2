// src/lib/agent/tools/draft.ts
// The Campaign Builder's tools. None of them writes to the database: each one validates its
// input with the SAME code the Hub screens use (ruling 3, src/lib/marketing/validate/) and
// adds it to an in-memory plan. The plan is stored on the run and written, all at once and
// only as drafts, by public.agent_build when a person presses Build (AG4).
//
// There is deliberately no tool that sends, enrolls, publishes, goes live, records consent,
// touches suppressions or the test allowlist, or reads a contact (ruling 1, 2). The list
// below is the whole surface; scripts/agent/adversarial-tamper.cjs asserts it.
import type { Tool } from '../model'
import type { HubSetup } from './read'
import { checkCampaign, type CampaignLookup } from '@/lib/marketing/validate/campaign'
import { checkSequenceHead, checkSteps, type StepRow } from '@/lib/marketing/validate/sequence'
import { checkSourceKey } from '@/lib/marketing/validate/route'
import { checkForm, type FormFields } from '@/lib/marketing/validate/form'
import { checkPage, type PageFields } from '@/lib/marketing/validate/page'
import { sourceIsConnected } from '@/lib/marketing/ui-logic'
import { checkClaims } from '../claims'

export const TASK_KINDS = ['copy_review', 'attach_file', 'connect_source', 'sender_or_dns', 'consent', 'sms_registration', 'other'] as const
export type TaskKind = (typeof TASK_KINDS)[number]
export const MAX_TASKS = 15

export interface PlanTask { title: string; detail: string | null; kind: TaskKind }
export interface Plan {
  campaign: null | { name: string; description: string | null; entry_pipeline_id: string | null; entry_stage_id: string | null; goal_stage_id: string | null; goal: Record<string, unknown> }
  sequence: null | { name: string; steps: StepRow[] }
  routes: Array<{ source_key: string }>
  forms: FormFields[]
  pages: PageFields[]
  tasks: PlanTask[]
  /** messages the claims check flagged; saved anyway, marked needs review (ruling 5) */
  review: Array<{ step: number; issues: string[] }>
  summary: string | null
  /** set when the request was to change an existing campaign: the plan is a new draft copy (AG12) */
  edit_of: null | { campaign_id: string; name: string; was_live: boolean }
}

export const emptyPlan = (): Plan => ({ campaign: null, sequence: null, routes: [], forms: [], pages: [], tasks: [], review: [], summary: null, edit_of: null })

export interface ToolState { setup: HubSetup; plan: Plan; finished: boolean; pageSlugs: Set<string> }
export interface ToolResult { ok: boolean; text: string }

const s = (props: Record<string, unknown>, required: string[]) => ({ type: 'object' as const, properties: props, required, additionalProperties: false })
const str = { type: 'string' }

export const BUILDER_TOOLS: Tool[] = [
  { name: 'set_campaign', description: 'Set the funnel campaign being drafted: its name, what it is for, the pipeline and stage a person enters at, and the stage that counts as the goal. Use pipeline and stage names exactly as listed in the Hub setup. The campaign is always saved as a draft that is not live.',
    input_schema: s({ name: str, description: str, entry_pipeline: str, entry_stage: str, goal_stage: str }, ['name']) },
  { name: 'set_messages', description: 'Set the campaign\'s steps in order: emails, text messages, waits, and asset deliveries. Write complete copy in the voice and claims guide. delay_minutes is the wait after the previous step. For an asset delivery, name the University asset by its exact title.',
    input_schema: s({ name: str, steps: { type: 'array', items: s({ channel: { type: 'string', enum: ['email', 'sms', 'wait'] }, kind: { type: 'string', enum: ['marketing', 'service'] }, delay_minutes: { type: 'integer' }, subject: str, body: str, deliver_asset: str }, ['channel']) } }, ['name', 'steps']) },
  { name: 'add_entry_source', description: 'Add something that starts the campaign, as a source key in the formats listed in the Hub setup. Only connected sources can be added; for anything not connected, add a task instead. Sources are saved switched off and switch on when a person activates the campaign.',
    input_schema: s({ source_key: str }, ['source_key']) },
  { name: 'add_task', description: 'Add a follow-up task for a person: copy to approve, a file to attach, a source to connect, a sender or DNS item, a consent item, an SMS registration item, or anything else a person must finish.',
    input_schema: s({ title: str, detail: str, kind: { type: 'string', enum: [...TASK_KINDS] } }, ['title', 'kind']) },
  { name: 'draft_form', description: 'Draft a new signup form, saved as a draft that is not published. Fields map to email, phone, first_name or last_name. Consent boxes need the exact wording a person will see.',
    input_schema: s({ slug: str, name: str, success_message: str,
      fields: { type: 'array', items: s({ key: str, label: str, type: { type: 'string', enum: ['text', 'email', 'tel', 'textarea', 'select'] }, required: { type: 'boolean' }, options: { type: 'array', items: str }, maps_to: { type: 'string', enum: ['email', 'phone', 'first_name', 'last_name'] } }, ['key', 'label', 'type']) },
      consents: { type: 'array', items: s({ id: str, channel: { type: 'string', enum: ['email', 'sms'] }, kind: { type: 'string', enum: ['marketing', 'service'] }, text: str, required: { type: 'boolean' } }, ['id', 'channel', 'kind', 'text']) } }, ['slug', 'name', 'fields']) },
  { name: 'draft_page', description: 'Draft a landing page, saved as a draft that is not published. Blocks are heading, text, list, image, button, or form; a form block shows the form named in form_slug.',
    input_schema: s({ slug: str, title: str, form_slug: str,
      blocks: { type: 'array', items: s({ type: { type: 'string', enum: ['heading', 'text', 'list', 'image', 'button', 'form'] }, text: str, level: { type: 'integer' }, items: { type: 'array', items: str }, url: str, alt: str, label: str, href: str }, ['type']) } }, ['slug', 'title', 'blocks']) },
  { name: 'finish', description: 'Call once when the draft is complete, with a short summary for the person of what you drafted and what they must still do.',
    input_schema: s({ summary: str }, ['summary']) },
]

const norm = (x: unknown) => String(x ?? '').trim().toLowerCase()
const list = (names: string[]) => (names.length ? names.map((n) => `"${n}"`).join(', ') : 'none')

function setupLookup(setup: HubSetup): CampaignLookup {
  return {
    async inOrg(table, id) {
      if (table === 'pipelines') return setup.pipelines.some((p) => p.id === id)
      if (table === 'pipeline_stages') return setup.stages.some((x) => x.id === id)
      return false // the agent never links an existing sequence or planning campaign
    },
    async stagePipeline(stageId) { return setup.stages.find((x) => x.id === stageId)?.pipeline_id },
  }
}

export async function runBuilderTool(name: string, input: any, st: ToolState): Promise<ToolResult> {
  const { setup, plan } = st
  input = input && typeof input === 'object' ? input : {}

  if (name === 'set_campaign') {
    let pipelineId: string | null = null
    if (input.entry_pipeline) {
      const p = setup.pipelines.find((x) => x.id === input.entry_pipeline || norm(x.name) === norm(input.entry_pipeline))
      if (!p) return { ok: false, text: `No pipeline is named "${input.entry_pipeline}". Pipelines: ${list(setup.pipelines.map((x) => x.name))}.` }
      pipelineId = p.id
    }
    const inPipe = (v: string) => setup.stages.filter((x) => x.pipeline_id === pipelineId && (x.id === v || norm(x.name) === norm(v)))
    let entryId: string | null = null
    if (input.entry_stage) {
      if (!pipelineId) return { ok: false, text: 'Name the entry pipeline as well as the entry stage.' }
      const m = inPipe(input.entry_stage)
      if (m.length !== 1) return { ok: false, text: `The pipeline has no stage named "${input.entry_stage}". Its stages: ${list(setup.stages.filter((x) => x.pipeline_id === pipelineId).map((x) => x.name))}.` }
      entryId = m[0].id
    }
    let goalId: string | null = null
    if (input.goal_stage) {
      let m = pipelineId ? inPipe(input.goal_stage) : []
      if (!m.length) m = setup.stages.filter((x) => x.id === input.goal_stage || norm(x.name) === norm(input.goal_stage))
      if (m.length !== 1) return { ok: false, text: m.length ? `More than one stage is named "${input.goal_stage}"; name the entry pipeline so the right one is used.` : `No stage is named "${input.goal_stage}".` }
      goalId = m[0].id
    }
    const body = { name: input.name, description: input.description ?? null, entry_pipeline_id: pipelineId, entry_stage_id: entryId, goal_stage_id: goalId }
    const check = await checkCampaign(body, setupLookup(setup))
    if (!check.ok) return { ok: false, text: check.message }
    plan.campaign = { name: check.name, description: typeof body.description === 'string' ? body.description.trim() || null : null,
      entry_pipeline_id: pipelineId, entry_stage_id: entryId, goal_stage_id: goalId, goal: {} }
    return { ok: true, text: `Campaign "${check.name}" set, as a draft.` }
  }

  if (name === 'set_messages') {
    const steps = Array.isArray(input.steps) ? input.steps : []
    const mapped: any[] = []
    for (let i = 0; i < steps.length; i++) {
      const x = steps[i] ?? {}
      let stepType = 'message', assetId: string | null = null
      if (x.deliver_asset) {
        const a = setup.assets.find((y) => norm(y.title) === norm(x.deliver_asset))
        if (!a) return { ok: false, text: `Step ${i + 1}: no University asset is titled "${x.deliver_asset}". Assets: ${list(setup.assets.map((y) => y.title))}. If the asset does not exist yet, leave the step out and add an attach_file task.` }
        stepType = 'deliver_asset'; assetId = a.id
      }
      mapped.push({ channel: x.channel, kind: x.kind, delay_minutes: x.delay_minutes, subject: x.subject, body: x.body, step_type: stepType, asset_id: assetId })
    }
    const head = checkSequenceHead({ name: input.name, steps: mapped })
    if (!head.ok) return { ok: false, text: head.message }
    const rows = checkSteps(head.steps, new Set(setup.assets.map((a) => a.id)))
    if (!rows.ok) return { ok: false, text: rows.message }
    plan.sequence = { name: head.name, steps: rows.rows }
    plan.review = []
    for (const r of rows.rows) {
      if (r.channel === 'wait' || !r.kind) continue
      const c = checkClaims({ channel: r.channel, kind: r.kind, subject: r.subject, body: r.body ?? '' })
      if (!c.ok) plan.review.push({ step: r.step_order + 1, issues: c.issues.map((i) => i.detail) })
    }
    const flagged = plan.review.map((r) => `Step ${r.step}: ${r.issues.join(' ')}`)
    return { ok: true, text: flagged.length
      ? `Saved ${rows.rows.length} steps. The claims check flagged these, which will be marked needs review unless you rewrite them: ${flagged.join(' | ')}`
      : `Saved ${rows.rows.length} steps. Every message passed the claims check.` }
  }

  if (name === 'add_entry_source') {
    const k = checkSourceKey(input.source_key)
    if (!k.ok) return { ok: false, text: k.message }
    const key = k.key
    if (plan.routes.some((r) => r.source_key === key)) return { ok: true, text: `${key} is already added.` }
    if (key.startsWith('form:')) {
      const known = setup.forms.some((f) => f.source_key === key) || plan.forms.some((f) => f.source_key === key)
      if (!known) return { ok: false, text: `No form uses the source key ${key}. Use a listed form's source key, or draft the form first.` }
    } else if (key.startsWith('stage:')) {
      if (!setup.stages.some((x) => `stage:${x.id}` === key)) return { ok: false, text: 'That stage is not one of this organization\'s stages. Use stage:<stage id> from the Hub setup.' }
    } else if (!sourceIsConnected(key, setup.status)) {
      return { ok: false, text: `${key} is not connected yet, so it cannot start a campaign. Add a connect_source task describing what needs connecting instead.` }
    }
    plan.routes.push({ source_key: key })
    return { ok: true, text: `Added ${key}. It is saved switched off and switches on when a person activates the campaign.` }
  }

  if (name === 'add_task') {
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    if (!title || title.length > 200) return { ok: false, text: 'A task needs a title of at most 200 characters.' }
    if (!(TASK_KINDS as readonly string[]).includes(input.kind)) return { ok: false, text: `A task kind is one of ${TASK_KINDS.join(', ')}.` }
    const detail = typeof input.detail === 'string' && input.detail.trim() ? input.detail.trim().slice(0, 2000) : null
    if (plan.tasks.length >= MAX_TASKS) return { ok: false, text: `A draft can carry at most ${MAX_TASKS} tasks.` }
    if (!plan.tasks.some((t) => norm(t.title) === norm(title))) plan.tasks.push({ title, detail, kind: input.kind })
    return { ok: true, text: 'Task added.' }
  }

  if (name === 'draft_form') {
    // the source key always comes from the slug: a model-supplied one could aim the form at a
    // call or another form's campaigns (the tool schema has no source_key; this enforces it)
    const { source_key: _ignored, ...fields } = (input ?? {}) as Record<string, unknown>
    const check = checkForm({ ...fields, status: 'draft' })
    if (!check.ok) return { ok: false, text: check.message }
    if (setup.forms.some((f) => f.slug === check.row.slug) || plan.forms.some((f) => f.slug === check.row.slug)) {
      return { ok: false, text: `A form already uses the address ${check.row.slug}. Choose another.` }
    }
    plan.forms.push(check.row)
    return { ok: true, text: `Form ${check.row.slug} drafted, with source key ${check.row.source_key}. It is not published.` }
  }

  if (name === 'draft_page') {
    const check = checkPage({ ...input, status: 'draft' })
    if (!check.ok) return { ok: false, text: check.message }
    if (st.pageSlugs.has(check.row.slug) || plan.pages.some((p) => p.slug === check.row.slug)) return { ok: false, text: `A page already uses the address ${check.row.slug}.` }
    if (check.row.form_slug && !setup.forms.some((f) => f.slug === check.row.form_slug) && !plan.forms.some((f) => f.slug === check.row.form_slug)) {
      return { ok: false, text: `No form has the address ${check.row.form_slug}. Draft it first or use a listed form.` }
    }
    plan.pages.push(check.row)
    return { ok: true, text: `Page ${check.row.slug} drafted. It is not published.` }
  }

  if (name === 'finish') {
    plan.summary = typeof input.summary === 'string' ? input.summary.trim().slice(0, 2000) : null
    st.finished = true
    return { ok: true, text: 'Done.' }
  }

  return { ok: false, text: `There is no tool named ${name}.` }
}
