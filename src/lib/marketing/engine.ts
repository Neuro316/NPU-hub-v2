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
import { getFlags, type Flags } from './flags'
import { getSendPolicy, senderProblem } from './policy'
import { renderStep } from './render'
import { mintUnsubscribeToken, newAssetToken, byteaHex } from './tokens'
import type { EmailProvider, SmsProvider } from './providers/types'

export const STEP_LEASE_MINUTES = 10
export const RETRY_MINUTES = 15
export const MAX_SEND_ATTEMPTS = 3
export const ASSET_LINK_DAYS = 14
export const UNIVERSITY_ORIGIN = 'https://university.neuroprogeny.com'

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

async function advance(db: SupabaseClient, enr: any, now: Date): Promise<'advanced' | 'completed'> {
  const { data: next } = await db.from('sequence_steps').select('step_order, delay_minutes')
    .eq('sequence_id', enr.sequence_id).gt('step_order', enr.current_step)
    .order('step_order', { ascending: true }).limit(1)
  if (next && next.length) {
    await db.from('sequence_enrollments').update({
      current_step: next[0].step_order, next_step_at: minutes(now, next[0].delay_minutes || 0),
    }).eq('id', enr.id)
    return 'advanced'
  }
  await db.from('sequence_enrollments').update({ status: 'completed', completed_at: now.toISOString(), next_step_at: null }).eq('id', enr.id)
  await db.from('campaign_enrollments').update({ status: 'completed', ended_at: now.toISOString(), end_reason: 'sequence_finished' })
    .eq('id', enr.campaign_enrollment_id).eq('status', 'active')
  return 'completed'
}

export async function processCampaignSteps(deps: EngineDeps, limit = 25): Promise<StepOutcome[]> {
  const { db } = deps
  const now = deps.now()
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
      // the lease expires and the step is retried; claim_send stops a double send
    }
  }
  return out
}

