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

### Product line (ruled 2026-11-09)

University paywalls in org 0001, by slug. A checkout is one payment for the paywall in its description **plus the
add-ons bought with it** (Phase 3 or coaching on a Phase 1 or Phase 2 checkout): add-ons are `enrollments` whose
`metadata` carries `addon_id` and the same `stripe_session_id` as the payment's `stripe_metadata.session_id`. An
add-on is classified by its program's paywall slug, or by its program name when it has no paywall of its own.

| Kind | Slugs |
|---|---|
| Phase 1 | `capacity-protocol` ($3,297), and `capacity-protocol-phases-1-2-3` (covers Phases 1, 2 and 3) |
| Phase 2 / Phase 3 | `capacity-protocol-phase-2`, `capacity-protocol-phase-3`, `capacity-protocol-phases-2-3`, and the 1-2-3 bundle |
| Coaching 30 / 60 min | slugs containing `coaching`, split by `30-minute` / `60-minute` (single sessions, 5-packs, 6-month and phases-2-3 packages); 15-minute sessions are coaching but in neither split |
| Retired | `clarity-protocol` (history stays readable on the Sales tab; not core, not lead-gen) |
| WNW | slugs starting `wnw` (`wnwhp`, `wnw-in-office-program`, `wnw-neuro-program`): their own revenue bucket, `wnw_revenue`. A WNW coaching add-on is still coaching and counts against the 10 coaching hours |
| Lead-gen | everything else (artifacts, worksheets, Fresh Air, Capacity Assessment, Golf) |

**Comps never count toward a goal (ruled 2026-11-09).** A comp is a `succeeded` payment of $0 (every product has a
list price). No targeted metric counts one: Phase 1 sales, the Phase 1 cohort (a comped Phase 1 buyer is not in it),
Phase 2/3 conversion (a comped Phase 2/3 is not a conversion), coaching attach, core and every other revenue,
assessments sold, new clients, new lead-gen buyers, promo redemptions, onboarding steps and the stuck list, and
Onboarded (a participant whose University purchases are all comps is not counted; people with no University
purchase still are). Comps are tracked on the Sales tab: **Comps** (count) and **Comps at list value**, whose list
shows who, what (with add-ons), the date and the list value. Clarity → Capacity upgrades count only a Capacity grant backed by a paid Phase 1
purchase; a comped grant is never an upgrade, and a grant with no payment at all is listed under Comps as
"(granted, no payment)" at the Capacity paywall's list price.

A bundled payment's revenue is split across its lines in proportion to list price (the add-on's sale price, else its
price, else the paywall's price); with no prices, the main line takes it all. The split is an estimate: Stripe has
one amount per checkout.

### Metrics

| Metric | Source and filter | Formula | Status |
|---|---|---|---|
| **Phase 1 sales** | Payments with a Phase 1 line, paid (`amount_cents > 0`, positive net), test excluded, comps excluded; dimension = product | count | ✅ |
| **Phase 1 → Phase 2/3** (`phase23_conversion`) | Cohort: people whose **first paid Phase 1 purchase** is in the range (dimension `cohort` = its month). Converted = a paid purchase with a Phase 2 or 3 line (Phase 2, Phase 3, phases-2-3, the 1-2-3 bundle at entry, or a Phase 3 add-on in the Phase 1 checkout) from a day before the Phase 1 purchase **up to today**. `phase23_conversion_60` (Sales tab): the same within 60 days | converted ÷ cohort, % per range and per cohort month. A cohort's row is refreshed while it is inside the nightly 120-day recompute | ✅ |
| **Coaching attach, 30 / 60 min** | Of the same Phase 1 cohort, those with a 30-minute (or 60-minute) coaching line, as an add-on or bought separately, within 90 days of the Phase 1 purchase | % — **information only, no target** | ✅ |
| **Core revenue** | Net of Phase and coaching lines (bundles split as above); dimension = kind | sum USD | ✅ |
| **Coaching hours booked** | `nr_bookings` on coaching appointment types (name contains "coaching"), status not `cancelled` or `released`, test excluded, **by session day (`starts_at`), including sessions later in the month**: "this month" runs to the month's end. Hours from `ends_at − starts_at`, else the type's duration. Dimension = length (60, 30 or 15 min); `coaching_hours_60` and `coaching_hours_30` carry the split for targets | sum hours. Target 10 a month (5 of 60-minute, 5 of 30-minute), compared with the whole month, not prorated to today | ✅ (no coaching bookings yet) |
| **Coaching capacity used** | Hours booked ÷ capacity, capacity = 10 hours a month (`COACHING_HOURS_PER_MONTH`), prorated per day of the range | %. Target 100%, **lower is better: amber from 90% (exactly 10 hours is at capacity, amber), red above 100%** (thresholds 0.90 / 1.01; over capacity is the warning) | ✅ |
| **Coaching committed, next 5 weeks** | As of today: coaching `program_sessions` with status `owed` (not expired), at **one session a week per person** for the next 5 weeks, less that person's sessions already `scheduled` in the window, filled from their earliest package first, × the package's session length. A weekly 6-month package shows 5 sessions, a single session 1, and a person holding two weekly packages still counts 5. Dimension = length | hours, snapshot. Information only | ✅ |
| **Leads** | New contacts by `contacts.created_at`; dimension `channel` from the table above | count where channel ∉ {`prospecting`, `import`} (the scorecard counts inbound demand; prospecting is shown separately on Acquisition) | ✅ 22 contacts in Oct, all channels |
| **Assessments sold** | `payments` whose product (the description without "Paywall: ") contains "assessment", by `paid_at`, test excluded, **paid only** ($0 rows are comps since 2026-11-09). Dimension = product | count | ✅ |
| **Booked calls** | `nr_bookings` created in period, status not `released`, for public free call types (WNW Discovery Call, Interesting meeting, Collaboration Meeting); coaching types are never calls (2026-11-09), whatever their payment flow | count | ⚠ 4 real bookings ever |
| **Shows** | `nr_bookings.status='arrived'`, by `starts_at` | count | ⚠ the status exists but is never set yet (no one marks arrival) |
| **Sales (paid)** | `payments` with `amount_cents > 0` and a positive net after refunds, by `coalesce(paid_at, created_at)`, test excluded; dimension = product | count | ✅ |
| Comps (Sales tab) | `payments` with `amount_cents = 0` and status `succeeded` (100% promo enrollments); dimension = product. With **Comps at list value** (the paywall's price plus its add-ons'). Never toward a goal; no target | count, $ | ✅ |
| Clarity sales (Sales tab) | Paid sales with product `clarity-protocol`. Clarity comps count under Comps. **Retired 2026-11-09**: off the scorecard, no target, history readable | count | ✅ |
| **Onboarded** | First valid HRV session (`np_hrv_sessions.valid`, min `start_time` per participant) in period, except participants whose University purchases are all comps. "Fully onboarded" = consent, pairing and a session | count of clients whose first session falls in the period | ✅ 17 participants with sessions |
| **Revenue** | `payments` (`amount_cents − amount_refunded_cents`, by `coalesce(paid_at, created_at)`, status succeeded, refunded or partially refunded, test excluded) + `acct_payments.amount` (clinic, by `payment_date`) + `fin_income.amount` where `source='manual'`, with no Stripe or NP payment id and status not void, refunded, cancelled or pending (anything taken off-platform). Dimension = stream (`university`, `clinic`, `manual`). Labelled "Revenue" | sum USD | ✅ |
| **Funnel strip** | Leads → Booked calls → Shows → Phase 1 sales → Onboarded | step conversion = next ÷ previous, same period. The "biggest drop-off" skips Shows until they are recorded (G2) | ⚠ shows are missing |
| **12-week trend** | Each of the above, weekly (Mon–Sun) | — | as above |

