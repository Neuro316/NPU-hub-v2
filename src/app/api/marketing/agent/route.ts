// POST /api/marketing/agent   (staff; builder mode: platform superadmin only)
// The Campaign Builder (rulings 1 to 14) and, in guide mode, the Hub Guide (rulings 15 to 24).
//   { action: 'plan',  org_id, prompt, pasted?, session_id?, surface?, campaign_id? }
//       runs the agent and returns a plan to review; nothing is written but the run log
//   { action: 'build', org_id, run_id }
//       writes that plan, all at once and only as drafts, through public.agent_build
//   { action: 'ask',   org_id, question, route?, help_id?, session_id? }
//       the Hub Guide: answers from the help articles, writes nothing but its log and help_gaps
// The org comes from membership (withStaff, requireOrg), never from the body alone. The
// service role is used, so the checks in this file are the boundary.
import { NextResponse } from 'next/server'
import { withStaff, requireOrg, bad, forbidden } from '@/lib/api-guard'
import { getFlags } from '@/lib/marketing/flags'
import { getPolicy, helpRoleOf, mayUseGuide, MAX_PASTED_CHARS, MAX_PROMPT_CHARS } from '@/lib/agent/config'
import { rateLimited, useSession } from '@/lib/agent/session'
import { readHubSetup } from '@/lib/agent/tools/read'
import { runBuilder } from '@/lib/agent/loop'
import { liveClient } from '@/lib/agent/model'
import { planForReview } from '@/lib/agent/review'
import { runGuide } from '@/lib/agent/guide'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const LIVE_STATUSES = ['active', 'paused']

