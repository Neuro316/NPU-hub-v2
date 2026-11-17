// src/lib/lifecycle/scan.ts
// Where lifecycle events come from. READS ONLY on University tables (nr_bookings, funnel_events, programs, paywalls,
// profiles, enrollments, lesson_progress, practice_sessions, hrv_sessions, activity_events): never written. Contacts
// are matched by email in the Hub org and never created here; a University user with no Hub contact is skipped.
//
// Every event is keyed so that seeing it again is a no-op (see ledger.ts). Each scan looks back LOOKBACK_DAYS.
import type { SupabaseClient } from '@supabase/supabase-js'
import { contactByEmail } from '@/lib/lead-alerts/sources'
import { leadChannel, SCORECARD_CHANNELS } from '@/lib/metrics/collect'
import { bookingComplete } from '@/lib/bookings/placement'
import { recordEvent, closeTasks, type LifecycleEvent } from './ledger'
import {
  classifyProduct, inactivityDue, inactivityKey, INACTIVE_DAYS, leadOwedTask, CHECKOUT_UNPAID_HOURS, HELD_NO_PURCHASE_DAYS,
  type Brand, type LifecycleConfig, type TypeRoute,
} from './rules'

export const LOOKBACK_DAYS = 14
const MAX_ROWS = 500
const DAY = 86_400_000
const fail = (what: string, e: { code?: string } | null) => new Error(`${what} read: ${e?.code ?? 'unknown'}`)
const iso = (t: number) => new Date(t).toISOString()

export interface ScanCtx {
  db: SupabaseClient
  orgId: string
  cfg: LifecycleConfig
  routes: Map<string, TypeRoute>
  now: number
  deadline: number
  counts: Record<string, number>
}

const bump = (ctx: ScanCtx, k: string) => { ctx.counts[k] = (ctx.counts[k] ?? 0) + 1 }

async function emit(ctx: ScanCtx, e: Omit<LifecycleEvent, 'orgId'>) {
  const r = await recordEvent(ctx.db, ctx.cfg, { ...e, orgId: ctx.orgId })
  if (r === 'new') bump(ctx, e.type)
}

/** University user ids to Hub contact ids in this org, by profile email. Unmatched users are left out. */
async function contactsForUsers(ctx: ScanCtx, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  if (!ids.length) return out
  const { data, error } = await ctx.db.from('profiles').select('id, email').in('id', ids)
  if (error) throw fail('profiles', error)
  for (const p of data ?? []) {
    const c = await contactByEmail(ctx.db, ctx.orgId, (p as any).email)
    if (c) out.set((p as any).id, c)
    else bump(ctx, 'unmatched_user')
  }
  return out
}

const brandOfType = (ctx: ScanCtx, typeId: string, typeName: string | null, bookingOrg: string | null): Brand =>
  ctx.routes.get(typeId)?.brand ?? ((ctx.cfg.wnwOrg && bookingOrg === ctx.cfg.wnwOrg) || /\bwnw\b|waynesville/i.test(typeName ?? '') ? 'wnw' : 'np')

const isDiscovery = (ctx: ScanCtx, typeId: string, typeName: string | null) =>
  ctx.routes.get(typeId)?.kind === 'lead' || /discovery/i.test(typeName ?? '')

