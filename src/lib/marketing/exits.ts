// src/lib/marketing/exits.ts
// Campaign exit rules. A campaign's rules live in funnel_campaigns.goal.exit (no schema change):
//
//   left_entry_stage   true: the person is no longer at the campaign's entry stage in its entry pipeline
//                      (moved to another stage of it, or taken out of it)
//   stages             [stage uuid, ...]: the person has reached any of these stages, in any pipeline
//   payment            'since_entry' | 'any': a completed payment (University Stripe payments, Hub accounting
//                      payments, Hub contact payments), since they entered (less PAYMENT_GRACE_MINUTES) or ever
//   enrollment         'any': a University enrollment exists for their email
//   reply              true: an inbound text or email from them since they entered
//   booking_cancelled  true: their latest booking is cancelled
//
// The engine checks these before EVERY step, before the send gate, so a person who meets one is never sent another
// email: the campaign enrollment ends as 'exited' with end_reason 'exit_<rule>'. sweepCampaignExits ends active
// enrollments between steps, so the status is current within one cron run.
//
// READS ONLY. University tables (profiles, payments, enrollments, nr_bookings, nr_booking_leads) are read, never
// written. Never logs an address: ids and rule names only. A read error throws, so the step is retried, never sent.
import type { SupabaseClient } from '@supabase/supabase-js'

export const PAYMENT_GRACE_MINUTES = 60

export interface ExitRules {
  left_entry_stage?: boolean
  stages?: string[]
  payment?: 'since_entry' | 'any'
  enrollment?: 'any'
  reply?: boolean
  booking_cancelled?: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Pure: the rules in a campaign's goal, with anything malformed dropped (never widened). */
export function parseExitRules(goal: unknown): ExitRules {
  const e = goal && typeof goal === 'object' ? (goal as any).exit : null
  if (!e || typeof e !== 'object') return {}
  const out: ExitRules = {}
  if (e.left_entry_stage === true) out.left_entry_stage = true
  if (Array.isArray(e.stages)) { const s = e.stages.filter((x: unknown) => typeof x === 'string' && UUID.test(x)); if (s.length) out.stages = s }
  if (e.payment === 'since_entry' || e.payment === 'any') out.payment = e.payment
  if (e.enrollment === 'any') out.enrollment = 'any'
  if (e.reply === true) out.reply = true
  if (e.booking_cancelled === true) out.booking_cancelled = true
  return out
}

export function hasExitRules(r: ExitRules): boolean { return Object.keys(r).length > 0 }

export interface ExitSubject {
  orgId: string
  contactId: string
  enrolledAt: string
  entryPipelineId: string | null
  entryStageId: string | null
}

const err = (what: string, e: { code?: string } | null) => new Error(`exit ${what} read: ${e?.code ?? 'unknown'}`)

async function contactEmail(db: SupabaseClient, contactId: string): Promise<string | null> {
  const { data, error } = await db.from('contacts').select('email').eq('id', contactId).maybeSingle()
  if (error) throw err('contact', error)
  const e = String((data as any)?.email ?? '').trim().toLowerCase()
  return e.includes('@') ? e : null
}

const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)

async function profileIds(db: SupabaseClient, email: string | null): Promise<string[]> {
  if (!email) return []
  const { data, error } = await db.from('profiles').select('id').ilike('email', likeExact(email)).limit(5)
  if (error) throw err('profiles', error)
  return (data ?? []).map((p: any) => p.id as string)
}

