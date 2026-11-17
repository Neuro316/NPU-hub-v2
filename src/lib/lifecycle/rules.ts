// src/lib/lifecycle/rules.ts
// The pure rules of the lifecycle engine (Hub Running List q06, q07, q19, q20, q21). No imports, so the tamper
// harness (scripts/lifecycle/lifecycle-tamper.cjs) runs them directly.
//
//   routing     which University appointment type goes where: a discovery call is a LEAD (Sales Pipeline,
//               "Discovery call Scheduled", tagged by brand); a coaching session is ACTIVITY on an existing client
//               (never a new lead, never a new contact)
//   brand tag   "Neuro Progeny" or "WNW", added only when the contact has neither, so a tag changed by hand on the
//               card is never overwritten
//   products    a purchase classified from its program name or paywall slug
//   actions     for each event: the Enrolled stage it moves to, the campaign it enrolls in or exits, the follow-up
//               task it opens or closes
//   mode        org_settings 'hub_lifecycle'.mode: only the exact string 'live' applies actions; 'dry_run' records
//               what would happen and does nothing else; anything else is off

export type Brand = 'np' | 'wnw'
export const BRAND_TAG: Record<Brand, string> = { np: 'Neuro Progeny', wnw: 'WNW' }

export type Mode = 'off' | 'dry_run' | 'live'

export interface LifecycleConfig {
  mode: Mode
  /** the user follow-up tasks are assigned to */
  assignee: string | null
  /** University orgs whose bookings and purchases land on this org's contacts (the WNW org's clients live here) */
  sourceOrgs: string[]
  /** the org whose University data is WNW-branded */
  wnwOrg: string | null
  /** pipeline legacy keys */
  salesPipeline: string
  enrolledPipeline: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** org_settings 'hub_lifecycle'. Malformed parts are dropped, never widened; a missing row is off. */
export function parseConfig(orgId: string, raw: unknown): LifecycleConfig {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const mode: Mode = r.mode === 'live' ? 'live' : r.mode === 'dry_run' ? 'dry_run' : 'off'
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && UUID.test(x)) : [])
  const key = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d)
  return {
    mode,
    assignee: typeof r.assignee === 'string' && UUID.test(r.assignee) ? r.assignee : null,
    sourceOrgs: Array.from(new Set([orgId, ...ids(r.source_orgs)])),
    wnwOrg: typeof r.wnw_org === 'string' && UUID.test(r.wnw_org) ? r.wnw_org : null,
    salesPipeline: key(r.sales_pipeline, 'default'),
    enrolledPipeline: key(r.enrolled_pipeline, ''),
  }
}

// ── routing ────────────────────────────────────────────────────────────────────────────────────────────────────

export type RouteKind = 'lead' | 'activity'
export interface TypeRoute { kind: RouteKind; brand: Brand; pipeline: string | null; stage: string | null }

/**
 * org_settings 'hub_booking_type_routes' = { "<appointment type id>": { kind, brand, pipeline?, stage? } }.
 * A lead route needs a pipeline and a stage; an activity route needs neither (it never places). Anything malformed
 * is dropped, so an unknown type is unrouted rather than guessed.
 */
export function parseTypeRoutes(raw: unknown): Map<string, TypeRoute> {
  const out = new Map<string, TypeRoute>()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!UUID.test(id) || !v || typeof v !== 'object') continue
    const r = v as Record<string, unknown>
    const brand: Brand | null = r.brand === 'np' || r.brand === 'wnw' ? r.brand : null
    if (!brand) continue
    if (r.kind === 'activity') { out.set(id, { kind: 'activity', brand, pipeline: null, stage: null }); continue }
    if (r.kind !== 'lead') continue
    const pipeline = typeof r.pipeline === 'string' && r.pipeline.trim() ? r.pipeline.trim() : null
    const stage = typeof r.stage === 'string' && r.stage.trim() ? r.stage : null
    if (!pipeline || !stage) continue
    out.set(id, { kind: 'lead', brand, pipeline, stage })
  }
  return out
}

/** The brand tag to add, or null when the contact already carries either brand tag (hand edits win). */
export function brandTagToAdd(tags: unknown, brand: Brand): string | null {
  const have = new Set((Array.isArray(tags) ? tags : []).map((t) => String(t).trim().toLowerCase()))
  if (Object.values(BRAND_TAG).some((t) => have.has(t.toLowerCase()))) return null
  return BRAND_TAG[brand]
}

// ── products ───────────────────────────────────────────────────────────────────────────────────────────────────

export type Product = 'phase_1' | 'phase_2' | 'phase_3' | 'clarity' | 'assessment' | 'fresh_air' | 'wnw' | 'coaching' | 'other'

