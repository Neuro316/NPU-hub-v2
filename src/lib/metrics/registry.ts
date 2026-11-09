// src/lib/metrics/registry.ts
// Every Growth Dashboard metric: its tab, unit, how a range is aggregated, and where it is
// defined (docs/metrics/definitions.md). Shared by the rollup, the API and the page.
//
// agg:
//   sum     daily totals added over the range
//   median  median of the per-item rows (dimension_key 'item') in the range
//   last    the latest daily total in the range (a level, such as open tickets)
//   ratio   value(num) / value(den) × scale, each side aggregated by its own agg
//   gap     no data source yet (definitions "Gaps"); shown as a gap tile
//
// Targets (hub_metric_targets): a sum metric's target is a monthly total, prorated by day and compared with the pace
// so far; a ratio, median or level metric's target is a level, compared directly. `direction` says whether higher or
// lower is better, so amber and red work both ways (lower: amber above the amber share of the target, red above the
// red share; coaching capacity uses amber 90%, red above 100%).

export type Unit = 'count' | 'usd' | 'minutes' | 'days' | 'hours' | 'pct' | 'rating' | 'per_week'
export type Agg = 'sum' | 'median' | 'last' | 'ratio' | 'gap'
export type Tab = 'scorecard' | 'acquisition' | 'sales' | 'onboarding' | 'outcomes' | 'retention' | 'marketing' | 'content' | 'operations'

export interface MetricDef {
  key: string
  label: string
  tab: Tab
  unit: Unit
  agg: Agg
  /** anchor in docs/metrics/definitions.md */
  def: string
  num?: string
  den?: string
  scale?: number
  /** the metric is good when it goes down (speed to lead, refunds, overdue tasks) */
  lowerIsBetter?: boolean
  /** a breakdown to list under the tile (dimension_key) */
  dim?: string
  /** hide the value when the denominator is under this many people (outcomes) */
  minN?: number
  /** click-through lists names only, never values (client outcomes) */
  namesOnly?: boolean
  /** shown on its tab but drawn from another metric's rows */
  gap?: string
  /** the records endpoint has no list for it (ratios, gaps) */
  noRecords?: boolean
  hidden?: boolean
  /** information only: the targets editor does not offer it */
  noTarget?: boolean
  /** dated by the session day, so later days of the month count (coaching hours booked): a range ending today runs
   *  to the month's end, and the target is compared in full, not prorated to today */
  forward?: boolean
}

export const TABS: { key: Tab; label: string }[] = [
  { key: 'scorecard', label: 'Scorecard' },
  { key: 'acquisition', label: 'Acquisition' },
  { key: 'sales', label: 'Sales' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'outcomes', label: 'Client outcomes' },
  { key: 'retention', label: 'Retention and expansion' },
  { key: 'marketing', label: 'Marketing engine' },
  { key: 'content', label: 'Content and PR' },
  { key: 'operations', label: 'Operations health' },
]

const D = 'docs/metrics/definitions.md'
export const DEFINITIONS_PATH = D

