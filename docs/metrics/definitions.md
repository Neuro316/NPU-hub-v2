# Growth Dashboard: metric definitions

Read-only mapping done on 2026-11-02 against production (`htfrfaxlcuyawtlztxxm`), corrected on
2026-11-03 from Cameron's rulings: revenue comes from `payments`, comps are the $0 rows, and the
test rows are seeded. Every
metric is computed by the Hub rollup job into `hub_metrics_daily`, using plain service-role
SELECTs on the shared tables. Nothing is written to a University-owned table.

**Status key:**
- ✅ the data exists and the metric is meaningful today
- ⚠ the source exists but is thin, partial or unreliable
- ❌ there is no source yet (see "Gaps")

**Conventions:**
- Days are America/New_York calendar days.
- "In period" means the event timestamp falls inside the period.
- Medians are computed on events that complete inside the period.
- Every metric runs through the **test filter (§0)** and excludes merged contacts
  (`contacts.merged_into_id is not null`).

---

## 0. The shared test filter

One module, `src/lib/metrics/test-filter.ts`, builds the exclusion sets once per run. Every
metric uses it. A person is **test** when any of the following is true:

| # | Rule | Source |
|---|---|---|
| T1 | Email or phone (last 10 digits) matches a row in `campaign_test_contacts` | `campaign_test_contacts.email`, `.phone` (2 rows) |
| T2 | Email is `cameron.s.allen@gmail.com` (profile and contact). Hard-coded, so it holds even if its T3 row is removed | `profiles.email`, `contacts.email` |
| T3 | `hub_metric_exclusions` rows with decision `exclude`, by contact, profile, email or email pattern (a lower-case LIKE pattern). **Seeded at the go:** `cameron.s.allen+%@gmail.com` (any plus address), `cameron.s.allen@gmail.com` and `cameron@neuroprogeny.com` | Hub-owned (hub_223) |
| T4 | Contact tag matching `test` (case-insensitive) | `contacts.tags` (4 contacts today) |

Linked records:
- A test **contact** also excludes the profile with the same email, and the reverse.
- A test **profile** excludes its enrollments, entitlements, bookings, payments, consents,
  sessions, reviews and quiz results.

Purchases are **test** when any of the following is true:

| # | Rule | Source |
|---|---|---|
| P1 | The buyer is a test person | as above |
| P2 | Promo code `CTEST` or `CTEST2` (the codes used for test checkouts) | `promo_redemptions.promo_code` via `enrollment_id` |
| P3 | The program's name contains "Test" (Test Retreat, Sensorium Walkthrough Test Program) | `programs.name` |
| P1a | **The four test payments** (50¢ refunded, $10, $10 and $33.57) are under `cameron@neuroprogeny.com` and `cameron.s.allen+…` addresses, so P1 removes them | `payments.participant_id` → `profiles.email` |
| P4 | **Stripe test mode.** No table records `livemode`. The platform webhook refuses any event whose `livemode` disagrees with `STRIPE_EXPECT_LIVEMODE` (`npu-platform-v2/src/app/api/stripe/webhook/route.ts:67`), so stored Stripe rows are live by construction. Test-mode rows from before that gate can't be told apart by data; P1–P3 catch the known ones | — |

**Not used to exclude:** heuristics on names or emails such as "test" in a name, or
`example.com`.
- Contacts and profiles that match loose patterns (for example `sgranau+test…`) are listed in
  **Analytics › Targets › Review test accounts**, each with **Exclude** or **Keep**.
- Nothing beyond the seeded rows is excluded until Cameron presses Exclude. Keep records that
  the person is real, so they stop being suggested.
- A decision applies to new rollups at once. "Recompute now" (or the nightly run) rewrites
  past days.

---

## 1. Scorecard

### Lead channels

