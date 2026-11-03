# Growth Dashboard: plan

Branch `feat/growth-dashboard` off `main` at `7ebc551`. It replaces the Analytics page and
keeps the URL (`/analytics`) and the nav entry. Metric definitions and gaps are in
`docs/metrics/definitions.md`.

## State

| Step | Status |
|---|---|
| 1. Read-only mapping | Done: `docs/metrics/definitions.md`, corrected 2026-11-03 |
| 2. Storage: `hub_223_growth_metrics` | **Applied to production 2026-11-03** (ledger 20261103131756) |
| 3. Rollup cron | Built: `/api/cron/metrics-rollup` |
| 4. Dashboard (9 tabs) | Built: `/analytics` |
| 5. Targets editor and alerts | Built: Analytics › Targets, plus texts |

**Amended at the go:**
- `hub_metric_exclusions` gained `email_pattern` and `decision` (`exclude` / `keep`).
  `created_by` is nullable for seeded rows.
- Seeded: `cameron.s.allen+%@gmail.com`, `cameron.s.allen@gmail.com` and
  `cameron@neuroprogeny.com`.

## Hard rules, and how they're met

- **University tables are read only.** Every source table is read with plain service-role
  SELECTs. Derived data goes only into the four Hub tables in hub_223 (RLS on, no policies).
- **One test filter,** `src/lib/metrics/test-filter.ts`, documented in definitions §0. Every
  metric and every click-through list goes through it.
  - Beyond the seeded rows, nothing is excluded until Cameron presses Exclude in
    **Targets › Review test accounts**.
- **Superadmin only.** The page, every `/api/metrics/*` route and the Targets editor are for
  platform superadmins (`profiles.role`). The nav item is marked superadmin-only.
- **No individual biometric values.**
  - Client outcomes are aggregates.
  - The HRV-trend and self-report shares are hidden when fewer than 5 people qualify.
  - Click-through from an outcome tile lists names only.
  - No biometric value is stored in `hub_metrics_daily` or returned by any route.

## Rulings (accepted at the go)

1. **Leads** on the Scorecard count inbound demand. Prospecting research and imports are on
   Acquisition only.
2. **Comp vs sale.** A $0 payment (100% promo) is a **comp**, shown beside sales. The test codes
   `CTEST` and `CTEST2` are excluded outright.
3. **Onboarded** = the client's first valid HRV session falls in the period.
4. **Revenue** (corrected at the go) = `payments` net of refunds, test rows excluded +
   clinic payments (`acct_payments`) + manual income (`fin_income`, anything taken
   off-platform). The tile is labelled **Revenue**. No Stripe reader.
5. **Targets.**
   - Amber below 90% of the target **pace**; red below 75%. Pace = the daily share of the
     monthly target, summed over the range's days up to today.
   - Weeks and custom ranges are prorated by day.
   - A month without its own row uses the latest earlier month's targets.
6. **No push channel** (gap G12). The Monday scorecard and the alerts go by **text** through
   `hub_sms_outbox` to Cameron's profile.
7. **Alerts are de-duplicated** in `hub_metric_alerts`:
   - "no leads in 48 h": at most once a day
   - "speed to lead over 60 min": once a day
   - "cron failed twice in a row": once per failure streak. The jobs the existing watchdog
     already covers (`campaign-steps`, `entry-events`) are left to it, so nothing texts twice.
8. **The rollup:**
   - **hourly** (`5 * * * *`): today and yesterday, then the alerts. On Monday the 08:05
     New York run sends the scorecard; :05 lands on 08:05 in both EST and EDT, so no
     separate Monday cron is needed.
   - **nightly** (`30 7 * * *` UTC): the last 120 days.
   - **The first run** backfills 120 days when the table has no history.
   - **Superadmins** can also press "Recompute now" in Targets.
   - **Idempotent.** A recompute deletes the range's rows for the computed metrics and
     inserts the new ones. Level metrics (for example open tickets) exist only for the day
     they were taken, and a past-day recompute never deletes them.
   - Every run writes `job_runs`, and the route fails closed without `CRON_SECRET`.

**Also ruled while building (to confirm):**
- **Assessments sold** counts paid and $0 assessment payments, because the Capacity
  Assessment is a $0 program. The tile breaks them down into paid and free.
- **Speed to lead.** A lead with no outbound touch yet counts the minutes it has waited so
  far, so ignoring a lead can't flatter the median.

## Files

| File | Purpose |
|---|---|
| `supabase/migrations/hub_223_growth_metrics.sql` | Four Hub tables, targets and test seed |
| `src/lib/metrics/registry.ts` | Every metric: tab, unit, aggregation, definition anchor |
| `src/lib/metrics/test-filter.ts` | The shared test filter |
| `src/lib/metrics/collect.ts` | Reads the sources into items (also used for click-through) |
| `src/lib/metrics/rollup.ts` | Items to daily rows; replace a range |
| `src/lib/metrics/summary.ts` | Range values, previous period, targets and pace, funnel |
| `src/lib/metrics/alerts.ts` | Monday scorecard and the three alerts |
| `src/lib/metrics/cron.ts` | The cron handler shared by the two routes below |
| `src/app/api/cron/metrics-rollup/route.ts` | Hourly rollup, plus alerts and the Monday text |
| `src/app/api/cron/metrics-rollup/nightly/route.ts` | Nightly 120-day recompute |
| `src/app/api/metrics/{summary,records,targets,review,recompute}` | Superadmin API |
| `src/app/(dashboard)/analytics/page.tsx` | The dashboard: 9 tabs and Targets |
| `scripts/metrics/metrics-check.cjs` | Pure-rule checks (32) |
