# Growth Dashboard: plan

Branch `feat/growth-dashboard` off `main` at `7ebc551`. It replaces the Analytics page
(`/analytics`, 212 lines). Metric definitions and gaps are in `docs/metrics/definitions.md`.

## State

| Step | Status |
|---|---|
| 1. Read-only mapping | Done: `docs/metrics/definitions.md` |
| 2. Storage: `hub_223_growth_metrics` | **Proposed, waiting for the go** |
| 3. Rollup cron | After the go |
| 4. Dashboard (9 tabs) | After the go |
| 5. Targets editor and alerts | After the go |

## Hard rules, and how they're met

- **University tables are read only.** Every source table is read with plain service-role
  SELECTs. Derived data goes only into the four Hub tables in hub_223 (RLS on, no policies).
- **One test filter,** `src/lib/metrics/test-filter.ts`, documented in definitions §0. Every
  metric and every click-through list goes through it.
- **Superadmin only.** The page, its API, the Targets editor and the cron outputs are for
  platform superadmins (`profiles.role`).
- **No individual biometric values.** Client outcomes are aggregates, and the "improving HRV
  trend" share is hidden when fewer than 5 people qualify. Click-through from an outcome tile
  lists names only, never values.

## Rulings (mine, to confirm at the go)

1. **Leads** on the Scorecard count inbound demand. Prospecting research (the URL and city
   "sources") and imports are excluded from the Scorecard and shown on Acquisition as their own
   channels. Otherwise 150 leads a month would be met by research lists.
2. **Comp vs sale.** A 100%-discount enrollment is a **comp**, not a sale. Sales tiles show
   paid sales, with comps beside them. The test codes `CTEST` and `CTEST2` are excluded
   outright.
3. **Onboarded** = the client's first valid HRV session falls in the period, which is the end
   of the onboarding funnel.
4. **Revenue** = recorded Stripe revenue (`revenue_records`) + clinic payments
   (`acct_payments`) + manual income (`fin_income`, manual and without a Stripe id).
   - It's under-recorded today (gap G1).
   - The tile says "recorded revenue" until the platform ledger or a Stripe read closes the gap.
5. **Targets.**
   - Amber below 90% of the target **pace**; red below 75%. Pace = target × the share of the
     period elapsed.
   - Weekly targets = monthly × 7 ÷ days in the month.
   - A month without its own row uses the latest earlier month's targets.
6. **Push notifications don't exist in the Hub yet** (gap G12, greenfield). The Monday
   scorecard and the alerts go by **text** through `hub_sms_outbox` to Cameron's profile.
   Push is a separate build if you want it.
7. **Alerts are de-duplicated** in `hub_metric_alerts`:
   - "no leads in 48 h": at most one per day
   - "speed to lead over 60 min": once per day
   - "cron failed twice in a row": once per failure streak
8. **The rollup** runs from one cron route:
   - **hourly** (`5 * * * *`): today and yesterday
   - **nightly** (`30 7 * * *` UTC, about 2:30–3:30 AM New York): the last 120 days
   - **Monday scorecard** (`5 13 * * 1` and `5 12 * * 1` UTC): the route sends only when it is
     08:05 on a Monday in New York, so daylight saving needs no edit
   - Each day's rows are deleted and reinserted in one call, so a recompute replaces them.
     Every run writes `job_runs`, and the route fails closed without `CRON_SECRET`.

## Files (after the go)

| File | Purpose |
|---|---|
| `supabase/migrations/hub_223_growth_metrics.sql` | Four Hub tables and the target seed |
| `src/lib/metrics/test-filter.ts` | The shared test filter |
| `src/lib/metrics/compute.ts` | Every metric for a day, from the definitions |
| `src/lib/metrics/rollup.ts` | Replace a day's rows; ranges |
| `src/lib/metrics/alerts.ts` | Monday scorecard and the three alerts |
| `src/app/api/cron/metrics-rollup/route.ts` | Hourly and nightly rollup, plus alerts |
| `src/app/api/metrics/*` | Tiles, drill-down records, targets, exclusions (superadmin) |
| `src/app/(dashboard)/analytics/page.tsx` | Replaced by the Growth Dashboard, keeping the URL and nav entry |