| Channel | `contacts.source` values |
|---|---|
| `inbound_web` | `stripe`, `xregulation`, `neuroreport`, `profile`, `Website`, plus quiz and booking contacts (`university_booking`) |
| `podcast_pr` | `media_appearance`, `Podcast` |
| `inbound_call` | `inbound_call` |
| `event` | `Workshop` |
| `prospecting` | URL sources (instagram, linkedin and others), city or state names, `prospect_unknown`, `instagram_research`, `linkedin_research`, `web_research`, `partner_outreach`, `outreach_2026_06`, `ChatGPT curated public research`, `Thinkers50…` |
| `import` | `Import`, `admin`, `manual-chat`, `manual_ecr` |
| `unknown` | empty source, `other`, `unknown`, `unknown_enrolled`, `unknown_sales`, `wnw_local`, `referral` |

### Metrics

| Metric | Source and filter | Formula | Status |
|---|---|---|---|
| **Leads** | New contacts by `contacts.created_at`; dimension `channel` from the table above | count where channel ∉ {`prospecting`, `import`} (the scorecard counts inbound demand; prospecting is shown separately on Acquisition) | ✅ 22 contacts in Oct, all channels |
| **Assessments sold** | `payments` whose product (the description without "Paywall: ") contains "assessment", by `paid_at`, test excluded. Paid and $0 rows both count, because the Capacity Assessment is a $0 program. Dimension `paid` / `free` | count | ✅ |
| **Booked calls** | `nr_bookings` created in period, status not `released`, for public free call types (WNW Discovery Call, Interesting meeting, Collaboration Meeting) | count | ⚠ 4 real bookings ever |
| **Shows** | `nr_bookings.status='arrived'`, by `starts_at` | count | ⚠ the status exists but is never set yet (no one marks arrival) |
| **Sales (paid)** | `payments` with `amount_cents > 0` and a positive net after refunds, by `coalesce(paid_at, created_at)`, test excluded; dimension = product | count | ✅ |
| **Comps** | `payments` with `amount_cents = 0` and status `succeeded` (100% promo enrollments), shown beside sales; dimension = product | count | ✅ |
| **Clarity sales** | Paid sales with product `clarity-protocol`. Clarity comps count under Comps | count | ✅ |
| **Onboarded** | First valid HRV session (`np_hrv_sessions.valid`, min `start_time` per participant) in period. "Fully onboarded" = consent, pairing and a session | count of clients whose first session falls in the period | ✅ 17 participants with sessions |
| **Revenue** | `payments` (`amount_cents − amount_refunded_cents`, by `coalesce(paid_at, created_at)`, status succeeded, refunded or partially refunded, test excluded) + `acct_payments.amount` (clinic, by `payment_date`) + `fin_income.amount` where `source='manual'`, with no Stripe or NP payment id and status not void, refunded, cancelled or pending (anything taken off-platform). Dimension = stream (`university`, `clinic`, `manual`). Labelled "Revenue" | sum USD | ✅ |
| **Funnel strip** | Leads → Booked calls → Shows → Sales → Onboarded | step conversion = next ÷ previous, same period. The "biggest drop-off" skips Shows until they are recorded (G2) | ⚠ shows are missing |
| **12-week trend** | Each of the above, weekly (Mon–Sun) | — | as above |

## 2. Acquisition

| Metric | Source and filter | Formula | Status |
|---|---|---|---|
| Leads by channel | As Leads, dimension `channel` (prospecting included here) | count | ✅ |
| Leads by source | Raw `contacts.source`, normalized: URLs → host, cities → `prospect_city` | count | ✅ |
| Leads by device | — | — | ❌ G4 |
| Leads by campaign | `campaign_enrollments.campaign_id` (5 rows), plus `contacts.acquisition_campaign` (0 filled) | count | ⚠ |
| Cost per lead | Spend ÷ leads (inbound channels), monthly. Spend = `acct_marketing_charges.amount` where not `waived`, by `month` | $ | ⚠ spend is clinic co-op charges only (G5) |
| Cost per client | Spend ÷ sales, monthly | $ | ⚠ |
| Speed to lead | Per new scorecard lead: minutes from `contacts.created_at` to the first outbound touch, which is the earliest of: `crm_messages` (direction `outbound`, joined through `conversations.contact_id`), `call_logs` (direction `outbound`), `message_sends` (`dry_run=false`, sent), `email_sends.sent_at`. **A lead with no touch yet counts the minutes it has waited so far** | median minutes over the leads created in the range | ⚠ Gmail-sent replies aren't visible (G6) |
| Lead → booked rate by source | Leads in period that have any `nr_bookings` (matched by email: contact ↔ lead or profile) within 30 days ÷ leads, by channel | % | ⚠ |

