// src/lib/lead-alerts/run.ts
// Speed-to-lead: find new leads, queue one alert each, send the due ones. Called every minute by
// /api/cron/lead-alerts, and once by POST /api/lead-alerts/test.
//
// Config: org_settings 'hub_lead_alerts' = { enabled: 'on', recipient_user_id, since }. Missing, unreadable or not
// exactly 'on' means off. Leads older than `since`, or older than LOOKBACK_HOURS, never alert.
//
// Delivery: a Slack DM from the org's bot (a push on the phone) and an SMS through sendNotifySms (the one path that
// texts a staff member, at their own profile phone, after the consent gate). A channel that went out is never sent
// again; a send stuck mid-flight is recorded as outcome_unknown and never retried.
//
// Logs ids, counts and codes only: never a name, an email, a phone or the message text.
import type { SupabaseClient } from '@supabase/supabase-js'
import { alertDueAt, composeAlert, composeSlack, type LeadSource } from './compose'
import { collect, contactByEmail, loadFacts, universitySignups } from './sources'

export const LOOKBACK_HOURS = 6
export const MAX_ATTEMPTS = 3
export const STUCK_MINUTES = 10
export const SIGNUP_SOURCE_KEY = 'signup:university'

export interface AlertConfig { enabled: boolean; recipientUserId: string | null; since: string | null }

/** Pure: only the exact string 'on' turns alerts on, and only with a recipient. */
export function parseAlertConfig(raw: unknown): AlertConfig {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const rid = typeof v.recipient_user_id === 'string' && /^[0-9a-f-]{36}$/i.test(v.recipient_user_id) ? v.recipient_user_id : null
  const since = typeof v.since === 'string' && !Number.isNaN(Date.parse(v.since)) ? new Date(v.since).toISOString() : null
  return { enabled: v.enabled === 'on' && !!rid, recipientUserId: rid, since }
}

/** Pure: the earliest moment a lead may come from: the later of `since` and the lookback. */
export function windowStart(now: Date, since: string | null): string {
  const look = new Date(now.getTime() - LOOKBACK_HOURS * 3600_000)
  const s = since ? Date.parse(since) : NaN
  return !Number.isNaN(s) && s > look.getTime() ? new Date(s).toISOString() : look.toISOString()
}

export interface Senders {
  slack: (orgId: string, userId: string, text: string) => Promise<{ ok: boolean; code: string | null }>
  sms: (orgId: string, userId: string, text: string) => Promise<{ ok: boolean; retry: boolean; code: string | null }>
}

export interface RunDeps { db: SupabaseClient; now: () => Date; appUrl: string; senders: Senders }

async function config(db: SupabaseClient, orgId: string): Promise<AlertConfig> {
  const { data, error } = await db.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', 'hub_lead_alerts').maybeSingle()
  if (error) { console.error(`[lead-alerts] config read org=${orgId} failed: ${error.code ?? 'unknown'}; treated as off`); return parseAlertConfig(null) }
  return parseAlertConfig((data as any)?.setting_value)
}

/** Queue every new lead once. Returns how many rows were new. */
export async function enqueue(deps: RunDeps, orgId: string, since: string): Promise<number> {
  const { db } = deps
  const now = deps.now()
  const found = await collect(db, orgId, since)
  if (!found.length) return 0
  const rows = found.map((c) => ({
    org_id: orgId, source: c.source, source_id: c.source_id, contact_id: c.contact_id, occurred_at: c.occurred_at, starts_at: c.starts_at,
    due_at: alertDueAt(c.source, now, c.starts_at ? new Date(c.starts_at) : null).toISOString(),
  }))
  const { data, error } = await db.from('hub_lead_alerts').upsert(rows, { onConflict: 'org_id,source,source_id', ignoreDuplicates: true }).select('id')
  if (error) throw new Error(`queue write: ${error.code ?? 'unknown'}`)
  return data?.length ?? 0
}