export const POST = withStaff(async (req, ctx) => {
  const b = await req.json().catch(() => ({}))
  const org = requireOrg(ctx, b?.org_id)
  if (typeof org !== 'string') return org
  const db = ctx.db

  if (b.action === 'approve') {
    // a person approving an AI draft (ruling 14): any staff member of the org, as for editing it
    const id = typeof b.id === 'string' ? b.id : ''
    const now = new Date().toISOString()
    let rows: any[] | null = null
    if (b.kind === 'campaign' || b.kind === 'form' || b.kind === 'page') {
      const table = b.kind === 'campaign' ? 'funnel_campaigns' : b.kind === 'form' ? 'form_definitions' : 'page_definitions'
      ;({ data: rows } = await db.from(table).update({ ai_reviewed_at: now }).eq('id', id).eq('org_id', org).not('ai_run_id', 'is', null).select('id'))
    } else if (b.kind === 'step') {
      const { data: step } = await db.from('sequence_steps').select('id, sequences!inner(org_id)').eq('id', id).eq('sequences.org_id', org).maybeSingle()
      if (step) ({ data: rows } = await db.from('sequence_steps').update({ ai_reviewed_at: now }).eq('id', id).not('ai_run_id', 'is', null).select('id'))
    } else return bad('Say what to approve.')
    if ((rows?.length ?? 0) !== 1) return NextResponse.json({ error: 'That draft was not found.' }, { status: 404 })
    return NextResponse.json({ approved: true })
  }

  if (b.action === 'task') {
    if (!['open', 'done', 'dismissed'].includes(b.status)) return bad('Say whether the task is open, done or dismissed.')
    const { data: rows } = await db.from('campaign_tasks').update({ status: b.status, updated_at: new Date().toISOString() })
      .eq('id', typeof b.id === 'string' ? b.id : '').eq('org_id', org).select('id')
    if ((rows?.length ?? 0) !== 1) return NextResponse.json({ error: 'That task was not found.' }, { status: 404 })
    return NextResponse.json({ updated: true })
  }

  if (b.action === 'ask') {
    // ── the Hub Guide: read only, its own flag, its own role setting and cap (rulings 15 to 21) ──
    const flags = await getFlags(db, org)
    if (!flags.help_bot_enabled) return forbidden('The Hub Guide is switched off for this organization.')
    const policy = await getPolicy(db, org)
    if (!mayUseGuide(policy, helpRoleOf(ctx.isSuperadmin, ctx.orgRoles[org]))) return forbidden('The Hub Guide is not open to your role yet.')
    const question = typeof b.question === 'string' ? b.question.trim() : ''
    if (!question) return bad('Type a question.')
    if (question.length > MAX_PROMPT_CHARS) return bad(`Keep the question under ${MAX_PROMPT_CHARS} characters.`)
    if (await rateLimited(db, ctx.userId, 'guide')) return NextResponse.json({ error: 'You have asked a lot of questions in the last few minutes. Wait a little, then try again.' }, { status: 429 })
    const session = await useSession(db, { org, userId: ctx.userId, mode: 'guide', surface: 'panel', sessionId: b.session_id, policy })
    if (!session.ok) return NextResponse.json({ error: session.message }, { status: session.status })
    // ruling 19: only the route and the screen id are accepted; any other field is ignored
    const result = await runGuide({ db, client: liveClient(), org, userId: ctx.userId, sessionId: session.sessionId, policy, question,
      route: typeof b.route === 'string' ? b.route.slice(0, 300) : null, helpId: typeof b.help_id === 'string' ? b.help_id.slice(0, 120) : null })
    console.info(`[agent] guide run=${result.runId} org=${org} outcome=${result.outcome} cost=${result.costUsd.toFixed(4)}`)
    const status = result.outcome === 'answered' || result.outcome === 'no_answer' ? 200 : result.outcome === 'cap_hit' ? 429 : result.outcome === 'model_unavailable' ? 503 : 500
    return NextResponse.json({ session_id: session.sessionId, run_id: result.runId, outcome: result.outcome, message: result.message,
      error: status === 200 ? undefined : result.message, answer: result.answer,
      // the hand-off is offered only when the server would accept it (ruling 15)
      handoff_allowed: !!result.answer?.handoff && ctx.isSuperadmin && flags.agent_enabled }, { status })
  }

  if (b.action === 'plan' || b.action === 'build') {
    // the builder is superadmin only (ruling 10); hiding the button is not the check, this is
    if (!ctx.isSuperadmin) return forbidden('Only a platform superadmin can use the Campaign Builder.')
    const flags = await getFlags(db, org)
    if (!flags.agent_enabled) return forbidden('The Campaign Builder is switched off for this organization.')
  } else {
    return bad('Unknown action.')
  }

  if (b.action === 'build') {
    if (typeof b.run_id !== 'string') return bad('Say which draft to build.')
    const { data: run } = await db.from('agent_runs').select('id, outcome, created_ids')
      .eq('id', b.run_id).eq('org_id', org).eq('user_id', ctx.userId).eq('mode', 'builder').maybeSingle()
    if (!run) return NextResponse.json({ error: 'That draft was not found.' }, { status: 404 })
    if ((run as any).outcome === 'built') return NextResponse.json({ built: true, ids: (run as any).created_ids })
    if ((run as any).outcome !== 'planned') return bad('That draft cannot be built.')
    const { data: ids, error } = await db.rpc('agent_build', { p_run: b.run_id })
    if (error) {
      console.error(`[agent] build failed run=${b.run_id}: ${error.code ?? 'unknown'} ${error.message ?? ''}`)
      const taken = error.code === '23505'
      return NextResponse.json({ error: taken
        ? 'A form or page address in this draft is already used by another organization or item. Ask for a different address and try again.'
        : 'The draft could not be built, and nothing was saved. Try again.' }, { status: taken ? 409 : 500 })
    }
    console.info(`[agent] built run=${b.run_id} org=${org} by=${ctx.userId}`)
    return NextResponse.json({ built: true, ids })
  }

  // ── plan ──
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : ''
  if (!prompt) return bad('Describe what you want to accomplish.')
  if (prompt.length > MAX_PROMPT_CHARS) return bad(`Keep the description under ${MAX_PROMPT_CHARS} characters.`)
  const pasted = typeof b.pasted === 'string' && b.pasted.trim() ? b.pasted.trim() : null
  if (pasted && pasted.length > MAX_PASTED_CHARS) return bad(`Pasted text can be at most ${MAX_PASTED_CHARS} characters.`)
  if (await rateLimited(db, ctx.userId, 'builder')) return NextResponse.json({ error: 'You have started a lot of drafts in the last few minutes. Wait a little, then try again.' }, { status: 429 })

  const policy = await getPolicy(db, org)
  let existing = null as null | { campaign_id: string; name: string; was_live: boolean; text: string }
  if (typeof b.campaign_id === 'string' && b.campaign_id) {
    const { data: c } = await db.from('funnel_campaigns').select('id, name, description, status, live_enabled, sequence_id')
      .eq('id', b.campaign_id).eq('org_id', org).maybeSingle()
    if (!c) return bad('That campaign was not found in this organization.')
    const { data: steps } = (c as any).sequence_id
      ? await db.from('sequence_steps').select('step_order, channel, kind, delay_minutes, subject, body, step_type').eq('sequence_id', (c as any).sequence_id).order('step_order')
      : { data: [] as any[] }
    const was_live = LIVE_STATUSES.includes((c as any).status) || (c as any).live_enabled === true
    existing = { campaign_id: (c as any).id, name: (c as any).name, was_live,
      text: JSON.stringify({ name: (c as any).name, description: (c as any).description, status: (c as any).status, steps: steps ?? [] }) }
  }

  const session = await useSession(db, { org, userId: ctx.userId, mode: 'builder', surface: b.surface === 'panel' ? 'panel' : 'wizard',
    sessionId: b.session_id, campaignId: existing?.campaign_id ?? null, policy })
  if (!session.ok) return NextResponse.json({ error: session.message }, { status: session.status })

  let setup
  try { setup = await readHubSetup(db, org) }
  catch { return NextResponse.json({ error: 'The Hub setup could not be read. Try again.' }, { status: 503 }) }

  const result = await runBuilder({ db, client: liveClient(), org, userId: ctx.userId, sessionId: session.sessionId, policy, setup,
    prompt, pasted, existing })
  console.info(`[agent] run=${result.runId} org=${org} outcome=${result.outcome} cost=${result.costUsd.toFixed(4)}`)
  const status = result.outcome === 'planned' || result.outcome === 'refused' ? 200
    : result.outcome === 'cap_hit' ? 429 : result.outcome === 'model_unavailable' ? 503 : 500
  return NextResponse.json({ session_id: session.sessionId, run_id: result.runId, outcome: result.outcome, message: result.message,
    error: status === 200 ? undefined : result.message, plan: result.plan ? planForReview(result.plan, setup) : null }, { status })
})