## 3. Sales

| Metric | Source and filter | Formula | Status |
|---|---|---|---|
| Pipeline value by stage | `hub_pipeline_deals.value` for open deals (`won_at` and `lost_at` null), dimension = pipeline › `contacts.pipeline_stage` | sum $, snapshot per day | ⚠ few values entered |
| Booked / held / no-show | `nr_bookings` status `confirmed` / `arrived` / `no_show`, by `starts_at` | count | ⚠ held and no-show never set |
| Close rate | Sales ÷ booked calls (rolling 30 days) | % | ⚠ |
| Median days lead → purchase | Contact `created_at` → first sale (enrollment or entitlement), joined by email | median days | ✅ |
| Revenue by product | University payments only, by product (the payment description) | sum $ | ✅ |
| Checkout started vs paid | Started: `np_onboarding_log` / enrollments in `pending` status | — | ❌ G7 (no checkout-started record) |
| Promo sales | `promo_redemptions` by `created_at`, dimension = code; P2 excluded | count, discount $, final $ | ✅ |
| Partner-referred sales | `affiliate_referrals` (0 rows), `promo_redemptions.affiliate_id` (0 set) | count | ❌ G8 |

## 4. Onboarding

Cohort: buyers (sales as above) per purchase date.

| Step | Source | Default target |
|---|---|---|
| Purchase | Enrollment `enrolled_at` / entitlement `granted_at` | — |
| Consent signed | First `consent_signatures.affirmed_at` for the user (`user_id`) on or after purchase | 2 days |
| Headset paired | `np_onboarding_log.event_type='xreg_pairing_paired'` (`profile_id` / email), or the first `np_hrv_participant_map.mapped_at` for the participant | 7 days |
| First session | First valid `np_hrv_sessions.start_time` for the participant | 10 days |

- **Metrics:** median days per step; the share reaching each step.
- **Stuck list:** named people past each step's target with the step not done. Name, email,
  purchase date, days waiting, and a link to the contact. This is the one place the dashboard
  names people, and it shows no biometric values.
- Status ✅ (84 consents, 17 HRV participants).

## 5. Client outcomes (aggregates only, never per person)

"Active client" = a non-test profile with a valid HRV session, a practice session or a
completed lesson in the last 14 days.

| Metric | Source | Formula | Status |
|---|---|---|---|
| Active clients | as defined | count | ✅ |
| Practice sessions per client per week | `np_hrv_sessions` (valid) + `practice_sessions`, per active client | mean | ✅ (practice_sessions has 2 rows; HRV carries it) |
| Lessons completed | `lesson_progress.completed_at` | count | ✅ |
| Completion rate | Enrollments with `completed_at` ÷ enrollments started ≥ the program's access period (or 90 days) ago | % | ⚠ few completions |
| Self-report change | `nr_quiz_results.composite_score`, first vs latest per profile, for `quiz_type` in (`nsci`, `biometric`), people with ≥ 2 results | mean delta, n | ⚠ 3–4 people |
| Improving HRV trend | Per participant with ≥ 6 valid sessions in 90 days: slope of `rmssd` over time > 0 | share of participants (n shown; hidden when n < 5) | ✅ |
| Review ratings | `program_reviews.overall_rating` | mean, count | ✅ 28, mean 5.0 |

## 6. Retention and expansion

| Metric | Source | Formula | Status |
|---|---|---|---|
| Clarity → Capacity upgrades | A profile with a `clarity-protocol` entitlement that later gets a Capacity Protocol entitlement or enrollment (`capacity-protocol*` keywords, programs named "Capacity Protocol…") | count by upgrade date | ✅ |
| Membership tier mix | `subscriptions` (0 rows) | — | ❌ G9; shown from `entitlements` keywords as a stand-in |
| Refunds | `payments.amount_refunded_cents > 0`, on the payment's date (no refund date is stored) | count, $ | ✅ |
| Repeat purchase | Buyers with ≥ 2 distinct paid products, all time | count | ✅ |
| Lifetime value | All-time University revenue ÷ paying buyers (net of refunds) | mean $ | ✅ |

