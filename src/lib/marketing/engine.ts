// src/lib/marketing/engine.ts
// Runs the steps of campaign-linked sequence enrollments. Sequences stay the only
// drip engine (ruling 6): this processes the same sequence_enrollments and
// sequence_steps tables, but ONLY rows whose campaign_enrollment_id is set, and
// every message goes through the send gate (public.gate_check) and the
// claim-then-send outbox (public.claim_send). The legacy /api/sequences/process-step
// excludes those rows, so no enrollment is ever handled by both.
//
// Never logs addresses or bodies: ids, steps, decisions and codes.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { SMS_PART_MAX } from '@/lib/sms-split'
import { getFlags, type Flags } from './flags'
import { getSendPolicy, senderProblem } from './policy'
import { mergeStage, renderStep } from './render'
import { mintUnsubscribeToken, newAssetToken, byteaHex } from './tokens'
import { endAsExited, exitReason, parseExitRules } from './exits'
import { BOOKING_TOKEN, CHECKOUT_TOKEN, applyLinks, checkoutUrl, parseEntryPaywalls, paywallEligible, usesToken } from './links'
import { discoveryBookingUrl, resolveCheckoutPaywall } from './checkout-link'
import type { EmailProvider, SmsProvider } from './providers/types'

export const STEP_LEASE_MINUTES = 10
export const RETRY_MINUTES = 15
export const MAX_SEND_ATTEMPTS = 3
export const ASSET_LINK_DAYS = 14
export const UNIVERSITY_ORIGIN = 'https://university.neuroprogeny.com'
/** A step whose rendered subject or body still holds a [[placeholder]] is never sent: staff must fill it first. */
export const PLACEHOLDER = /\[\[[^\]\n]{1,200}\]\]/

export interface EngineDeps {
  db: SupabaseClient
  email: EmailProvider
  sms: SmsProvider
  now: () => Date
  appUrl: string
}

export interface StepOutcome {
  enrollment: string
  step: number | null
  outcome: string
  mode?: string
  send?: string | null
}

type Gate = { decision: 'allow' | 'deny' | 'defer'; mode: 'live' | 'dry_run'; reason: string; step: string;
  to_address: string | null; consent_event_id: string | null; contact_id?: string; retry_at?: string }

const minutes = (d: Date, n: number) => new Date(d.getTime() + n * 60_000).toISOString()

/** Dedupe key for one step of one campaign enrollment: stable across retries. */
export function stepDedupeKey(campaignId: string, campaignEnrollmentId: string, stepId: string): string {
  return `campaign:${campaignId}:enr:${campaignEnrollmentId}:step:${stepId}`
}