/** Discovery bookings, from the booking sync's own record (hub_booking_syncs): made, held, missed, cancelled. */
export async function scanDiscoveryBookings(ctx: ScanCtx) {
  const since = iso(ctx.now - LOOKBACK_DAYS * DAY)
  const { data, error } = await ctx.db.from('hub_booking_syncs')
    .select('booking_id, contact_id, appointment_type_id, appointment_type, starts_at, ends_at, status, first_synced_at')
    .eq('org_id', ctx.orgId).not('contact_id', 'is', null).gte('last_synced_at', since).limit(MAX_ROWS)
  if (error) throw fail('hub_booking_syncs', error)
  for (const b of (data ?? []) as any[]) {
    if (Date.now() > ctx.deadline) return
    if (!isDiscovery(ctx, b.appointment_type_id, b.appointment_type)) continue
    const base = { contactId: b.contact_id, source: 'nr_bookings', sourceId: b.booking_id, detail: { brand: brandOfType(ctx, b.appointment_type_id, b.appointment_type, null) } }
    await emit(ctx, { ...base, type: 'booking_made', key: `booking:${b.booking_id}:made`, occurredAt: b.first_synced_at })
    if (b.status === 'no_show') await emit(ctx, { ...base, type: 'booking_no_show', key: `booking:${b.booking_id}:no_show`, occurredAt: b.ends_at ?? b.starts_at })
    else if (b.status === 'cancelled') await emit(ctx, { ...base, type: 'booking_cancelled', key: `booking:${b.booking_id}:cancelled`, occurredAt: iso(ctx.now) })
    else if (bookingComplete(b, new Date(ctx.now))) await emit(ctx, { ...base, type: 'booking_held', key: `booking:${b.booking_id}:held`, occurredAt: b.ends_at ?? b.starts_at })
  }
}

/** Coaching sessions (activity routes): activity on an existing client, never a lead and never a new contact. */
export async function scanCoachingBookings(ctx: ScanCtx) {
  const types = Array.from(ctx.routes.entries()).filter(([, r]) => r.kind === 'activity').map(([id]) => id)
  if (!types.length) return
  const { data, error } = await ctx.db.from('nr_bookings').select('id, org_id, participant_id, starts_at, ends_at, status, created_at')
    .in('appointment_type_id', types).in('org_id', ctx.cfg.sourceOrgs).not('participant_id', 'is', null)
    .gte('updated_at', iso(ctx.now - LOOKBACK_DAYS * DAY)).limit(MAX_ROWS)
  if (error) throw fail('nr_bookings', error)
  const rows = (data ?? []) as any[]
  const who = await contactsForUsers(ctx, rows.map((r) => r.participant_id))
  for (const b of rows) {
    if (Date.now() > ctx.deadline) return
    const contactId = who.get(b.participant_id)
    if (!contactId || b.status === 'cancelled' || b.status === 'released' || b.status === 'payment_failed') continue
    const base = { contactId, source: 'nr_bookings', sourceId: b.id }
    await emit(ctx, { ...base, type: 'coaching_booked', key: `booking:${b.id}:coaching_booked`, occurredAt: b.created_at })
    if (bookingComplete(b, new Date(ctx.now))) await emit(ctx, { ...base, type: 'coaching_held', key: `booking:${b.id}:coaching_held`, occurredAt: b.ends_at ?? b.starts_at })
  }
}

const FUNNEL_STEPS: Record<string, LifecycleEvent['type']> = {
  checkout_opened: 'checkout_started', payment_succeeded: 'purchase', consent_signed: 'consent_signed', first_lesson_opened: 'first_lesson_opened',
}