async function runOne(deps: EngineDeps, enr: any, now: Date, flagCache: Map<string, Flags>): Promise<StepOutcome> {
  const { db } = deps
  const base = { enrollment: enr.id, step: enr.current_step as number }
  const { data: ce } = await db.from('campaign_enrollments').select('id, status, campaign_id, org_id').eq('id', enr.campaign_enrollment_id).maybeSingle()
  const { data: camp } = ce ? await db.from('funnel_campaigns').select('id, status, name').eq('id', ce.campaign_id).maybeSingle() : { data: null }
  if (!ce || !camp || ce.status !== 'active') {
    await db.from('sequence_enrollments').update({ status: 'completed', completed_at: now.toISOString(), next_step_at: null }).eq('id', enr.id)
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

  const { data: step } = await db.from('sequence_steps').select('*')
    .eq('sequence_id', enr.sequence_id).eq('step_order', enr.current_step).maybeSingle()
  if (!step) return { ...base, outcome: await advance(db, enr, now) }
  if (step.channel === 'wait' || step.channel === 'task') return { ...base, outcome: `${step.channel}_${await advance(db, enr, now)}` }

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

  const dedupe = stepDedupeKey(camp.id, ce.id, step.id)
  // a transient provider failure frees the claim; stop retrying after MAX_SEND_ATTEMPTS
  const { count: failed } = await db.from('message_sends').select('id', { count: 'exact', head: true })
    .eq('contact_id', g.contact_id ?? enr.contact_id).eq('dedupe_key', dedupe).eq('status', 'failed')
  if ((failed ?? 0) >= MAX_SEND_ATTEMPTS) return { ...base, outcome: `gave_up_${await advance(db, enr, now)}`, mode: g.mode }

  const { data: sendId, error: cErr } = await db.rpc('claim_send', {
    p_contact: enr.contact_id, p_channel: channel, p_kind: kind, p_dedupe_key: dedupe,
    p_source_kind: 'campaign', p_source_id: camp.id, p_step_id: step.id, p_mode: g.mode,
    p_to: g.to_address, p_subject: null, p_body: null, p_consent_event: g.consent_event_id,
    p_snapshot: { gate: g, step_type: step.step_type, step_order: step.step_order },
  })
  if (cErr) throw new Error(`claim_send failed: ${cErr.code ?? 'unknown'}`)
  if (!sendId) return { ...base, outcome: `already_claimed_${await advance(db, enr, now)}`, mode: g.mode }

  // ── render, now that the send id exists for the unsubscribe token ──
  const { data: contact } = await db.from('contacts').select('first_name, last_name, email, phone, pipeline_stage').eq('id', g.contact_id ?? enr.contact_id).maybeSingle()
  const { data: org } = await db.from('organizations').select('name').eq('id', orgId).maybeSingle()
  const token = channel === 'email' && kind === 'marketing' ? mintUnsubscribeToken(sendId as string) : null
  const unsubscribeUrl = token ? `${deps.appUrl.replace(/\/+$/, '')}/api/email/unsubscribe?t=${token}` : null

  let assetUrl: string | null = null
  if (step.step_type === 'deliver_asset') {
    const t = newAssetToken()
    const { data: grantId, error: aErr } = await db.rpc('grant_asset', {
      p_contact: enr.contact_id, p_asset: step.asset_id, p_token_hash: byteaHex(t.hash),
      p_ttl: `${ASSET_LINK_DAYS} days`, p_send: sendId,
    })
    if (aErr || !grantId) throw new Error(`grant_asset failed: ${aErr?.code ?? 'flag off'}`)
    assetUrl = assetLink(deps.appUrl, t.token)
  }
  const r = renderStep({
    channel, kind, subject: step.subject, body: step.body || '', contact: contact ?? ({} as any),
    orgName: org?.name ?? '', unsubscribeUrl, assetUrl,
  })
  await db.from('message_sends').update({ subject: r.subject || null, rendered_body: channel === 'email' ? r.html : r.text }).eq('id', sendId)

  if (g.mode === 'dry_run') {
    return { ...base, outcome: `dry_run_${await advance(db, enr, now)}`, mode: 'dry_run', send: sendId as string }
  }

  // ── live: provider gates, then the one send ──
  let res
  if (channel === 'email') {
    const policy = await getSendPolicy(db, orgId)
    const problem = !flags.provider_email ? 'provider_email_off' : !policy ? 'policy_unreadable'
      : senderProblem(policy) ?? (kind === 'marketing' && !unsubscribeUrl ? 'unsubscribe_secret_missing' : null)
    if (problem) {
      await db.from('message_sends').update({ status: 'skipped', skip_reason: problem }).eq('id', sendId).eq('status', 'sending')
      return { ...base, outcome: `skipped_${problem}_${await advance(db, enr, now)}`, mode: 'live', send: sendId as string }
    }
    res = await deps.email.send({ orgId, sendId: sendId as string, from: policy!.from_address, replyTo: policy!.reply_to,
      to: g.to_address!, subject: r.subject, html: r.html, text: r.text, unsubscribeUrl: unsubscribeUrl ?? undefined, kind })
  } else {
    res = await deps.sms.send({ orgId, sendId: sendId as string, to: g.to_address!, body: r.text })
  }

  if (res.ok) {
    await db.from('message_sends').update({ status: 'sent', provider: res.provider, external_message_id: res.externalId,
      sent_at: new Date().toISOString(), attempts: 1 }).eq('id', sendId).eq('status', 'sending')
    return { ...base, outcome: `sent_${await advance(db, enr, now)}`, mode: 'live', send: sendId as string }
  }
  await db.from('message_sends').update({ status: 'failed', provider: res.provider, error_code: res.code, attempts: 1 })
    .eq('id', sendId).eq('status', 'sending')
  if (res.permanent) return { ...base, outcome: `failed_permanent_${await advance(db, enr, now)}`, mode: 'live', send: sendId as string }
  await db.from('sequence_enrollments').update({ next_step_at: minutes(now, RETRY_MINUTES) }).eq('id', enr.id)
  return { ...base, outcome: 'failed_will_retry', mode: 'live', send: sendId as string }
}
