# Handoff to the University: log checkout starts in activity_events

**Owner:** npu-platform-v2. The Hub does not change the University. This is a spec for the University repo.
**Why:** Hub checkout recovery (campaign A) and the outcomes dashboard need to know which paywall a person started
checkout on. Today only seat holds name it, and paywalls with no cohort (the coaching packages) never make one.
The Hub reads the rows read-only (`src/lib/marketing/checkout-link.ts`), and falls back to seat holds when no row exists.

## Rows

| | `checkout_opened` | `enroll_click` |
|---|---|---|
| Where | `src/app/api/stripe/create-checkout/route.ts`, after the paywall is loaded and the Stripe session is created, before the session URL is returned | `src/app/checkout/[slug]/checkout-form.tsx` and the program pages' Enroll buttons, before navigating |
| Client | the route's service-role client, `user_id = user.id` (the route already returns 401 without a user) | the browser client; the insert policy `events_insert` requires `user_id = auth.uid()` |
| `event_type` | `'checkout_opened'` | `'enroll_click'` |
| `event_category` | `'checkout'` | `'checkout'` |
| `event_target` | paywall slug | paywall slug |
| `cohort_id` | the cohort the session is for, or null | the paywall's cohort, or null |
| `metadata` | `{ paywall_id, program_id, price_cents_shown, cohort_id }` | same |

**Signed-out clicks are not logged (ruled 2026-11-08).** `activity_events.user_id` is NOT NULL and the insert policy
requires the signed-in user, so a signed-out click has no row. Nothing is lost for recovery, because `checkout_opened`
always has a user.

**Never let the log block checkout.** Wrap the insert, log only the error code (no email, no name), and continue to Stripe.
This is the Stripe payment flow, so it needs the University's own approval under its CLAUDE.md.

## What the Hub does with them

- It takes the person's latest `checkout_opened` row, made no more than 48 h before they entered the campaign.
- `event_target` has to be an active paywall slug, and that becomes `{{checkout_link}}` = `https://university.neuroprogeny.com/checkout/<slug>`.
- No usable row: it uses the seat hold rule. Neither: the step is skipped and logged.
- `enroll_click` is not used for links. It is kept for the outcomes dashboard.