/** The University's funnel events: checkout opened, payment, consent signed, first lesson opened. */
export async function scanFunnel(ctx: ScanCtx) {
  const { data, error } = await ctx.db.from('funnel_events').select('id, occurred_at, org_id, user_id, program_id, paywall_id, step')
    .in('org_id', ctx.cfg.sourceOrgs).in('step', Object.keys(FUNNEL_STEPS)).not('user_id', 'is', null)
    .gte('occurred_at', iso(ctx.now - LOOKBACK_DAYS * DAY)).order('occurred_at', { ascending: true }).limit(MAX_ROWS)
  if (error) throw fail('funnel_events', error)
  const rows = (data ?? []) as any[]
  if (!rows.length) return
  const who = await contactsForUsers(ctx, rows.map((r) => r.user_id))
  const programIds = Array.from(new Set(rows.map((r) => r.program_id).filter(Boolean)))
  const paywallIds = Array.from(new Set(rows.map((r) => r.paywall_id).filter(Boolean)))
  const [{ data: progs, error: pErr }, { data: walls, error: wErr }] = await Promise.all([
    programIds.length ? ctx.db.from('programs').select('id, name').in('id', programIds) : Promise.resolve({ data: [], error: null } as any),
    paywallIds.length ? ctx.db.from('paywalls').select('id, slug').in('id', paywallIds) : Promise.resolve({ data: [], error: null } as any),
  ])
  if (pErr) throw fail('programs', pErr)
  if (wErr) throw fail('paywalls', wErr)
  const progName = new Map<string, string>((progs ?? []).map((p: any) => [p.id, p.name as string]))
  const wallSlug = new Map<string, string>((walls ?? []).map((w: any) => [w.id, w.slug as string]))
  for (const f of rows) {
    if (Date.now() > ctx.deadline) return
    const contactId = who.get(f.user_id)
    if (!contactId) continue
    const type = FUNNEL_STEPS[f.step]
    const product = classifyProduct({ programName: progName.get(f.program_id), paywallSlug: wallSlug.get(f.paywall_id), orgId: f.org_id }, ctx.cfg.wnwOrg)
    await emit(ctx, { contactId, type, key: `funnel:${f.id}`, occurredAt: f.occurred_at, source: 'funnel_events', sourceId: f.id,
      detail: type === 'purchase' || type === 'checkout_started' ? { product, program_id: f.program_id ?? null } : { program_id: f.program_id ?? null } })
  }
}

/** Ledger rows of one type, for the timed follow-ups that are measured from them. */
async function ledgerRows(ctx: ScanCtx, type: string, from: number, to: number) {
  const { data, error } = await ctx.db.from('hub_lifecycle_events').select('id, contact_id, event_key, occurred_at, detail')
    .eq('org_id', ctx.orgId).eq('event_type', type).gte('occurred_at', iso(from)).lte('occurred_at', iso(to)).limit(MAX_ROWS)
  if (error) throw fail('hub_lifecycle_events', error)
  return (data ?? []) as any[]
}

async function hasEventSince(ctx: ScanCtx, contactId: string, type: string, sinceIso: string) {
  const { data, error } = await ctx.db.from('hub_lifecycle_events').select('id').eq('org_id', ctx.orgId).eq('contact_id', contactId)
    .eq('event_type', type).gte('occurred_at', sinceIso).limit(1)
  if (error) throw fail('hub_lifecycle_events', error)
  return !!data?.length
}

/** Checkout started and no purchase an hour later; a discovery call held and no purchase two days later. */
export async function scanTimedFollowUps(ctx: ScanCtx) {
  const from = ctx.now - LOOKBACK_DAYS * DAY
  for (const c of await ledgerRows(ctx, 'checkout_started', from, ctx.now - CHECKOUT_UNPAID_HOURS * 3_600_000)) {
    if (Date.now() > ctx.deadline) return
    if (await hasEventSince(ctx, c.contact_id, 'purchase', c.occurred_at)) continue
    await emit(ctx, { contactId: c.contact_id, type: 'checkout_unpaid_1h', key: `checkout_unpaid:${c.event_key}`, occurredAt: iso(Date.parse(c.occurred_at) + CHECKOUT_UNPAID_HOURS * 3_600_000),
      source: 'hub_lifecycle_events', sourceId: c.id, detail: { product: c.detail?.product ?? null } })
  }
  for (const h of await ledgerRows(ctx, 'booking_held', from, ctx.now - HELD_NO_PURCHASE_DAYS * DAY)) {
    if (Date.now() > ctx.deadline) return
    if (await hasEventSince(ctx, h.contact_id, 'purchase', h.occurred_at)) continue
    await emit(ctx, { contactId: h.contact_id, type: 'held_no_purchase_2d', key: `held_no_purchase:${h.event_key}`, occurredAt: iso(Date.parse(h.occurred_at) + HELD_NO_PURCHASE_DAYS * DAY),
      source: 'hub_lifecycle_events', sourceId: h.id })
  }
}