### Targets (Targets tab, superadmins only)

`hub_metric_targets`, one row per metric and month; a month without its own row uses the latest earlier month's.
A count, money or hours target is a **monthly total**, prorated per day and compared with the pace so far (coaching
hours: with the whole month). A rate, median or level target is a **level**, compared directly. Each row has a
**direction**: higher is better (green at or above amber × target, amber at or above red × target, else red;
defaults 90% / 75%) or lower is better (green at or below amber × target, amber at or below red × target, else red;
defaults 100% / 125%). Information-only tiles (coaching attach, committed hours, Clarity, client outcomes) take none.

**Work back from the goal:** from the month's Onboarded target and the live rates of the last 90 days, booked calls
= Onboarded ÷ close rate, shows = booked calls × show rate, leads = booked calls ÷ lead-to-booked rate (rounded up;
a week = a month × 12 ÷ 52). One click saves leads, booked calls and shows as that month's targets. It assumes one
onboarded client per sale.

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
| Show rate | Shows ÷ (shows + no-shows), by `starts_at` | % | ⚠ few marked |
| Coaching revenue | Net of coaching lines (bundles split by list price); dimension = slug | sum $ | ✅ |
| Lead-gen revenue | Net of lead-gen lines (everything that is not a Phase, coaching, WNW or Clarity) | sum $ | ✅ |
| WNW program revenue | Net of WNW lines | sum $ | ✅ |
| New lead-gen buyers | A person's **first paid** lead-gen purchase, in the range; dimension = product | count | ✅ |
| Lead-gen buyers → Phase 1 | Of those, the ones with a later paid Phase 1 purchase (by today) | % | ✅ |
| Median days lead → purchase | Contact `created_at` → first sale (enrollment or entitlement), joined by email | median days | ✅ |
| Revenue by product | University payments only, by product (the payment description) | sum $ | ✅ |
| Checkout started vs paid | Started: `np_onboarding_log` / enrollments in `pending` status | — | ❌ G7 (no checkout-started record) |
| Promo sales | `promo_redemptions` by `created_at`, dimension = code; P2 excluded | count, discount $, final $ | ✅ |
| Partner-referred sales | `affiliate_referrals` (0 rows), `promo_redemptions.affiliate_id` (0 set) | count | ❌ G8 |

## 4. Onboarding

Cohort: paid buyers (sales as above, comps excluded) per purchase date.

The step targets live in `hub_metric_targets` (metrics `days_to_consent`, `days_to_pairing`,
`days_to_first_session`, lower is better) and are edited in Targets; the defaults below apply when a month has no row.

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
| Clarity → Capacity upgrades | A profile with a `clarity-protocol` entitlement that later gets a Capacity Protocol entitlement (`capacity-protocol*` keywords), counted only when a **paid** Phase 1 purchase (after the Clarity grant, up to two days after the Capacity grant) backs it. Comped grants never count; unpaid grants appear under Comps | count by upgrade date | ✅ |
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
