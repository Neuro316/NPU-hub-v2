// src/lib/agent/loop.ts
// One Campaign Builder run: the tool-use loop, the caps and the log (rulings 7, 8, 9).
// Nothing here writes a draft. The plan is stored on the agent_runs row and built later, in
// one transaction, by public.agent_build (AG4). Every model call is preceded by a spend
// reservation that the database refuses past the monthly cap, and settled to the real cost
// afterwards (AG8).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ModelClient, MessageParam, ToolUseBlock } from './model'
import { ModelMisconfigured, ModelUnavailable } from './model'
import { settle } from './settle'
import { MAX_OUTPUT_TOKENS, modelFor, type AgentPolicy } from './config'
import { costOf, priceFor, worstCase } from './pricing'
import { BUILDER_TOOLS, emptyPlan, runBuilderTool, type Plan, type ToolState } from './tools/draft'
import { setupForModel, type HubSetup } from './tools/read'
import { builderSystem, builderUserTurn } from './prompt'
import { followUps } from './readiness'
import { GUIDE_VERSION } from './claims'
import { scrubContactDetails } from './untrusted'

export type RunOutcome = 'planned' | 'refused' | 'cap_hit' | 'model_unavailable' | 'failed'

export interface BuilderRunInput {
  db: SupabaseClient
  client: ModelClient
  org: string
  userId: string
  sessionId: string
  policy: AgentPolicy
  setup: HubSetup
  prompt: string
  pasted?: string | null
  existing?: { campaign_id: string; name: string; was_live: boolean; text: string } | null
}

export interface BuilderRunResult {
  runId: string | null
  outcome: RunOutcome
  message: string
  plan: Plan | null
  costUsd: number
}

const MESSAGES: Record<Exclude<RunOutcome, 'planned'>, string> = {
  refused: 'The Campaign Builder did not draft anything for this request.',
  cap_hit: 'The Campaign Builder has reached its spending limit for this month, so it cannot run. A superadmin can raise the limit in CRM Settings.',
  model_unavailable: 'The Campaign Builder could not reach the AI service just now, so nothing was drafted. Try again in a few minutes; everything else in the Hub works as normal.',
  failed: 'Something went wrong while drafting, so nothing was saved. Try again.',
}

const clip = (v: unknown, n = 300) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > n ? `${s.slice(0, n)}...` : s
}