/**
 * A University sign-up that has a Hub contact raises 'signup:university', which starts the "Signed up, no purchase"
 * campaign once its route is active. raise_entry_event queues nothing while no active route listens, and the
 * event id makes a repeat a no-op.
 */
export async function raiseSignupEntries(db: SupabaseClient, orgId: string, since: string): Promise<number> {
  const signups = await universitySignups(db, orgId, since)
  let raised = 0
  for (const s of signups) {
    const contactId = await contactByEmail(db, orgId, s.email)
    if (!contactId) continue
    const { data, error } = await db.rpc('raise_entry_event', { p_org: orgId, p_contact: contactId, p_source_key: SIGNUP_SOURCE_KEY,
      p_event_id: `university_signup:${s.source_id}`, p_origin: 'signup' })
    if (error) { console.error(`[lead-alerts] signup entry org=${orgId} failed: ${error.code ?? 'unknown'}`); continue }
    if (data === true) raised++
  }
  return raised
}

/** Send one claimed alert. Only the channels not already sent are tried. */
async function deliver(deps: RunDeps, cfg: AlertConfig, a: any): Promise<string> {
  const { db } = deps
  const loaded = await loadFacts(db, a)
  const finish = (patch: Record<string, unknown>) => db.from('hub_lead_alerts').update(patch).eq('id', a.id).eq('status', 'sending')
  if (!loaded) { await finish({ status: 'skipped', error_code: 'source_gone' }); return 'skipped_source_gone' }
  if (loaded.test) { await finish({ status: 'skipped', error_code: 'test_record', contact_id: loaded.facts.contactId }); return 'skipped_test_record' }

  const uid = cfg.recipientUserId!
  let push = a.push_status as string | null, sms = a.sms_status as string | null
  const codes: string[] = []
  let retry = false
  if (push !== 'sent') {
    const r = await deps.senders.slack(a.org_id, uid, composeSlack(loaded.facts, deps.appUrl))
    push = r.ok ? 'sent' : 'failed'
    if (!r.ok) { codes.push(`push:${r.code ?? 'unknown'}`); retry = true }
  }
  if (sms !== 'sent') {
    const r = await deps.senders.sms(a.org_id, uid, composeAlert(loaded.facts, deps.appUrl))
    sms = r.ok ? 'sent' : 'failed'
    if (!r.ok) { codes.push(`sms:${r.code ?? 'unknown'}`); retry = retry || r.retry }
    // a refused or partial SMS is final: resending could duplicate parts or be refused again
    if (!r.ok && !r.retry) sms = 'failed'
  }
  const attempts = (a.attempts ?? 0) + 1
  const both = push === 'sent' && sms === 'sent'
  const either = push === 'sent' || sms === 'sent'
  const again = !both && retry && attempts < MAX_ATTEMPTS
  const status = both ? 'sent' : again ? 'pending' : either ? 'partial' : 'failed'
  await finish({
    status, push_status: push, sms_status: sms, attempts, contact_id: loaded.facts.contactId,
    error_code: codes.length ? codes.join(' ').slice(0, 120) : null,
    sent_at: either ? new Date().toISOString() : null,
    ...(again ? { due_at: new Date(deps.now().getTime() + 60_000).toISOString(), claimed_at: null } : {}),
  })
  return status
}