async function paid(db: SupabaseClient, s: ExitSubject, email: string | null, since: string | null): Promise<boolean> {
  const pids = await profileIds(db, email)
  if (pids.length) {
    let q = db.from('payments').select('id').in('participant_id', pids).eq('status', 'succeeded')
    if (since) q = q.gte('created_at', since)
    const { data, error } = await q.limit(1)
    if (error) throw err('payments', error)
    if (data?.length) return true
  }
  let cp = db.from('contact_payments').select('id').eq('contact_id', s.contactId).not('paid_at', 'is', null)
  if (since) cp = cp.gte('paid_at', since)
  const { data: c, error: cErr } = await cp.limit(1)
  if (cErr) throw err('contact_payments', cErr)
  if (c?.length) return true
  const { data: clients, error: kErr } = await db.from('acct_clients').select('id').eq('org_id', s.orgId)
    .or(`crm_contact_id.eq.${s.contactId},enrolled_contact_id.eq.${s.contactId}`)
  if (kErr) throw err('acct_clients', kErr)
  if (clients?.length) {
    let ap = db.from('acct_payments').select('id').in('client_id', clients.map((k: any) => k.id))
    if (since) ap = ap.gte('created_at', since)
    const { data: a, error: aErr } = await ap.limit(1)
    if (aErr) throw err('acct_payments', aErr)
    if (a?.length) return true
  }
  return false
}

async function replied(db: SupabaseClient, s: ExitSubject, email: string | null): Promise<boolean> {
  const { data: convs, error } = await db.from('conversations').select('id').eq('contact_id', s.contactId)
  if (error) throw err('conversations', error)
  if (convs?.length) {
    const { data, error: mErr } = await db.from('crm_messages').select('id').in('conversation_id', convs.map((c: any) => c.id))
      .eq('direction', 'inbound').gte('created_at', s.enrolledAt).limit(1)
    if (mErr) throw err('crm_messages', mErr)
    if (data?.length) return true
  }
  if (email) {
    const { data: conns, error: cErr } = await db.from('hub_mail_connections').select('id').eq('org_id', s.orgId)
    if (cErr) throw err('hub_mail_connections', cErr)
    if (conns?.length) {
      const { data, error: hErr } = await db.from('hub_mail_messages').select('id').in('connection_id', conns.map((c: any) => c.id))
        .ilike('from_address', likeExact(email)).gte('received_at', s.enrolledAt).limit(1)
      if (hErr) throw err('hub_mail_messages', hErr)
      if (data?.length) return true
    }
  }
  return false
}

async function latestBookingCancelled(db: SupabaseClient, s: ExitSubject, email: string | null): Promise<boolean> {
  const { data: syncs, error } = await db.from('hub_booking_syncs').select('status, first_synced_at').eq('contact_id', s.contactId)
    .order('first_synced_at', { ascending: false }).limit(1)
  if (error) throw err('hub_booking_syncs', error)
  if (syncs?.length) return (syncs[0] as any).status === 'cancelled'
  if (!email) return false
  const pids = await profileIds(db, email)
  const { data: leads, error: lErr } = await db.from('nr_booking_leads').select('id').eq('org_id', s.orgId).ilike('email', likeExact(email)).limit(5)
  if (lErr) throw err('nr_booking_leads', lErr)
  const ors = [...pids.map((p) => `participant_id.eq.${p}`), ...(leads ?? []).map((l: any) => `lead_id.eq.${l.id}`)]
  if (!ors.length) return false
  const { data: b, error: bErr } = await db.from('nr_bookings').select('status').eq('org_id', s.orgId).or(ors.join(','))
    .order('created_at', { ascending: false }).limit(1)
  if (bErr) throw err('nr_bookings', bErr)
  return !!b?.length && (b[0] as any).status === 'cancelled'
}