/** A client's activity times: lessons, practice, HRV, lesson events, held coaching sessions. */
async function activityTimes(ctx: ScanCtx, userId: string): Promise<number[]> {
  const db = ctx.db
  const [lp, ps, hrv, ev, bk] = await Promise.all([
    db.from('lesson_progress').select('started_at, completed_at').eq('user_id', userId).order('started_at', { ascending: false }).limit(5),
    db.from('practice_sessions').select('started_at').eq('profile_id', userId).order('started_at', { ascending: false }).limit(1),
    db.from('hrv_sessions').select('created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1),
    db.from('activity_events').select('created_at').eq('user_id', userId).like('event_type', 'lesson_%').order('created_at', { ascending: false }).limit(1),
    db.from('nr_bookings').select('ends_at').eq('participant_id', userId).in('status', ['confirmed', 'arrived']).lte('ends_at', iso(ctx.now)).order('ends_at', { ascending: false }).limit(1),
  ])
  for (const [name, r] of [['lesson_progress', lp], ['practice_sessions', ps], ['hrv_sessions', hrv], ['activity_events', ev], ['nr_bookings', bk]] as const) {
    if ((r as any).error) throw fail(name, (r as any).error)
  }
  const t: number[] = []
  for (const x of (lp.data ?? []) as any[]) for (const v of [x.started_at, x.completed_at]) if (v) t.push(Date.parse(v))
  for (const x of (ps.data ?? []) as any[]) t.push(Date.parse(x.started_at))
  for (const x of (hrv.data ?? []) as any[]) if (x.created_at) t.push(Date.parse(x.created_at))
  for (const x of (ev.data ?? []) as any[]) t.push(Date.parse(x.created_at))
  for (const x of (bk.data ?? []) as any[]) t.push(Date.parse(x.ends_at))
  return t.filter((n) => !Number.isNaN(n))
}

/**
 * Enrolled clients: first practice or HRV session, 3 and 7 days without activity (INACTIVE_DAYS), activity resumed, program end.
 * "Enrolled" is an active University enrollment that has not completed and whose access has not ended.
 */
export async function scanEnrolled(ctx: ScanCtx) {
  const db = ctx.db
  const { data: ens, error } = await db.from('enrollments').select('id, user_id, status, enrolled_at, completed_at, access_ends_at, program_id')
    .in('status', ['active']).limit(MAX_ROWS)
  if (error) throw fail('enrollments', error)
  const rows = (ens ?? []) as any[]
  const progIds = Array.from(new Set(rows.map((e) => e.program_id).filter(Boolean)))
  const { data: progs, error: pErr } = progIds.length ? await db.from('programs').select('id, org_id').in('id', progIds) : { data: [], error: null } as any
  if (pErr) throw fail('programs', pErr)
  const progOrg = new Map<string, string>((progs ?? []).map((p: any) => [p.id, p.org_id as string]))
  const mine = rows.filter((e) => ctx.cfg.sourceOrgs.includes(progOrg.get(e.program_id) ?? ''))
  const who = await contactsForUsers(ctx, mine.map((e) => e.user_id))
  const since = ctx.now - LOOKBACK_DAYS * DAY

  // program end: completed, or access ended, within the lookback
  for (const e of mine) {
    const contactId = who.get(e.user_id)
    if (!contactId) continue
    const end = e.completed_at ? Date.parse(e.completed_at) : e.access_ends_at ? Date.parse(e.access_ends_at) : NaN
    if (!Number.isNaN(end) && end <= ctx.now && end >= since) {
      await emit(ctx, { contactId, type: 'program_end', key: `program_end:${e.id}`, occurredAt: iso(end), source: 'enrollments', sourceId: e.id })
    }
  }

  // per client (not per enrollment): activity
  const live = mine.filter((e) => !e.completed_at && (!e.access_ends_at || Date.parse(e.access_ends_at) > ctx.now))
  const byUser = new Map<string, any[]>()
  for (const e of live) byUser.set(e.user_id, [...(byUser.get(e.user_id) ?? []), e])
  for (const [userId, list] of Array.from(byUser.entries())) {
    if (Date.now() > ctx.deadline) return
    const contactId = who.get(userId)
    if (!contactId) continue
    const times = await activityTimes(ctx, userId)

    // first practice or HRV session ever, when it happened inside the lookback
    const { data: firstP } = await db.from('practice_sessions').select('started_at').eq('profile_id', userId).order('started_at', { ascending: true }).limit(1)
    const { data: firstH } = await db.from('hrv_sessions').select('created_at').eq('user_id', userId).order('created_at', { ascending: true }).limit(1)
    const firsts = [(firstP?.[0] as any)?.started_at, (firstH?.[0] as any)?.created_at].filter(Boolean).map((v: string) => Date.parse(v))
    const first = firsts.length ? Math.min(...firsts) : NaN
    if (!Number.isNaN(first) && first >= since) {
      await emit(ctx, { contactId, type: 'first_practice', key: `first_practice:${userId}`, occurredAt: iso(first), source: firstP?.length ? 'practice_sessions' : 'hrv_sessions', sourceId: null })
    }

    // idle time counts from the latest activity, or from enrolling when there has been none since
    const enrolledAt = Math.max(...list.map((e) => Date.parse(e.enrolled_at)).filter((n) => !Number.isNaN(n)), 0)
    const last = Math.max(enrolledAt, ...times)
    if (!last) continue
    const lastIso = iso(last)
    for (const ev of inactivityDue(last, ctx.now)) {
      await emit(ctx, { contactId, type: ev, key: inactivityKey(ev, contactId, lastIso), occurredAt: iso(last + (ev === 'inactive_5d' ? INACTIVE_DAYS.risk : INACTIVE_DAYS.task) * DAY),
        source: 'activity', sourceId: null, detail: { anchor: lastIso } })
    }
    // activity resumed: a lapse recorded against an older anchor, and activity since
    const { data: lapses, error: lErr } = await db.from('hub_lifecycle_events').select('detail').eq('org_id', ctx.orgId).eq('contact_id', contactId)
      .eq('event_type', 'inactive_5d').gte('occurred_at', iso(since)).limit(20)
    if (lErr) throw fail('hub_lifecycle_events', lErr)
    for (const l of (lapses ?? []) as any[]) {
      const anchor = l.detail?.anchor
      if (typeof anchor === 'string' && last > Date.parse(anchor)) {
        await emit(ctx, { contactId, type: 'activity_resumed', key: `resumed:${contactId}:${anchor}`, occurredAt: lastIso, source: 'activity', sourceId: null, detail: { anchor } })
      }
    }
  }
}

/** The first outbound touch to a contact at or after `since`: texts, calls, campaign sends, emails, shared Gmail. */
export async function firstTouchSince(db: SupabaseClient, contactId: string, email: string | null, since: string): Promise<number | null> {
  const t: number[] = []
  const { data: convs, error: cErr } = await db.from('conversations').select('id').eq('contact_id', contactId)
  if (cErr) throw fail('conversations', cErr)
  if (convs?.length) {
    const { data, error } = await db.from('crm_messages').select('created_at').eq('direction', 'outbound')
      .in('conversation_id', convs.map((c: any) => c.id)).gte('created_at', since).order('created_at').limit(1)
    if (error) throw fail('crm_messages', error)
    for (const m of data ?? []) t.push(Date.parse((m as any).created_at))
  }
  const [calls, sends, emails] = await Promise.all([
    db.from('call_logs').select('created_at').eq('contact_id', contactId).eq('direction', 'outbound').gte('created_at', since).order('created_at').limit(1),
    db.from('message_sends').select('sent_at').eq('contact_id', contactId).eq('dry_run', false).gte('sent_at', since).order('sent_at').limit(1),
    db.from('email_sends').select('sent_at').eq('contact_id', contactId).gte('sent_at', since).order('sent_at').limit(1),
  ])
  if (calls.error) throw fail('call_logs', calls.error)
  if (sends.error) throw fail('message_sends', sends.error)
  if (emails.error) throw fail('email_sends', emails.error)
  for (const r of [...(calls.data ?? []), ...(sends.data ?? []), ...(emails.data ?? [])] as any[]) t.push(Date.parse(r.created_at ?? r.sent_at))
  const e = (email ?? '').trim().toLowerCase()
  if (e.includes('@')) {
    // shared mailboxes only (the 2026-11-09 mail privacy rule); absent until hub_236 is applied
    const { data: shared } = await db.from('hub_mail_connections').select('id').eq('visibility', 'shared')
    const ids = (shared ?? []).map((c: any) => c.id)
    if (ids.length) {
      const { data, error } = await db.from('hub_mail_sent').select('sent_at').in('connection_id', ids).eq('to_address', e).gte('sent_at', since).order('sent_at').limit(1)
      if (!error) for (const m of data ?? []) t.push(Date.parse((m as any).sent_at))
    }
  }
  const ok = t.filter((n) => !Number.isNaN(n))
  return ok.length ? Math.min(...ok) : null
}

/** Inbound leads 24 hours old with no outbound touch and no booking of their own. */
export async function scanLeads(ctx: ScanCtx) {
  const { data, error } = await ctx.db.from('contacts').select('id, email, source, created_at')
    .eq('org_id', ctx.orgId).is('merged_into_id', null).is('archived_at', null)
    .gte('created_at', iso(ctx.now - 7 * DAY)).lte('created_at', iso(ctx.now - 24 * 3_600_000)).limit(MAX_ROWS)
  if (error) throw fail('contacts', error)
  for (const c of (data ?? []) as any[]) {
    if (Date.now() > ctx.deadline) return
    if (!SCORECARD_CHANNELS(leadChannel(c.source))) continue
    const created = Date.parse(c.created_at)
    const { data: bk, error: bErr } = await ctx.db.from('hub_booking_syncs').select('booking_id').eq('contact_id', c.id).limit(1)
    if (bErr) throw fail('hub_booking_syncs', bErr)
    const touch = await firstTouchSince(ctx.db, c.id, c.email, c.created_at)
    if (!leadOwedTask(created, touch, bk?.length ? created : null, ctx.now)) continue
    await emit(ctx, { contactId: c.id, type: 'lead_no_touch_24h', key: `lead_no_touch:${c.id}`, occurredAt: iso(created + 24 * 3_600_000), source: 'contacts', sourceId: c.id })
  }
}

/** Live only: open "reach out" tasks close themselves once the contact has been touched since the task opened. */
export async function closeTouchedTasks(ctx: ScanCtx) {
  if (ctx.cfg.mode !== 'live') return
  const { data, error } = await ctx.db.from('tasks').select('id, contact_id, created_at, source')
    .eq('org_id', ctx.orgId).in('source', ['hub_followup:lead_no_touch_24h', 'hub_followup:discovery_no_show']).in('status', ['todo', 'in_progress']).limit(MAX_ROWS)
  if (error) throw fail('tasks', error)
  for (const t of (data ?? []) as any[]) {
    if (Date.now() > ctx.deadline) return
    const { data: c } = await ctx.db.from('contacts').select('email').eq('id', t.contact_id).maybeSingle()
    if (await firstTouchSince(ctx.db, t.contact_id, (c as any)?.email ?? null, t.created_at) === null) continue
    const n = await closeTasks(ctx.db, ctx.orgId, t.contact_id, [String(t.source).slice('hub_followup:'.length) as any])
    ctx.counts.closed_on_touch = (ctx.counts.closed_on_touch ?? 0) + n
  }
}