/** Send every due alert for one org, one claim at a time. */
export async function dispatch(deps: RunDeps, orgId: string, cfg: AlertConfig, limit = 20): Promise<Record<string, number>> {
  const { db } = deps
  const now = deps.now()
  const counts: Record<string, number> = {}
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1 }

  // stuck mid-send: it may have gone out, so it is never retried
  const { data: stuck } = await db.from('hub_lead_alerts').update({ status: 'failed', error_code: 'outcome_unknown' })
    .eq('org_id', orgId).eq('status', 'sending').lt('claimed_at', new Date(now.getTime() - STUCK_MINUTES * 60_000).toISOString()).select('id')
  for (const r of stuck ?? []) { console.error(`[lead-alerts] alert=${(r as any).id} stuck in sending; recorded as outcome_unknown`); bump('outcome_unknown') }

  const { data: due, error } = await db.from('hub_lead_alerts').select('id')
    .eq('org_id', orgId).eq('status', 'pending').lte('due_at', now.toISOString()).order('due_at', { ascending: true }).limit(limit)
  if (error) throw new Error(`due read: ${error.code ?? 'unknown'}`)
  for (const d of due ?? []) {
    const { data: claimed } = await db.from('hub_lead_alerts').update({ status: 'sending', claimed_at: now.toISOString() })
      .eq('id', (d as any).id).eq('status', 'pending').select('*')
    if ((claimed?.length ?? 0) !== 1) { bump('not_claimed'); continue }
    try {
      bump(await deliver(deps, cfg, claimed![0]))
    } catch (e) {
      // before any send the facts read failed: free the claim so the next run tries again
      console.error(`[lead-alerts] alert=${(d as any).id} failed: ${String((e as Error)?.message ?? '').slice(0, 120)}`)
      await db.from('hub_lead_alerts').update({ status: 'pending', claimed_at: null }).eq('id', (d as any).id).eq('status', 'sending')
        .is('push_status', null).is('sms_status', null)
      bump('error')
    }
  }
  return counts
}

/** One cron run over every org with alerts on. */
export async function runLeadAlerts(deps: RunDeps): Promise<{ orgs: number; queued: number; signups: number; counts: Record<string, number> }> {
  const { db } = deps
  const { data: rows, error } = await db.from('org_settings').select('org_id, setting_value').eq('setting_key', 'hub_lead_alerts')
  if (error) throw new Error(`config read: ${error.code ?? 'unknown'}`)
  const out = { orgs: 0, queued: 0, signups: 0, counts: {} as Record<string, number> }
  for (const r of rows ?? []) {
    const orgId = (r as any).org_id as string
    const cfg = parseAlertConfig((r as any).setting_value)
    if (!cfg.enabled) continue
    out.orgs++
    const since = windowStart(deps.now(), cfg.since)
    try { out.queued += await enqueue(deps, orgId, since) } catch (e) { console.error(`[lead-alerts] queue org=${orgId}: ${(e as Error).message}`) }
    try { out.signups += await raiseSignupEntries(db, orgId, since) } catch (e) { console.error(`[lead-alerts] signups org=${orgId}: ${(e as Error).message}`) }
    const c = await dispatch(deps, orgId, cfg)
    for (const [k, v] of Object.entries(c)) out.counts[k] = (out.counts[k] ?? 0) + v
  }
  return out
}

/** Queue and send one test alert to the configured recipient, now, regardless of quiet hours. */
export async function sendTestAlert(deps: RunDeps, orgId: string): Promise<{ status: string; push: string | null; sms: string | null; code: string | null }> {
  const cfg = await config(deps.db, orgId)
  if (!cfg.recipientUserId) return { status: 'no_recipient', push: null, sms: null, code: null }
  const now = deps.now()
  const { data, error } = await deps.db.from('hub_lead_alerts').insert({
    org_id: orgId, source: 'test' as LeadSource, source_id: `test:${now.toISOString()}`, occurred_at: now.toISOString(), due_at: now.toISOString(),
    status: 'sending', claimed_at: now.toISOString(),
  }).select('*')
  if (error || (data?.length ?? 0) !== 1) throw new Error(`test queue write: ${error?.code ?? 'no row'}`)
  const status = await deliver(deps, cfg, data![0])
  const { data: after } = await deps.db.from('hub_lead_alerts').select('push_status, sms_status, error_code').eq('id', (data![0] as any).id).maybeSingle()
  return { status, push: (after as any)?.push_status ?? null, sms: (after as any)?.sms_status ?? null, code: (after as any)?.error_code ?? null }
}