export async function runBuilder(i: BuilderRunInput): Promise<BuilderRunResult> {
  const model = modelFor('builder')
  const prompt = scrubContactDetails(i.prompt)
  const pasted = i.pasted ? scrubContactDetails(i.pasted) : null
  if (!priceFor(model)) {
    console.error(`[agent/loop] no price for model ${model}; refusing to run`)
    return { runId: null, outcome: 'failed', message: 'The Campaign Builder is set to a model it cannot price, so it will not run. Check AGENT_MODEL.', plan: null, costUsd: 0 }
  }

  const { data: run, error: runErr } = await i.db.from('agent_runs').insert({
    session_id: i.sessionId, org_id: i.org, user_id: i.userId, mode: 'builder', prompt: prompt.slice(0, 8000),
    guide_version: GUIDE_VERSION, model_id: model, outcome: 'running',
  }).select('id').single()
  if (runErr || !run) return { runId: null, outcome: 'failed', message: MESSAGES.failed, plan: null, costUsd: 0 }
  const runId = (run as any).id as string

  const state: ToolState = { setup: i.setup, plan: emptyPlan(), finished: false, pageSlugs: new Set(i.setup.page_slugs) }
  if (i.existing) state.plan.edit_of = { campaign_id: i.existing.campaign_id, name: i.existing.name, was_live: i.existing.was_live }
  const messages: MessageParam[] = [{ role: 'user', content: builderUserTurn({ setupJson: JSON.stringify(setupForModel(i.setup)),
    request: prompt, pasted, existing: i.existing?.text ?? null }) }]
  const log: Array<Record<string, unknown>> = []
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let cost = 0, toolCalls = 0, outcome: RunOutcome = 'planned', lastText = '', error: string | null = null

  try {
    for (let turn = 0; turn <= i.policy.run_tool_calls && !state.finished; turn++) {
      const req = { model, max_tokens: MAX_OUTPUT_TOKENS.builder, system: builderSystem(), tools: BUILDER_TOOLS, messages }
      const reserve = worstCase(JSON.stringify(req).length, MAX_OUTPUT_TOKENS.builder)
      const { data: r, error: rErr } = await i.db.rpc('agent_reserve', { p_org: i.org, p_mode: 'builder', p_amount: reserve })
      if (rErr) throw new Error(`reserve failed: ${rErr.code ?? 'unknown'}`)
      if (!(r as any)?.ok) { outcome = 'cap_hit'; break }
      const month = (r as any).month as string
      let reply
      try {
        reply = await i.client.create(req)
      } catch (e) {
        // an abandoned call may still have been billed, so the reservation is kept as spent
        const spent = e instanceof ModelUnavailable ? reserve : 0
        await settle(i.db, { p_org: i.org, p_month: month, p_mode: 'builder', p_reserved: reserve, p_actual: spent })
        cost += spent
        throw e
      }
      const c = costOf(reply.model || model, reply.usage)
      cost += c
      tokens.input += reply.usage.input_tokens ?? 0; tokens.output += reply.usage.output_tokens ?? 0
      tokens.cacheRead += reply.usage.cache_read_input_tokens ?? 0; tokens.cacheWrite += reply.usage.cache_creation_input_tokens ?? 0
      await settle(i.db, { p_org: i.org, p_month: month, p_mode: 'builder', p_reserved: reserve, p_actual: c })
      if (reply.stop_reason === 'refusal') { outcome = 'refused'; break }

      messages.push({ role: 'assistant', content: reply.content as any })
      lastText = reply.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim() || lastText
      const uses = reply.content.filter((b: any) => b.type === 'tool_use') as ToolUseBlock[]
      if (!uses.length) break

      const results: any[] = []
      for (const u of uses) {
        if (toolCalls >= i.policy.run_tool_calls) {
          results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'The tool call limit for this run is reached. Call nothing else.' })
          log.push({ tool: u.name, refused: 'step_limit' })
          continue
        }
        toolCalls++
        const res = await runBuilderTool(u.name, u.input, state)
        log.push({ tool: u.name, input: clip(u.input), ok: res.ok, result: clip(res.text) })
        results.push({ type: 'tool_result', tool_use_id: u.id, content: res.text, ...(res.ok ? {} : { is_error: true }) })
      }
      messages.push({ role: 'user', content: results })
      if (toolCalls >= i.policy.run_tool_calls && !state.finished) { log.push({ stopped: 'step_limit' }); break }
    }
  } catch (e) {
    outcome = e instanceof ModelUnavailable ? 'model_unavailable' : 'failed'
    error = e instanceof ModelMisconfigured ? `model_misconfigured:${e.message}` : e instanceof Error ? e.message.slice(0, 300) : 'unknown'
    console.error(`[agent/loop] run ${runId} ended ${outcome}: ${error}`)
  }

  const plan = state.plan
  const drafted = !!(plan.campaign || plan.sequence || plan.forms.length || plan.pages.length)
  if (outcome === 'planned' && !drafted) outcome = 'refused'
  if (outcome === 'planned') plan.tasks = followUps(plan, i.setup)

  const { data: upd, error: uErr } = await i.db.from('agent_runs').update({
    plan: outcome === 'planned' ? plan : null, tool_calls: log, outcome, error,
    input_tokens: tokens.input, output_tokens: tokens.output, cache_read_tokens: tokens.cacheRead, cache_write_tokens: tokens.cacheWrite,
    cost_usd: Number(cost.toFixed(6)), finished_at: new Date().toISOString(),
  }).eq('id', runId).select('id')
  if (uErr || (upd?.length ?? 0) !== 1) {
    console.error(`[agent/loop] run ${runId} could not be recorded: ${uErr?.code ?? 'no row'}`)
    return { runId, outcome: 'failed', message: MESSAGES.failed, plan: null, costUsd: cost }
  }

  if (outcome === 'planned') return { runId, outcome, message: plan.summary || lastText || 'The draft is ready to review.', plan, costUsd: cost }
  const msg = outcome === 'refused' && lastText ? lastText : MESSAGES[outcome]
  return { runId, outcome, message: msg, plan: null, costUsd: cost }
}