## 7. Marketing engine

| Metric | Source | Formula | Status |
|---|---|---|---|
| Entered | `campaign_enrollments.enrolled_at` per `campaign_id` | count | ⚠ 5 rows |
| Sent / delivered / opened / clicked / bounced / complained | `message_sends` (non-dry-run) `sent_at`, `delivered_at`, `opened_at`, `clicked_at`, `bounced_at`, `complained_at`, campaign via `source_kind`/`source_id` | count, rates | ❌ G10 no live sends yet (2 dry runs) |
| Unsubscribed | `contacts.email_unsubscribed_at` for contacts in the campaign | count | ✅ source exists |
| Booked / purchased | Campaign contacts with a booking or sale after `enrolled_at` | count | ⚠ |

## 8. Content and PR

| Metric | Source | Formula | Status |
|---|---|---|---|
| Posts published | `social_posts.published_at` | count | ❌ G11 (4 drafts, none published from the Hub) |
| Podcasts | `media_appearances` (`type`/`entry_type` podcast) by `air_date` | count | ✅ 26 |
| Leads per podcast or post | `podcast_conversions` (by `appearance_id`); contacts with source `media_appearance` | count | ⚠ 4 conversions |
| Sales per podcast or post | `podcast_conversions.conversion_type` purchase, plus promo codes in `media_appearances.promo_code` matched to `promo_redemptions` | count, $ | ⚠ |

## 9. Operations health

| Metric | Source | Formula | Status |
|---|---|---|---|
| Each cron's last run and failures | `job_runs` per `job`: last `started_at`, `ok`, consecutive failures | — | ✅ |
| Inbox waiting | `hub_mail_messages.status='new'` | count, oldest age | ✅ 9 |
| Support tickets open and age | `support_tickets` status not resolved or closed | count, median age | ✅ |
| Overdue tasks | `kanban_tasks.due_date < today` and `completed_at` null | count | ✅ 140 |

---

## Gaps: what to start collecting

| # | Gap | What would close it |
|---|---|---|
| G1 | **Closed 2026-11-03 (my error).** The first mapping read `payments` as empty. It holds 29 rows, 5 with amounts, and four of those are Cameron's tests. The platform ledger is accurate. Revenue now comes from `payments`, and no Stripe reader is needed | — |
| G2 | **Shows and no-shows.** `nr_bookings.status` supports `arrived` / `no_show`, but nothing sets them | Mark arrival in the University, or infer it from the Zoom join |
| G3 | **Comp vs sale (ruled).** A $0 payment (100% promo) is a comp. It is shown beside sales and not counted as one | — |
| G4 | **Lead device.** No table stores a device or user agent | Capture it at the lead forms and quiz (University) |
| G5 | **Ad spend.** Only clinic marketing co-op charges exist (`acct_marketing_charges`) | A spend table or entries per channel |
| G6 | **Gmail replies** from connected mailboxes don't count toward speed to lead (only inbox mail is synced) | Sync the Sent label in mail-sync |
| G7 | **Checkout started.** There's no record of an abandoned checkout | Write a row when a Stripe Checkout session is created |
| G8 | **Partner referrals.** `affiliate_referrals` is empty and promo `affiliate_id` is never set | Attribute affiliate codes |
| G9 | **Memberships.** `subscriptions` is empty | — |
| G10 | **Email engagement.** The marketing engine hasn't sent live yet | Comes with the first live campaign |
| G11 | **Post publishing** isn't recorded (no published posts) | Publish through the Hub, or log posts |
| G12 | **Push notifications.** The Hub has no push channel (`docs/HUB_PWA_PUSH_FEASIBILITY.md`: greenfield) | Step 5 sends SMS through `hub_sms_outbox`; push needs its own build |
| G13 | **Lead attribution.** `contacts.acquisition_source` / `acquisition_utm` are never filled | Fill them at contact creation from UTM parameters |