/** A purchase's product from its program name, paywall slug and the University org it was sold in. */
export function classifyProduct(p: { programName?: string | null; paywallSlug?: string | null; orgId?: string | null }, wnwOrg: string | null): Product {
  const s = `${p.programName ?? ''} ${p.paywallSlug ?? ''}`.toLowerCase().replace(/[-_]+/g, ' ')
  if ((wnwOrg && p.orgId === wnwOrg) || /\bwnw\b|waynesville/.test(s)) return 'wnw'
  if (/clarity/.test(s)) return 'clarity'
  if (/assessment/.test(s)) return 'assessment'
  if (/fresh air/.test(s)) return 'fresh_air'
  if (/capacity protocol/.test(s)) {
    if (/phases? 1 2 3/.test(s)) return 'phase_1'
    if (/phases? 2( 3)?\b/.test(s)) return 'phase_2'
    if (/phase 3/.test(s)) return 'phase_3'
    return 'phase_1'
  }
  if (/coaching/.test(s)) return 'coaching'
  return 'other'
}

// ── events and their actions ───────────────────────────────────────────────────────────────────────────────────

export type EventType =
  | 'lead_arrived' | 'lead_no_touch_24h'
  | 'booking_made' | 'booking_held' | 'booking_no_show' | 'booking_cancelled' | 'held_no_purchase_2d'
  | 'coaching_booked' | 'coaching_held'
  | 'checkout_started' | 'checkout_unpaid_1h' | 'purchase' | 'consent_signed' | 'first_lesson_opened' | 'first_practice'
  | 'inactive_5d' | 'inactive_10d' | 'activity_resumed' | 'program_end'

/** The Enrolled pipeline's stages, in order. Drop-off risk is the one stage a contact may move back from. */
export const ENROLLED_STAGES = ['Purchased', 'Consent signed', 'Onboarded', 'Active', 'Drop-off risk', 'Completed'] as const
export type EnrolledStage = (typeof ENROLLED_STAGES)[number]

export type CampaignKey = 'checkout_recovery' | 'discovery_booked' | 'discovery_no_show' | 'post_discovery' | 'client_onboarding' | 'dropoff_nudge'
/** The campaign_routes source key each lifecycle campaign listens on. */
export const campaignSourceKey = (c: CampaignKey) => `lifecycle:${c}`

export type TaskReason = 'lead_no_touch_24h' | 'discovery_no_show' | 'held_no_purchase_2d' | 'enrolled_inactive_10d'
export type Closer = 'touch' | 'booking' | 'purchase' | 'activity' | 'program_end'

/** What closes each kind of follow-up task. */
export const TASK_CLOSERS: Record<TaskReason, Closer[]> = {
  lead_no_touch_24h: ['touch', 'booking', 'purchase'],
  discovery_no_show: ['booking', 'touch', 'purchase'],
  held_no_purchase_2d: ['purchase'],
  enrolled_inactive_10d: ['activity', 'program_end'],
}

export const TASK_TITLE: Record<TaskReason, string> = {
  lead_no_touch_24h: 'New lead, no reply yet: reach out',
  discovery_no_show: 'Missed discovery call: check in and offer a new time',
  held_no_purchase_2d: 'Discovery call 2 days ago, no purchase: follow up',
  enrolled_inactive_10d: 'Client quiet for 7 days: personal check-in',
}

/** Which closers an event counts as. */
export const EVENT_CLOSES: Partial<Record<EventType, Closer[]>> = {
  booking_made: ['booking'],
  coaching_booked: ['booking', 'activity'],
  coaching_held: ['activity'],
  purchase: ['purchase'],
  first_lesson_opened: ['activity'],
  first_practice: ['activity'],
  activity_resumed: ['activity'],
  program_end: ['program_end'],
}

export interface Actions {
  /** move forward in Enrolled to this stage ('back_to_active' moves Drop-off risk back to Active only) */
  enrolled?: EnrolledStage | 'back_to_active'
  enroll?: CampaignKey
  exit?: CampaignKey[]
  openTask?: TaskReason
  /** the brand tag (booking_made on a lead route) */
  tag?: boolean
}

/**
 * The action table. Discovery booked and Post-discovery follow-up start from their Sales stages through the
 * existing stage routes (the booking sync places the card), so their events only exit other campaigns here.
 */
export const EVENT_ACTIONS: Record<EventType, Actions> = {
  lead_arrived: {},
  lead_no_touch_24h: { openTask: 'lead_no_touch_24h' },
  booking_made: { tag: true, exit: ['discovery_no_show'] },
  booking_held: { exit: ['discovery_booked', 'discovery_no_show'] },
  booking_no_show: { enroll: 'discovery_no_show', exit: ['discovery_booked'], openTask: 'discovery_no_show' },
  booking_cancelled: {},
  held_no_purchase_2d: { openTask: 'held_no_purchase_2d' },
  coaching_booked: {},
  coaching_held: {},
  checkout_started: { enroll: 'checkout_recovery' },
  checkout_unpaid_1h: {},
  purchase: { enrolled: 'Purchased', enroll: 'client_onboarding', exit: ['checkout_recovery', 'post_discovery', 'discovery_no_show'] },
  consent_signed: { enrolled: 'Consent signed' },
  first_lesson_opened: { enrolled: 'Onboarded' },
  first_practice: { enrolled: 'Active', exit: ['client_onboarding'] },
  inactive_5d: { enrolled: 'Drop-off risk', enroll: 'dropoff_nudge' },
  inactive_10d: { openTask: 'enrolled_inactive_10d' },
  activity_resumed: { enrolled: 'back_to_active', exit: ['dropoff_nudge'] },
  program_end: { enrolled: 'Completed', exit: ['dropoff_nudge', 'client_onboarding'] },
}

