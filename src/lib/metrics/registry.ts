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

export type Unit = 'count' | 'usd' | 'minutes' | 'days' | 'pct' | 'rating' | 'per_week'
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
  // ── Scorecard ──
  { key: 'leads', label: 'Leads', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard', dim: 'channel' },
  { key: 'assessments_sold', label: 'Assessments sold', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard', dim: 'product' },
  { key: 'booked_calls', label: 'Booked calls', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard', dim: 'type' },
  { key: 'shows', label: 'Shows', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard' },
  { key: 'sales', label: 'Sales (paid)', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard', dim: 'product' },
  { key: 'comps', label: 'Comps ($0)', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard', dim: 'product' },
  { key: 'clarity_sales', label: 'Clarity sales', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard' },
  { key: 'onboarded', label: 'Onboarded', tab: 'scorecard', unit: 'count', agg: 'sum', def: '1-scorecard' },
  { key: 'revenue', label: 'Revenue', tab: 'scorecard', unit: 'usd', agg: 'sum', def: '1-scorecard', dim: 'stream' },

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
  { key: 'gap_checkout_started', label: 'Checkout started vs paid', tab: 'sales', unit: 'count', agg: 'gap', gap: 'G7', def: 'gaps-what-to-start-collecting', noRecords: true },
  { key: 'gap_partner_sales', label: 'Partner-referred sales', tab: 'sales', unit: 'count', agg: 'gap', gap: 'G8', def: 'gaps-what-to-start-collecting', noRecords: true },

  // ── Onboarding ──
  { key: 'buyers', label: 'New clients (paid or comp)', tab: 'onboarding', unit: 'count', agg: 'sum', def: '4-onboarding' },
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

/** Metrics the targets editor offers (counts and money that accumulate over a month). */
export const TARGETABLE = METRICS.filter(m => m.agg === 'sum' && !m.hidden).map(m => m.key)