export function assetLink(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/a/${token}`
}

/** Throws unless the write succeeded AND touched exactly one row (a zero-row update returns no error). */
async function one(q: PromiseLike<{ data: any; error: any }>, what: string): Promise<void> {
  const { data, error } = await q
  const n = Array.isArray(data) ? data.length : data ? 1 : 0
  if (error || n !== 1) throw new Error(`${what}: ${error ? `error ${error.code ?? 'unknown'}` : `matched ${n} rows`}`)
}

/**
 * {{pipeline_stage}} for one person: their stage from contact_pipeline_positions, in the campaign's entry pipeline
 * (see mergeStage). Read here rather than through src/lib/pipelines/positions.ts because this module is compiled
 * on its own by scripts/marketing/pure-tamper.cjs. Archived stages and pipelines name nothing. A read error throws.
 */
async function stageForMerge(db: SupabaseClient, orgId: string, contactId: string, pipelineId: string | null): Promise<string> {
  const { data: rows, error } = await db.from('contact_pipeline_positions').select('pipeline_id, stage_id').eq('org_id', orgId).eq('contact_id', contactId)
  if (error) throw new Error(`positions read: ${error.code ?? 'unknown'}`)
  if (!rows?.length) return ''
  const [{ data: st, error: sErr }, { data: ps, error: pErr }] = await Promise.all([
    db.from('pipeline_stages').select('id, name').in('id', rows.map((r: any) => r.stage_id)).is('archived_at', null),
    db.from('pipelines').select('id').in('id', rows.map((r: any) => r.pipeline_id)).is('archived_at', null),
  ])
  if (sErr || pErr) throw new Error(`stages read: ${(sErr ?? pErr)?.code ?? 'unknown'}`)
  const names = new Map((st ?? []).map((s: any) => [s.id as string, s.name as string]))
  const live = new Set((ps ?? []).map((p: any) => p.id as string))
  return mergeStage(rows.filter((r: any) => names.has(r.stage_id) && live.has(r.pipeline_id))
    .map((r: any) => ({ pipeline_id: r.pipeline_id, stage_name: names.get(r.stage_id)! })), pipelineId)
}

async function advance(db: SupabaseClient, enr: any, now: Date): Promise<'advanced' | 'completed'> {
  const { data: next, error } = await db.from('sequence_steps').select('step_order, delay_minutes')
    .eq('sequence_id', enr.sequence_id).gt('step_order', enr.current_step)
    .order('step_order', { ascending: true }).limit(1)
  if (error) throw new Error(`next step read failed: ${error.code ?? 'unknown'}`)
  if (next && next.length) {
    await one(db.from('sequence_enrollments').update({
      current_step: next[0].step_order, next_step_at: minutes(now, next[0].delay_minutes || 0),
    }).eq('id', enr.id).select('id'), 'advance')
    return 'advanced'
  }
  await one(db.from('sequence_enrollments').update({ status: 'completed', completed_at: now.toISOString(), next_step_at: null }).eq('id', enr.id).select('id'), 'complete')
  await db.from('campaign_enrollments').update({ status: 'completed', ended_at: now.toISOString(), end_reason: 'sequence_finished' })
    .eq('id', enr.campaign_enrollment_id).eq('status', 'active')
  return 'completed'
}

/** A campaign send left 'sending' this long had its outcome lost (a crash after the provider call). */
export const STUCK_SEND_MINUTES = 30

export async function processCampaignSteps(deps: EngineDeps, limit = 25): Promise<StepOutcome[]> {
  const { db } = deps
  const now = deps.now()
  // ── reaper: a send stuck in 'sending' may or may not have gone out. It is recorded as
  //    outcome_unknown and never retried, so nobody can receive it twice. ──
  const { data: reaped } = await db.from('message_sends')
    .update({ status: 'skipped', skip_reason: 'outcome_unknown' })
    .eq('status', 'sending').eq('source_kind', 'campaign').lt('claimed_at', minutes(now, -STUCK_SEND_MINUTES)).select('id')
  for (const r of reaped ?? []) console.error(`[engine] send=${r.id} stuck in sending; recorded as outcome_unknown, not retried`)

  const { data: due, error } = await db.from('sequence_enrollments')
    .select('id, sequence_id, contact_id, current_step, next_step_at, campaign_enrollment_id')
    .eq('status', 'active').not('campaign_enrollment_id', 'is', null)
    .lte('next_step_at', now.toISOString()).order('next_step_at', { ascending: true }).limit(limit)
  if (error) throw new Error(`due enrollments read failed: ${error.code ?? 'unknown'}`)

  const out: StepOutcome[] = []
  const flagCache = new Map<string, Flags>()
  for (const enr of due ?? []) {
    // ── lease: only the run that moves next_step_at owns this enrollment ──
    const { data: leased } = await db.from('sequence_enrollments')
      .update({ next_step_at: minutes(now, STEP_LEASE_MINUTES) })
      .eq('id', enr.id).eq('next_step_at', enr.next_step_at).eq('status', 'active').select('id')
    if ((leased?.length ?? 0) !== 1) { out.push({ enrollment: enr.id, step: enr.current_step, outcome: 'not_leased' }); continue }
    try {
      out.push(await runOne(deps, enr, now, flagCache))
    } catch (e: any) {
      console.error(`[engine] enrollment=${enr.id} step=${enr.current_step} threw ${e?.name ?? 'Error'}: ${String(e?.message ?? '').slice(0, 200)}`)
      out.push({ enrollment: enr.id, step: enr.current_step, outcome: 'error' })
      // the lease expires and the step is retried; the claim and the reaper stop a double send
    }
  }
  return out
}

async function runOne(deps: EngineDeps, enr: any, now: Date, flagCache: Map<string, Flags>): Promise<StepOutcome> {
  const { db } = deps
  const base = { enrollment: enr.id, step: enr.current_step as number }
  const { data: ce } = await db.from('campaign_enrollments').select('id, status, campaign_id, org_id, enrolled_at').eq('id', enr.campaign_enrollment_id).maybeSingle()
  const { data: camp } = ce ? await db.from('funnel_campaigns').select('id, status, name, entry_pipeline_id, entry_stage_id, goal').eq('id', ce.campaign_id).maybeSingle() : { data: null }
  if (!ce || !camp || ce.status !== 'active') {
    await one(db.from('sequence_enrollments').update({ status: 'completed', completed_at: now.toISOString(), next_step_at: null }).eq('id', enr.id).select('id'), 'end enrollment')
    return { ...base, outcome: 'campaign_enrollment_ended' }
  }
  if (camp.status !== 'active') {
    await db.from('sequence_enrollments').update({ next_step_at: minutes(now, 60) }).eq('id', enr.id)
    return { ...base, outcome: `campaign_${camp.status}` }
  }
  const orgId: string = ce.org_id
  if (!flagCache.has(orgId)) flagCache.set(orgId, await getFlags(db, orgId))
  const flags = flagCache.get(orgId)!
  if (!flags.engine) {
    await db.from('sequence_enrollments').update({ next_step_at: minutes(now, 60) }).eq('id', enr.id)
    return { ...base, outcome: 'engine_off' }
  }

  // ── exit rules (src/lib/marketing/exits.ts): checked before every step, so a person who paid, replied, moved on
  //    or cancelled is never sent another one. A read error throws and the step is retried, never sent. ──
  const exit = await exitReason(db, { orgId, contactId: enr.contact_id, enrolledAt: ce.enrolled_at,
    entryPipelineId: (camp as any).entry_pipeline_id ?? null, entryStageId: (camp as any).entry_stage_id ?? null }, parseExitRules((camp as any).goal))
  if (exit) {
    await endAsExited(db, ce.id, exit, now)
    return { ...base, outcome: `exited_${exit}` }
  }

  const { data: step } = await db.from('sequence_steps').select('*')
    .eq('sequence_id', enr.sequence_id).eq('step_order', enr.current_step).maybeSingle()
  if (!step) return { ...base, outcome: await advance(db, enr, now) }
  if (step.channel === 'wait' || step.channel === 'task') return { ...base, outcome: `${step.channel}_${await advance(db, enr, now)}` }

  // ── links (src/lib/marketing/links.ts). {{checkout_link}} and a campaign's entry paywall limit resolve from the
  //    person's most recent University seat hold; {{discovery_booking_url}} from one org setting. Nothing is guessed:
  //    an ineligible paywall ends the enrollment, an unresolved link skips the step (recorded below). ──
  const entryLimit = parseEntryPaywalls((camp as any).goal)
  const wantsCheckout = usesToken(CHECKOUT_TOKEN, step.subject, step.body)
  const links: Record<string, string> = {}
  let linkProblem: string | null = null
  if (entryLimit || wantsCheckout) {
    const { data: who, error: wErr } = await db.from('contacts').select('email').eq('id', enr.contact_id).maybeSingle()
    if (wErr) throw new Error(`checkout link contact read: ${wErr.code ?? 'unknown'}`)
    const pick = await resolveCheckoutPaywall(db, (who as any)?.email, ce.enrolled_at ?? null, now)
    if (pick.ok && !paywallEligible(pick.slug, entryLimit)) {
      await endAsExited(db, ce.id, 'paywall_not_eligible', now)
      return { ...base, outcome: 'exited_paywall_not_eligible' }
    }
    if (pick.ok) links[CHECKOUT_TOKEN] = checkoutUrl(pick.slug)!
    else linkProblem = `checkout_link_${pick.reason}`
  }
  if (usesToken(BOOKING_TOKEN, step.subject, step.body)) {
    const url = await discoveryBookingUrl(db, orgId)
    if (url) links[BOOKING_TOKEN] = url
    else linkProblem = linkProblem ?? 'booking_url_unset'
  }

  const channel = step.channel as 'email' | 'sms'
  const kind = (step.kind as 'marketing' | 'service' | null) ?? 'marketing'   // unlabelled steps are treated as marketing, the stricter rule
  const { data: gate, error: gErr } = await db.rpc('gate_check', {
    p_contact: enr.contact_id, p_channel: channel, p_kind: kind, p_campaign: camp.id, p_now: now.toISOString(),
  })
  if (gErr || !gate) throw new Error(`gate_check failed: ${gErr?.code ?? 'no result'}`)
  const g = gate as Gate
  if (g.decision === 'defer') {
    await db.from('sequence_enrollments').update({ next_step_at: g.retry_at ?? minutes(now, 60) }).eq('id', enr.id)
    return { ...base, outcome: `defer_${g.reason}`, mode: g.mode }
  }
  if (g.decision === 'deny') return { ...base, outcome: `deny_${g.reason}_${await advance(db, enr, now)}`, mode: g.mode }

  if (step.step_type === 'deliver_asset' && (!flags.deliver_asset || !step.asset_id)) {
    return { ...base, outcome: `deliver_asset_unavailable_${await advance(db, enr, now)}`, mode: g.mode }
  }

  const contactId: string = g.contact_id ?? enr.contact_id
  const dedupe = stepDedupeKey(camp.id, ce.id, step.id)
  const { data: prior } = await db.from('message_sends').select('status, skip_reason')
    .eq('contact_id', contactId).eq('dedupe_key', dedupe).in('status', ['failed', 'skipped'])
  // an earlier attempt whose outcome is unknown may have reached the person: never retry it
  if ((prior ?? []).some((x: any) => x.skip_reason === 'outcome_unknown')) {
    return { ...base, outcome: `outcome_unknown_not_retried_${await advance(db, enr, now)}`, mode: g.mode }
  }
  // a transient provider failure frees the claim; stop retrying after MAX_SEND_ATTEMPTS
  if ((prior ?? []).filter((x: any) => x.status === 'failed').length >= MAX_SEND_ATTEMPTS) {
    return { ...base, outcome: `gave_up_${await advance(db, enr, now)}`, mode: g.mode }
  }

  const { data: sendId, error: cErr } = await db.rpc('claim_send', {
    p_contact: enr.contact_id, p_channel: channel, p_kind: kind, p_dedupe_key: dedupe,
    p_source_kind: 'campaign', p_source_id: camp.id, p_step_id: step.id, p_mode: g.mode,
    p_to: g.to_address, p_subject: null, p_body: null, p_consent_event: g.consent_event_id,
    p_snapshot: { gate: g, step_type: step.step_type, step_order: step.step_order },
  })
  if (cErr) throw new Error(`claim_send failed: ${cErr.code ?? 'unknown'}`)
  if (!sendId) return { ...base, outcome: `already_claimed_${await advance(db, enr, now)}`, mode: g.mode }
  const sid = sendId as string

  // Everything before the provider call can fail safely: the row is marked failed (which
  // frees the claim) and the step is retried. After the provider call a failure leaves the
  // row 'sending' and the reaper records it as outcome_unknown, so it is never resent.
  let providerCalled = false
  try {
    const { data: contact } = await db.from('contacts').select('first_name, last_name, email, phone').eq('id', contactId).maybeSingle()
    // {{pipeline_stage}}: the person's stage in the campaign's entry pipeline, from contact_pipeline_positions.
    // Read only when the step names it; a read failure fails the step before the provider call, so it is retried.
    const stageName = /\{\{pipeline_stage\}\}/.test(`${step.subject ?? ''} ${step.body ?? ''}`)
      ? await stageForMerge(db, orgId, contactId, (camp as any).entry_pipeline_id ?? null)
      : ''
    const { data: org } = await db.from('organizations').select('name').eq('id', orgId).maybeSingle()
    const token = channel === 'email' && kind === 'marketing' ? mintUnsubscribeToken(sid) : null
    const unsubscribeUrl = token ? `${deps.appUrl.replace(/\/+$/, '')}/api/email/unsubscribe?t=${token}` : null

    let assetUrl: string | null = null
    if (step.step_type === 'deliver_asset') {
      const t = newAssetToken()
      const { data: grantId, error: aErr } = await db.rpc('grant_asset', {
        p_contact: enr.contact_id, p_asset: step.asset_id, p_token_hash: byteaHex(t.hash),
        p_ttl: `${ASSET_LINK_DAYS} days`, p_send: sid,
      })
      if (aErr || !grantId) throw new Error(`grant_asset failed: ${aErr?.code ?? 'flag off'}`)
      assetUrl = assetLink(deps.appUrl, t.token)
    }
    const r = renderStep({
      channel, kind, subject: applyLinks(step.subject ?? '', links) || null, body: applyLinks(step.body || '', links), contact: { ...(contact ?? ({} as any)), stage_name: stageName },
      orgName: org?.name ?? '', unsubscribeUrl, assetUrl,
    })
    await one(db.from('message_sends').update({ subject: r.subject || null, rendered_body: channel === 'email' ? r.html : r.text })
      .eq('id', sid).select('id'), 'store rendered message')

    // a link that could not be resolved is never sent with a fallback, live or dry run
    if (linkProblem) {
      console.warn(`[engine] send=${sid} campaign=${camp.id} skipped: ${linkProblem}`)
      await one(db.from('message_sends').update({ status: 'skipped', skip_reason: linkProblem }).eq('id', sid).select('id'), 'mark link unresolved')
      return { ...base, outcome: `skipped_${linkProblem}_${await advance(db, enr, now)}`, mode: g.mode, send: sid }
    }

    // an unfilled [[placeholder]] is never sent, live or dry run, so a dry run shows the same refusal
    if (PLACEHOLDER.test(`${r.subject}\n${r.text}`)) {
      await one(db.from('message_sends').update({ status: 'skipped', skip_reason: 'unfilled_placeholder' }).eq('id', sid).select('id'), 'mark placeholder')
      return { ...base, outcome: `skipped_unfilled_placeholder_${await advance(db, enr, now)}`, mode: g.mode, send: sid }
    }

    // checked after merge tags and the STOP line, so a dry run shows what a live send would hit
    if (channel === 'sms' && r.text.length > SMS_PART_MAX) {
      await one(db.from('message_sends').update({ status: 'skipped', skip_reason: 'sms_too_long' }).eq('id', sid).select('id'), 'mark too long')
      return { ...base, outcome: `skipped_sms_too_long_${await advance(db, enr, now)}`, mode: g.mode, send: sid }
    }
    if (g.mode === 'dry_run') {
      return { ...base, outcome: `dry_run_${await advance(db, enr, now)}`, mode: 'dry_run', send: sid }
    }

    // ── live: provider gates, then the one send ──
    let problem: string | null = null
    let policy: Awaited<ReturnType<typeof getSendPolicy>> = null
    if (channel === 'email') {
      policy = await getSendPolicy(db, orgId)
      problem = !flags.provider_email ? 'provider_email_off' : !policy ? 'policy_unreadable'
        : senderProblem(policy) ?? (kind === 'marketing' && !unsubscribeUrl ? 'unsubscribe_secret_missing' : null)
    } else if (!flags.provider_sms) problem = 'provider_sms_off'
    if (problem) {
      await one(db.from('message_sends').update({ status: 'skipped', skip_reason: problem }).eq('id', sid).eq('status', 'sending').select('id'), 'mark skipped')
      return { ...base, outcome: `skipped_${problem}_${await advance(db, enr, now)}`, mode: 'live', send: sid }
    }
    providerCalled = true
    const res = channel === 'email'
      ? await deps.email.send({ orgId, sendId: sid, idempotencyKey: emailIdempotencyKey(contactId, dedupe), from: policy!.from_address,
          replyTo: policy!.reply_to, to: g.to_address!, subject: r.subject, html: r.html, text: r.text, unsubscribeUrl: unsubscribeUrl ?? undefined, kind })
      : await deps.sms.send({ orgId, sendId: sid, to: g.to_address!, body: r.text })

    if (res.ok) {
      await one(db.from('message_sends').update({ status: 'sent', provider: res.provider, external_message_id: res.externalId,
        sent_at: new Date().toISOString(), attempts: 1 }).eq('id', sid).eq('status', 'sending').select('id'), 'mark sent')
      return { ...base, outcome: `sent_${await advance(db, enr, now)}`, mode: 'live', send: sid }
    }
    // An SMS whose request may have reached Twilio cannot be retried safely (Twilio has no
    // idempotency key), so it is recorded as outcome_unknown. An email can be retried: the
    // idempotency key is the same on every attempt, so Resend sends it at most once.
    if (res.ambiguous && channel === 'sms') {
      await one(db.from('message_sends').update({ status: 'skipped', skip_reason: 'outcome_unknown', provider: res.provider, error_code: res.code })
        .eq('id', sid).eq('status', 'sending').select('id'), 'mark outcome unknown')
      return { ...base, outcome: `outcome_unknown_${await advance(db, enr, now)}`, mode: 'live', send: sid }
    }
    await one(db.from('message_sends').update({ status: 'failed', provider: res.provider, error_code: res.code, attempts: 1 })
      .eq('id', sid).eq('status', 'sending').select('id'), 'mark failed')
    if (res.permanent) return { ...base, outcome: `failed_permanent_${await advance(db, enr, now)}`, mode: 'live', send: sid }
    await db.from('sequence_enrollments').update({ next_step_at: minutes(now, RETRY_MINUTES) }).eq('id', enr.id)
    return { ...base, outcome: 'failed_will_retry', mode: 'live', send: sid }
  } catch (e) {
    if (!providerCalled) {
      await db.from('message_sends').update({ status: 'failed', error_code: 'engine_error' }).eq('id', sid).eq('status', 'sending')
    }
    throw e
  }
}

/** Stable across retries of one step for one person, so Resend delivers it at most once. */
export function emailIdempotencyKey(contactId: string, dedupeKey: string): string {
  return `hub-${createHash('sha256').update(`${contactId}|${dedupeKey}`).digest('hex').slice(0, 48)}`
}