export const METRICS: MetricDef[] = [
  // ── Scorecard (product line, ruled 2026-11-09) ──
  { key: 'phase1_sales', label: 'Phase 1 sales', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard', dim: 'product' },
  { key: 'phase23_conversion', label: 'Phase 1 → Phase 2/3 (by today)', tab: 'scorecard', unit: 'pct', agg: 'ratio', num: 'phase23_converted', den: 'phase1_buyers', scale: 100, dim: 'cohort', def: '1-scorecard', noRecords: true },
  { key: 'coaching_attach_30', label: 'Coaching attach, 30 min', tab: 'scorecard', unit: 'pct', agg: 'ratio', num: 'coaching_attached_30', den: 'phase1_buyers', scale: 100, def: '1-scorecard', noRecords: true, noTarget: true },
  { key: 'coaching_attach_60', label: 'Coaching attach, 60 min', tab: 'scorecard', unit: 'pct', agg: 'ratio', num: 'coaching_attached_60', den: 'phase1_buyers', scale: 100, def: '1-scorecard', noRecords: true, noTarget: true },
  { key: 'core_revenue', label: 'Core revenue (Capacity + coaching)', tab: 'scorecard', unit: 'usd', agg: 'sum', def: '1-scorecard', dim: 'product' },
  { key: 'leads', label: 'Leads', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard', dim: 'channel' },
  { key: 'booked_calls', label: 'Booked calls', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard', dim: 'type' },
  { key: 'shows', label: 'Shows', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard' },
  { key: 'coaching_hours_booked', label: 'Coaching hours booked', tab: 'scorecard', unit: 'hours', agg: 'sum', def: '1-scorecard', dim: 'length', forward: true },
  { key: 'coaching_capacity_used', label: 'Coaching capacity used (of 10 h a month)', tab: 'scorecard', unit: 'pct', agg: 'ratio', num: 'coaching_hours_booked', den: 'coaching_capacity_hours', scale: 100, def: '1-scorecard', noRecords: true, lowerIsBetter: true, forward: true },
  { key: 'coaching_committed_hours', label: 'Coaching committed, next 5 weeks (owed, not booked)', tab: 'scorecard', unit: 'hours', agg: 'last', def: '1-scorecard', dim: 'length', noTarget: true },
  { key: 'assessments_sold', label: 'Assessments sold', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard', dim: 'product' },
  { key: 'sales', label: 'Sales (paid)', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard', dim: 'product' },
  { key: 'onboarded', label: 'Onboarded', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard' },
  { key: 'revenue', label: 'Revenue', tab: 'scorecard', unit: 'usd', agg: 'sum', def: '1-scorecard', dim: 'stream' },
  // the parts of the ratios above (not tiles)
  { key: 'phase1_buyers', label: 'First Phase 1 purchases (paid)', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard', dim: 'cohort', hidden: true },
  { key: 'phase23_converted', label: 'Phase 1 buyers who bought Phase 2/3 by today', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard', dim: 'cohort', hidden: true },
  { key: 'phase23_converted_60', label: 'Phase 1 buyers who bought Phase 2/3 within 60 days', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard', dim: 'cohort', hidden: true },
  { key: 'coaching_attached_30', label: 'Phase 1 buyers with 30 min coaching within 90 days', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard', hidden: true },
  { key: 'coaching_attached_60', label: 'Phase 1 buyers with 60 min coaching within 90 days', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard', hidden: true },
  { key: 'coaching_hours_60', label: 'Coaching hours booked, 60 min sessions', tab: 'scorecard', unit: 'hours', agg: 'sum', def: '1-scorecard', hidden: true, forward: true },
  { key: 'coaching_hours_30', label: 'Coaching hours booked, 30 min sessions', tab: 'scorecard', unit: 'hours', agg: 'sum', def: '1-scorecard', hidden: true, forward: true },
  { key: 'coaching_capacity_hours', label: 'Coaching capacity (hours)', tab: 'scorecard', unit: 'hours', agg: 'sum', def: '1-scorecard', hidden: true, forward: true },

  // ── Acquisition ──
  { key: 'leads_all', label: 'All new contacts', tab: 'acquisition', unit: 'count', agg: 'sum', def: '2-acquisition', dim: 'channel' },
  { key: 'leads_by_source', label: 'New contacts by source', tab: 'acquisition', unit: 'count', agg: 'sum', def: '2-acquisition', dim: 'source', hidden: true },
  { key: 'speed_to_lead', label: 'Speed to lead (median)', tab: 'acquisition', unit: 'minutes', agg: 'median', def: '2-acquisition', lowerIsBetter: true },
  { key: 'leads_booked_30d', label: 'Leads that booked within 30 days', tab: 'acquisition', unit: 'count', agg: 'sum', def: '2-acquisition', dim: 'channel' },
  { key: 'lead_to_booked_rate', label: 'Lead to booked rate', tab: 'acquisition', unit: 'pct', agg: 'ratio', num: 'leads_booked_30d', den: 'leads', scale: 100, def: '2-acquisition', noRecords: true },
  { key: 'ad_spend', label: 'Marketing spend', tab: 'acquisition', unit: 'usd', agg: 'sum', def: '2-acquisition' },
  { key: 'cost_per_lead', label: 'Cost per lead', tab: 'acquisition', unit: 'usd', agg: 'ratio', num: 'ad_spend', den: 'leads', def: '2-acquisition', lowerIsBetter: true, noRecords: true },
  { key: 'cost_per_client', label: 'Cost per client', tab: 'acquisition', unit: 'usd', agg: 'ratio', num: 'ad_spend', den: 'sales', def: '2-acquisition', lowerIsBetter: true, noRecords: true },
  { key: 'gap_lead_device', label: 'Leads by device', tab: 'acquisition', unit: 'count', agg: 'gap', gap: 'G4', def: 'gaps-what-to-start-collecting', noRecords: true },

  // ── Sales ──
  { key: 'pipeline_value', label: 'Open pipeline value', tab: 'sales', unit: 'usd', agg: 'last', def: '3-sales', dim: 'stage' },
  { key: 'no_shows', label: 'No-shows', tab: 'sales', unit: 'count', agg: 'sum', def: '3-sales', lowerIsBetter: true },
  { key: 'close_rate', label: 'Close rate (sales ÷ booked calls)', tab: 'sales', unit: 'pct', agg: 'ratio', num: 'sales', den: 'booked_calls', scale: 100, def: '3-sales', noRecords: true },
  { key: 'days_lead_to_purchase', label: 'Days from lead to purchase (median)', tab: 'sales', unit: 'days', agg: 'median', def: '3-sales', lowerIsBetter: true },
  { key: 'revenue_platform', label: 'Revenue: University payments', tab: 'sales', unit: 'usd', agg: 'sum', def: '3-sales', dim: 'product' },
  { key: 'promo_redemptions', label: 'Promo redemptions', tab: 'sales', unit: 'count', agg: 'sum', def: '3-sales', dim: 'code' },
  { key: 'promo_discount', label: 'Promo discount given', tab: 'sales', unit: 'usd', agg: 'sum', def: '3-sales', dim: 'code' },
  { key: 'show_outcomes', label: 'Calls held or missed', tab: 'sales', unit: 'count', agg: 'sum', def: '3-sales', hidden: true },
  { key: 'show_rate', label: 'Show rate (shows ÷ calls held or missed)', tab: 'sales', unit: 'pct', agg: 'ratio', num: 'shows', den: 'show_outcomes', scale: 100, def: '3-sales', noRecords: true },
  { key: 'phase23_conversion_60', label: 'Phase 1 → Phase 2/3 within 60 days', tab: 'sales', unit: 'pct', agg: 'ratio', num: 'phase23_converted_60', den: 'phase1_buyers', scale: 100, dim: 'cohort', def: '3-sales', noRecords: true },
  { key: 'coaching_revenue', label: 'Coaching revenue', tab: 'sales', unit: 'usd', agg: 'sum', def: '3-sales', dim: 'product' },
  { key: 'leadgen_revenue', label: 'Lead-gen revenue (everything else, WNW apart)', tab: 'sales', unit: 'usd', agg: 'sum', def: '3-sales', dim: 'product' },
  { key: 'leadgen_buyers', label: 'New lead-gen buyers', tab: 'sales', unit: 'count', agg: 'sum', def: '3-sales', dim: 'product' },
  { key: 'leadgen_converted', label: 'Lead-gen buyers who later bought Phase 1', tab: 'sales', unit: 'count', agg: 'sum', def: '3-sales', hidden: true },
  { key: 'leadgen_to_phase1', label: 'Lead-gen buyers → Phase 1', tab: 'sales', unit: 'pct', agg: 'ratio', num: 'leadgen_converted', den: 'leadgen_buyers', scale: 100, def: '3-sales', noRecords: true },
  { key: 'comps', label: 'Comps ($0, never toward a goal)', tab: 'sales', unit: 'count', agg: 'sum', def: '3-sales', dim: 'product', noTarget: true },
  { key: 'comps_value', label: 'Comps at list value', tab: 'sales', unit: 'usd', agg: 'sum', def: '3-sales', dim: 'product', noTarget: true },
  { key: 'wnw_revenue', label: 'WNW program revenue', tab: 'sales', unit: 'usd', agg: 'sum', def: '3-sales', dim: 'product' },
  { key: 'clarity_sales', label: 'Clarity sales (retired product)', tab: 'sales', unit: 'count', agg: 'sum', def: '1-scorecard', noTarget: true },
  { key: 'gap_checkout_started', label: 'Checkout started vs paid', tab: 'sales', unit: 'count', agg: 'gap', gap: 'G7', def: 'gaps-what-to-start-collecting', noRecords: true },
  { key: 'gap_partner_sales', label: 'Partner-referred sales', tab: 'sales', unit: 'count', agg: 'gap', gap: 'G8', def: 'gaps-what-to-start-collecting', noRecords: true },

  // ── Onboarding ──
  { key: 'buyers', label: 'New clients (paid)', tab: 'onboarding', unit: 'count', agg: 'sum', def: '4-onboarding' },
  { key: 'days_to_consent', label: 'Days to consent (median)', tab: 'onboarding', unit: 'days', agg: 'median', def: '4-onboarding', lowerIsBetter: true },
  { key: 'days_to_pairing', label: 'Days to headset pairing (median)', tab: 'onboarding', unit: 'days', agg: 'median', def: '4-onboarding', lowerIsBetter: true },
  { key: 'days_to_first_session', label: 'Days to first session (median)', tab: 'onboarding', unit: 'days', agg: 'median', def: '4-onboarding', lowerIsBetter: true },
  { key: 'onboarding_stuck', label: 'Stuck past target (now)', tab: 'onboarding', unit: 'count', agg: 'last', def: '4-onboarding', dim: 'step', lowerIsBetter: true },

  // ── Client outcomes (aggregates only) ──
  { key: 'active_clients', label: 'Active clients (14 days)', tab: 'outcomes', unit: 'count', agg: 'last', def: '5-client-outcomes-aggregates-only-never-per-person', namesOnly: true },
  { key: 'hrv_sessions', label: 'Valid HRV sessions', tab: 'outcomes', unit: 'count', agg: 'sum', def: '5-client-outcomes-aggregates-only-never-per-person', noRecords: true },
  { key: 'practice_sessions', label: 'Practice sessions', tab: 'outcomes', unit: 'count', agg: 'sum', def: '5-client-outcomes-aggregates-only-never-per-person', noRecords: true },
  { key: 'lessons_completed', label: 'Lessons completed', tab: 'outcomes', unit: 'count', agg: 'sum', def: '5-client-outcomes-aggregates-only-never-per-person', noRecords: true },
  { key: 'self_report_delta_sum', label: 'Self-report change (sum)', tab: 'outcomes', unit: 'count', agg: 'last', def: '5-client-outcomes-aggregates-only-never-per-person', hidden: true },
  { key: 'self_report_n', label: 'People with a repeat self-report', tab: 'outcomes', unit: 'count', agg: 'last', def: '5-client-outcomes-aggregates-only-never-per-person', namesOnly: true },
  { key: 'self_report_change', label: 'Self-report change (mean, first to latest)', tab: 'outcomes', unit: 'rating', agg: 'ratio', num: 'self_report_delta_sum', den: 'self_report_n', def: '5-client-outcomes-aggregates-only-never-per-person', minN: 5, noRecords: true },
  { key: 'hrv_improving', label: 'Clients with an improving HRV trend', tab: 'outcomes', unit: 'count', agg: 'last', def: '5-client-outcomes-aggregates-only-never-per-person', hidden: true },
  { key: 'hrv_trend_n', label: 'Clients with 6+ sessions in 90 days', tab: 'outcomes', unit: 'count', agg: 'last', def: '5-client-outcomes-aggregates-only-never-per-person', namesOnly: true },
  { key: 'hrv_improving_share', label: 'Improving HRV trend', tab: 'outcomes', unit: 'pct', agg: 'ratio', num: 'hrv_improving', den: 'hrv_trend_n', scale: 100, def: '5-client-outcomes-aggregates-only-never-per-person', minN: 5, noRecords: true },
  { key: 'reviews', label: 'Reviews', tab: 'outcomes', unit: 'count', agg: 'sum', def: '5-client-outcomes-aggregates-only-never-per-person', namesOnly: true },
  { key: 'review_rating_sum', label: 'Review rating (sum)', tab: 'outcomes', unit: 'count', agg: 'sum', def: '5-client-outcomes-aggregates-only-never-per-person', hidden: true },
  { key: 'review_rating', label: 'Average review rating', tab: 'outcomes', unit: 'rating', agg: 'ratio', num: 'review_rating_sum', den: 'reviews', def: '5-client-outcomes-aggregates-only-never-per-person', noRecords: true },

  // ── Retention and expansion ──
  { key: 'upgrades', label: 'Clarity → Capacity upgrades', tab: 'retention', unit: 'count', agg: 'sum', def: '6-retention-and-expansion' },
  { key: 'refunds', label: 'Refunds', tab: 'retention', unit: 'count', agg: 'sum', def: '6-retention-and-expansion', lowerIsBetter: true },
  { key: 'refund_amount', label: 'Refunded', tab: 'retention', unit: 'usd', agg: 'sum', def: '6-retention-and-expansion', lowerIsBetter: true },
  { key: 'repeat_buyers', label: 'Repeat buyers (2+ programs, all time)', tab: 'retention', unit: 'count', agg: 'last', def: '6-retention-and-expansion' },
  { key: 'paying_buyers', label: 'Paying buyers (all time)', tab: 'retention', unit: 'count', agg: 'last', def: '6-retention-and-expansion' },
  { key: 'revenue_all_time', label: 'Revenue (all time)', tab: 'retention', unit: 'usd', agg: 'last', def: '6-retention-and-expansion', hidden: true },
  { key: 'lifetime_value', label: 'Lifetime value per paying buyer', tab: 'retention', unit: 'usd', agg: 'ratio', num: 'revenue_all_time', den: 'paying_buyers', def: '6-retention-and-expansion', noRecords: true },
  { key: 'gap_memberships', label: 'Membership tier mix', tab: 'retention', unit: 'count', agg: 'gap', gap: 'G9', def: 'gaps-what-to-start-collecting', noRecords: true },

  // ── Marketing engine ──
  { key: 'campaign_entered', label: 'Entered a campaign', tab: 'marketing', unit: 'count', agg: 'sum', def: '7-marketing-engine', dim: 'campaign' },
  { key: 'email_sent', label: 'Emails sent', tab: 'marketing', unit: 'count', agg: 'sum', def: '7-marketing-engine' },
  { key: 'email_delivered', label: 'Delivered', tab: 'marketing', unit: 'count', agg: 'sum', def: '7-marketing-engine' },
  { key: 'email_opened', label: 'Opened', tab: 'marketing', unit: 'count', agg: 'sum', def: '7-marketing-engine' },
  { key: 'email_clicked', label: 'Clicked', tab: 'marketing', unit: 'count', agg: 'sum', def: '7-marketing-engine' },
  { key: 'email_bounced', label: 'Bounced', tab: 'marketing', unit: 'count', agg: 'sum', def: '7-marketing-engine', lowerIsBetter: true },
  { key: 'email_complained', label: 'Complaints', tab: 'marketing', unit: 'count', agg: 'sum', def: '7-marketing-engine', lowerIsBetter: true },
  { key: 'unsubscribed', label: 'Unsubscribed', tab: 'marketing', unit: 'count', agg: 'sum', def: '7-marketing-engine', lowerIsBetter: true },

  // ── Content and PR ──
  { key: 'podcasts', label: 'Podcasts aired', tab: 'content', unit: 'count', agg: 'sum', def: '8-content-and-pr' },
  { key: 'podcast_leads', label: 'Leads from podcasts', tab: 'content', unit: 'count', agg: 'sum', def: '8-content-and-pr' },
  { key: 'posts_published', label: 'Posts published', tab: 'content', unit: 'count', agg: 'sum', def: '8-content-and-pr' },

  // ── Operations health ──
  { key: 'cron_failures', label: 'Cron failures', tab: 'operations', unit: 'count', agg: 'sum', def: '9-operations-health', dim: 'job', lowerIsBetter: true },
  { key: 'inbox_waiting', label: 'Inbox waiting', tab: 'operations', unit: 'count', agg: 'last', def: '9-operations-health', lowerIsBetter: true },
  { key: 'tickets_open', label: 'Open support tickets', tab: 'operations', unit: 'count', agg: 'last', def: '9-operations-health', lowerIsBetter: true },
  { key: 'tasks_overdue', label: 'Overdue tasks', tab: 'operations', unit: 'count', agg: 'last', def: '9-operations-health', lowerIsBetter: true },
]

export const METRIC = Object.fromEntries(METRICS.map(m => [m.key, m])) as Record<string, MetricDef>

/** The coaching split takes targets although it is not a tile of its own. */
const TARGETABLE_PARTS = ['coaching_hours_60', 'coaching_hours_30']

/** Metrics the targets editor offers: every tile with a value, except information-only ones and client outcomes. */
export const TARGETABLE = METRICS.filter(m => m.agg !== 'gap' && (!m.hidden || TARGETABLE_PARTS.includes(m.key)) && !m.noTarget && !m.namesOnly && m.tab !== 'outcomes').map(m => m.key)

/** A sum's target is a monthly total (prorated by day); anything else is a level, compared directly. */
export const targetKind = (m: MetricDef): 'total' | 'level' => (m.agg === 'sum' ? 'total' : 'level')
export const defaultDirection = (m: MetricDef): 'higher' | 'lower' => (m.lowerIsBetter ? 'lower' : 'higher')

/** Cameron's coaching ceiling: 10 hours a month (about 5 × 60 min and 10 × 30 min). */
export const COACHING_HOURS_PER_MONTH = 10
/** Committed coaching looks this many weeks ahead (one session a week per package). */
export const COMMITTED_WEEKS = 5
/** The onboarding steps' target days when hub_metric_targets has no row for the step's metric. */
export const STEP_TARGET_DEFAULTS: Record<'days_to_consent' | 'days_to_pairing' | 'days_to_first_session', number> = { days_to_consent: 2, days_to_pairing: 7, days_to_first_session: 10 }