/** The products a purchase must be to move the Enrolled pipeline and start Client onboarding. */
export const ENROLLING_PRODUCTS: Product[] = ['phase_1', 'phase_2', 'phase_3', 'clarity', 'assessment', 'fresh_air', 'wnw']

/** Pure: the actions for one event. A purchase of anything else (a coaching package, a short course) is recorded only. */
export function actionsFor(event: EventType, product: string | null): Actions {
  if (event === 'purchase' && !ENROLLING_PRODUCTS.includes(product as Product)) return { exit: ['checkout_recovery'] }
  return EVENT_ACTIONS[event]
}

/** Pure: the open tasks an event closes. */
export function tasksClosedBy(event: EventType): TaskReason[] {
  const closers = EVENT_CLOSES[event] ?? []
  return (Object.keys(TASK_CLOSERS) as TaskReason[]).filter((r) => TASK_CLOSERS[r].some((c) => closers.includes(c)))
}

/**
 * Pure: a forward-only Enrolled move. Returns the stage to place at, or null to leave the contact where it is.
 * 'back_to_active' moves only a contact sitting at Drop-off risk. Completed is never left.
 */
export function enrolledTarget(current: string | null, want: EnrolledStage | 'back_to_active'): EnrolledStage | null {
  const idx = (s: string | null) => (s ? ENROLLED_STAGES.indexOf(s as EnrolledStage) : -1)
  if (want === 'back_to_active') return current === 'Drop-off risk' ? 'Active' : null
  if (current === 'Completed') return null
  return idx(current) < idx(want) ? want : null
}

// ── inactivity ─────────────────────────────────────────────────────────────────────────────────────────────────

// 3 days quiet is Drop-off risk, 7 days opens the check-in task (Shane, 17 Nov 2026; was 5 and 10).
// The keys inactive_5d, inactive_10d and enrolled_inactive_10d are historical names: hub_237's check constraint and
// existing ledger rows use them, so they stay as they are whatever the day counts.
export const INACTIVE_DAYS = { risk: 3, task: 7 } as const
const DAY = 86_400_000

/** Pure: which inactivity events are due for an enrolled client whose last activity was at `last`. */
export function inactivityDue(last: number, now: number): Array<'inactive_5d' | 'inactive_10d'> {
  const idle = now - last
  const out: Array<'inactive_5d' | 'inactive_10d'> = []
  if (idle >= INACTIVE_DAYS.risk * DAY) out.push('inactive_5d')
  if (idle >= INACTIVE_DAYS.task * DAY) out.push('inactive_10d')
  return out
}

/** The ledger key of an inactivity event, anchored on the activity it is measured from, so a later lapse re-fires. */
export const inactivityKey = (event: 'inactive_5d' | 'inactive_10d', contactId: string, lastIso: string) => `${event}:${contactId}:${lastIso}`

// ── timing rules for the follow-ups ────────────────────────────────────────────────────────────────────────────

export const LEAD_TOUCH_HOURS = 24
export const HELD_NO_PURCHASE_DAYS = 2
export const CHECKOUT_UNPAID_HOURS = 1

/** Pure: a lead is owed a task once 24 hours have passed with no outbound touch and no booking of their own. */
export function leadOwedTask(createdAt: number, firstTouch: number | null, ownBooking: number | null, now: number): boolean {
  if (now - createdAt < LEAD_TOUCH_HOURS * 3_600_000) return false
  if (firstTouch !== null && firstTouch >= createdAt) return false
  if (ownBooking !== null) return false
  return true
}

/** Event titles on the contact timeline. No em dashes, no names, no amounts. */
export const EVENT_TITLE: Record<EventType, string> = {
  lead_arrived: 'New lead',
  lead_no_touch_24h: 'No outbound touch 24 hours after the lead arrived',
  booking_made: 'Discovery call booked',
  booking_held: 'Discovery call held',
  booking_no_show: 'Discovery call missed',
  booking_cancelled: 'Discovery call cancelled',
  held_no_purchase_2d: 'No purchase 2 days after the discovery call',
  coaching_booked: 'Coaching session booked',
  coaching_held: 'Coaching session held',
  checkout_started: 'Checkout started',
  checkout_unpaid_1h: 'Checkout not finished after 1 hour',
  purchase: 'Purchase',
  consent_signed: 'Consent signed',
  first_lesson_opened: 'First lesson opened',
  first_practice: 'First practice session',
  inactive_5d: 'No activity for 3 days',
  inactive_10d: 'No activity for 7 days',
  activity_resumed: 'Activity resumed',
  program_end: 'Program ended',
}