/** The first rule the person meets, or null. Cheap rules first. */
export async function exitReason(db: SupabaseClient, s: ExitSubject, rules: ExitRules): Promise<string | null> {
  if (!hasExitRules(rules)) return null
  if (rules.left_entry_stage || rules.stages) {
    const { data: pos, error } = await db.from('contact_pipeline_positions').select('pipeline_id, stage_id').eq('org_id', s.orgId).eq('contact_id', s.contactId)
    if (error) throw err('positions', error)
    const rows = (pos ?? []) as Array<{ pipeline_id: string; stage_id: string }>
    if (rules.stages && rows.some((p) => rules.stages!.includes(p.stage_id))) return 'stage_reached'
    if (rules.left_entry_stage && s.entryPipelineId && s.entryStageId) {
      const here = rows.find((p) => p.pipeline_id === s.entryPipelineId)
      if (!here || here.stage_id !== s.entryStageId) return 'left_entry_stage'
    }
  }
  const needEmail = !!(rules.payment || rules.enrollment || rules.reply || rules.booking_cancelled)
  const email = needEmail ? await contactEmail(db, s.contactId) : null
  if (rules.payment) {
    const since = rules.payment === 'any' ? null : new Date(Date.parse(s.enrolledAt) - PAYMENT_GRACE_MINUTES * 60_000).toISOString()
    if (await paid(db, s, email, since)) return 'payment'
  }
  if (rules.enrollment) {
    const pids = await profileIds(db, email)
    if (pids.length) {
      const { data, error } = await db.from('enrollments').select('id').in('user_id', pids).limit(1)
      if (error) throw err('enrollments', error)
      if (data?.length) return 'enrollment'
    }
  }
  if (rules.reply && await replied(db, s, email)) return 'reply'
  if (rules.booking_cancelled && await latestBookingCancelled(db, s, email)) return 'booking_cancelled'
  return null
}

/** End one campaign enrollment and its sequence enrollment as exited. */
export async function endAsExited(db: SupabaseClient, campaignEnrollmentId: string, reason: string, now: Date): Promise<void> {
  const at = now.toISOString()
  const { error: sErr } = await db.from('sequence_enrollments').update({ status: 'completed', completed_at: at, next_step_at: null })
    .eq('campaign_enrollment_id', campaignEnrollmentId).eq('status', 'active')
  if (sErr) throw new Error(`exit sequence end: ${sErr.code ?? 'unknown'}`)
  const { error: cErr } = await db.from('campaign_enrollments').update({ status: 'exited', ended_at: at, end_reason: `exit_${reason}` })
    .eq('id', campaignEnrollmentId).eq('status', 'active')
  if (cErr) throw new Error(`exit campaign end: ${cErr.code ?? 'unknown'}`)
}

/** Between steps: end active enrollments of campaigns with exit rules whose person now meets one. */
export async function sweepCampaignExits(db: SupabaseClient, now: Date, limit = 100): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  const { data: camps, error } = await db.from('funnel_campaigns').select('id, org_id, goal, entry_pipeline_id, entry_stage_id').eq('status', 'active')
  if (error) throw new Error(`exit sweep campaigns read: ${error.code ?? 'unknown'}`)
  let budget = limit
  for (const c of camps ?? []) {
    const rules = parseExitRules((c as any).goal)
    if (!hasExitRules(rules) || budget <= 0) continue
    const { data: ens, error: eErr } = await db.from('campaign_enrollments').select('id, contact_id, enrolled_at')
      .eq('campaign_id', (c as any).id).eq('status', 'active').order('enrolled_at', { ascending: true }).limit(budget)
    if (eErr) throw new Error(`exit sweep enrollments read: ${eErr.code ?? 'unknown'}`)
    for (const e of ens ?? []) {
      budget--
      try {
        const why = await exitReason(db, { orgId: (c as any).org_id, contactId: (e as any).contact_id, enrolledAt: (e as any).enrolled_at,
          entryPipelineId: (c as any).entry_pipeline_id, entryStageId: (c as any).entry_stage_id }, rules)
        if (!why) continue
        await endAsExited(db, (e as any).id, why, now)
        counts[why] = (counts[why] ?? 0) + 1
      } catch (x) {
        console.error(`[exits] enrollment=${(e as any).id} ${String((x as Error)?.message ?? '').slice(0, 120)}`)
        counts.error = (counts.error ?? 0) + 1
      }
    }
  }
  return counts
}
