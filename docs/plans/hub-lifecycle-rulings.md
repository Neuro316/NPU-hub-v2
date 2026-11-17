# Lifecycle engine: booking routes and triggers (Running List q06, q07, q19, q20, q21)

Branch `feat/booking-routes-triggers`. Proposed 2026-11-16. Nothing is applied and nothing is live.

## Order at the go

1. Nonprod: `supabase/nonprod/catchup_2026-11-16.sql` (PR #49), then `hub_237_lifecycle_events`. Run NOTIFY and the
   read-back.
2. Production: `hub_237_lifecycle_events`. Run NOTIFY and the read-back.
3. Production: `supabase/data-fixes/2026-11-16_lifecycle_setup.sql`. This creates the stages, the routes, and the
   settings in **dry_run**, plus three campaign drafts with inactive routes.
4. Merge. The `/api/cron/lifecycle` cron then records events in `hub_lifecycle_events` with `mode = 'dry_run'` and
   `planned` filled in. Nothing else is written.
5. Walkthrough on the dry-run rows. Going live means two changes: set `hub_lifecycle.mode` to `live`, and then
   activate campaign routes one at a time. Each is a separate go.
6. Separately: `supabase/data-fixes/2026-11-16_wnw_discovery_cards_to_sales.sql`. It moves 1 card (count checked on
   16 Nov).

## Routing (org_settings `hub_booking_type_routes`)

| Appointment type | Org | Kind | Pipeline | Stage | Tag |
|---|---|---|---|---|---|
| Discovery Call | NP | lead | Sales Pipeline | Discovery call Scheduled | Neuro Progeny |
| WNW Discovery Call | NP | lead | Sales Pipeline | Discovery call Scheduled | WNW |
| 15 Minute Coaching Session (x2: free and balance) | NP | activity | the client's Enrolled (no placement) | none | none |
| 30 Min / 30 Minute Coaching Session (x2) | NP | activity | Enrolled | none | none |
| 60 min / 60 Minute Coaching Session (x2) | NP | activity | Enrolled | none | none |
| 30 and 60 Minute Coaching, 5 Sessions | NP | activity | Enrolled | none | none |
| Weekly 30 and 60 Minute Coaching, 6 Months | NP | activity | Enrolled | none | none |
| Weekly 30 and 60 Minute Coaching, Phases 2 and 3 | NP | activity | Enrolled | none | none |
| 30 Min and 60 Min Coaching Session | WNW | activity | Enrolled | none | none |
| Neuro Session | WNW | activity | Enrolled | none | none |
| Interesting meeting | NP | lead (University route, unchanged) | NP Email Meetings | Meeting Booked | none |

Not routed: Collaboration Meeting, Mentor Meeting, Report of Findings, Experiential Neuro Psych's Interesting meeting,
and the retired probes.

A held discovery call moves to Sales / Discovery Call (`booking_completed_stages`, now including WNW).

**Rules**

- The brand tag is added only when the contact has neither tag, so a tag changed by hand on the card stays.
- A coaching booking never creates a contact. A WNW-org booking is matched by email to the Neuro Progeny contact.
- The Hub routes replace the University's route rows only in `live`. Until then the two University rows decide.

## Events

| Event | Source (read only) | Enrolled move | Campaign | Task |
|---|---|---|---|---|
| booking made (discovery) | hub_booking_syncs | none (Sales placement by the sync) | exits Discovery no-show; Discovery booked starts from its stage route | closes lead and no-show tasks |
| booking held | hub_booking_syncs | none (Sales / Discovery Call by the sync) | exits Discovery booked, Discovery no-show; Post-discovery starts from its stage route | none |
| booking no-show | nr_bookings status no_show | none | enrolls Discovery no-show, exits Discovery booked | opens "missed discovery call" |
| booking cancelled | hub_booking_syncs | none | Discovery booked exits on its own booking_cancelled rule | none |
| held, no purchase 2 days | ledger | none | none | opens "no purchase 2 days after call" |
| coaching booked or held | nr_bookings (activity types) | none | none | closes the 7-day task (activity) |
| checkout started | funnel_events checkout_opened | none | enrolls Checkout recovery | none |
| checkout unpaid 1 hour | ledger | none | (Checkout recovery's own delay is 1 hour) | none |
| purchase: Phase 1, 2, 3, Clarity, assessment, Fresh Air, WNW | funnel_events payment_succeeded + program and paywall | Purchased | enrolls Client onboarding; exits Checkout recovery, Post-discovery, Discovery no-show | closes lead, no-show and held-no-purchase tasks |
| purchase: coaching or other | same | none | exits Checkout recovery | closes the same tasks |
| consent signed | funnel_events consent_signed | Consent signed | none | none |
| first lesson opened | funnel_events first_lesson_opened | Onboarded | none | closes the 7-day task |
| first practice or HRV session | practice_sessions, hrv_sessions | Active | exits Client onboarding | closes the 7-day task |
| no activity 3 days (enrolled; key inactive_5d) | lessons, practice, HRV, lesson events, held sessions | Drop-off risk | enrolls Drop-off nudge | none |
| no activity 7 days (enrolled; key inactive_10d) | same | none | none | opens "client quiet for 7 days" |
| activity resumed | same | Drop-off risk back to Active | exits Drop-off nudge | closes the 7-day task |
| program end | enrollments completed_at or access_ends_at | Completed | exits Drop-off nudge, Client onboarding | closes the 7-day task |
| lead, no touch 24 hours | contacts (inbound sources) + texts, calls, sends, emails, shared Gmail | none | none | opens "new lead, no reply yet"; closes on a touch, booking or purchase |

- Every event writes one ledger row, unique on its key. In live it writes one timeline row, keyed on that ledger row.
- Every stage move records its time and source: `contact_pipeline_positions.moved_at` and `source`
  (`lifecycle:<event>` or `booking_route:...`), and the hub_229 trigger's timeline entry.
- Tasks are CRM tasks (`source = hub_followup:<reason>`) linked to the contact and assigned to Cameron, with a card
  in Action Steps. A unique index allows one open task per contact and reason.

**Inactivity thresholds changed on 17 Nov (Shane):** 3 days quiet is Drop-off risk and 7 days opens the check-in
task (was 5 and 10). The keys `inactive_5d`, `inactive_10d` and `enrolled_inactive_10d` keep their historical names,
because hub_237's check constraint and existing ledger rows use them.

## Not wired, and why

- **Clarity:** no University program or paywall is named Clarity today. The classifier recognises the word, so it
  starts counting once one exists.
- **Purchase moving the Sales card:** Sales has "Clarity Phase 1 to 3" stages, and whether Clarity means the
  Capacity Protocol is not decided. Purchases move Enrolled only.
- **checkout_opened events:** none exist in production yet (`funnel_events` has the step name and `activity_events`
  has none). Checkout recovery starts once the University emits them.
- **Enrolled's old stages** (Signed up, Paid, ..., Checkout started) stay. Retiring them is a board decision.
- **Campaign emails are `marketing` kind,** so the consent gate applies. Client onboarding for a paying client may
  want a transactional kind. That is a ruling for the go.
