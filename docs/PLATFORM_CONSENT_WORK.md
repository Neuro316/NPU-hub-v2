# What `npu-platform-v2` owes the Hub consent design

**Filed from the Hub, 2026-07-25. This is a handoff, not a work order executed here.**
Every item below is in `npu-platform-v2`. **No file in that repo was edited.** All findings are from
authorized read-only inspection, with file and line references so each can be queued in the platform tracker.

Companion to `docs/HUB_Bulk_Campaigns_Design.md`. The constraint in **§12.2b** of that document depends on
item 3 landing first, and item 1 is the actual unlock for the email audience.

---

## 0. THE CHECKOUT CONSENT-CAPTURE PATH HAS NEVER EXECUTED

**Investigate this before scoping items 1 through 4. All four are downstream of it.**

The checkout consent code exists, is correctly shaped, and writes to the right columns. It has never run.

Verified against the shared database, 2026-07-25:

| Measure | Count |
|---|---|
| Succeeded payments | **3** |
| Enrollments | **4** |
| Participant profiles | **17** |
| Contacts with `source ilike 'Paywall:%'` | **0** |
| Contacts at `pipeline_stage = 'Checkout started'` | **0** |
| Live contacts with `terms_accepted_at` | **0** |
| Live contacts with `sms_consent_at` | **0** |

`create-checkout/route.ts` writes `source: 'Paywall: {name}'` and `pipeline_stage: 'Checkout started'` on both
the create and update branches. **Neither value appears on a single contact row.** Real money moved and real
people enrolled, yet no contact was created or updated by that path.

**Root cause is unknown and was not investigated.** This handoff records the observation, not a diagnosis.
Candidate explanations, none confirmed:

- The three payments predate the consent-capture code and nothing has transacted since.
- Purchases are arriving through a different path (Stripe dashboard, a payment link, manual enrollment) that
  never touches `create-checkout`.
- The contact write runs but fails silently. The surrounding code does not check the error on either branch,
  which is the same swallowed-error pattern that hid the `email_sends` gap in the Hub for weeks.
- The route is reached but returns before the contact block.

**Why this leads the page.** Items 1 through 4 all assume the checkout path runs. Building email consent
capture, fixing the unconditional `sms_consent_at`, and versioning the consent text each change what happens
*when checkout executes*. **If checkout never executes, none of it fires, and the work produces no consent
records at all.** Determining which of the above is true is the first task; it may also change what items 1
through 4 should look like.

**First diagnostic step:** confirm whether the 3 succeeded payments went through `create-checkout` at all —
check for the `[create-checkout] server-derived amount` log line, which that route emits on every checkout
immediately before the Stripe call. Its **absence** is proof the route never ran, exactly as the platform's own
CLAUDE.md prescribes for distinguishing "the guard worked" from "the code never ran."

---

## 1. Email consent capture does not exist. Anywhere.

**Priority: the unlock, once item 0 is understood. Everything below this is cleanup by comparison.**

There is no email consent capture in any surface, in either repo. Every capture point that exists is SMS.

| Surface | File | What it does |
|---|---|---|
| Signup | `src/app/signup/page.tsx:242-245` | Passive notice: *"By creating an account you agree to the Terms & Conditions and Privacy Policy."* **No checkbox. No column written. No row stored.** |
| Checkout | `src/app/checkout/[slug]/checkout-form.tsx:530` | SMS checkbox only |
| Paywall | `src/app/paywall/[code]/page.tsx:170-172` | SMS only |

Confirmed against the shared database on 2026-07-25: **0 contacts carry `email_consent_at`**, and the only
code path that could set it (`POST /api/contacts/consent` in the Hub) has left no fingerprint on any row.

**Consequence.** The Hub's email audience rests entirely on the §5.2 cohort judgment — a documented business
decision under an opt-out regime, defensible for email and worthless under the TCPA. **No contact anywhere has
ever affirmatively agreed to receive email from Neuro Progeny or Sensorium.** Until a capture surface exists,
the audience cannot grow on evidence, only on judgment.

**What is owed:** a real email opt-in — checkbox at signup and checkout, double opt-in confirmation, and a
public preference page — each writing a `consent_events` row with genuine evidence (IP, user agent, form URL,
the exact text shown, confirmation token). Shape is specified in `HUB_Bulk_Campaigns_Design.md` §4.2 and §5.1.

---

## 2. `sms_consent_at` is written even when the box is unchecked

**File:** `src/app/api/stripe/create-checkout/route.ts`, **lines 260 and 283** (both branches).

```ts
sms_consent:    sms_consent || false,
sms_consent_at: terms_accepted_at || new Date().toISOString(),   // written unconditionally
```

The timestamp is written regardless of whether `sms_consent` is true, so a customer who deliberately leaves the
box unchecked still receives a consent timestamp.

**This is not hypothetical.** Melissa Allen's record carries `sms_consent = false` **with** `sms_consent_at`
populated at `2026-07-15 20:43:44Z`. She declined, and the row looks timestamped.

**Why it matters more than it looks.** Today the column is only read as provenance-for-true, so the stray
timestamp is inert. The moment `consent_events` treats a timestamp as evidence, this becomes **documentary
evidence of a consent that was explicitly refused** — the worst possible direction for a consent defect.

**What is owed:** write `sms_consent_at` only when `sms_consent` is true. One conditional, both branches.

---

## 3. Consent text is hard-coded and unversioned, in three places

| File | What lives there |
|---|---|
| `src/app/checkout/[slug]/checkout-form.tsx:530` | The checkbox label the user actually reads |
| `src/app/checkout/[slug]/page.tsx:29-41` | Server-rendered A2P disclosure (server-rendered deliberately, for Twilio's crawler) |
| `src/app/sms-consent/page.tsx` | Standalone A2P verification page |

Nothing stores what was shown at the moment of consent, and nothing versions it. Asked in two years what a
given person agreed to, the only available answer is to read the current source file and hope it never changed.
**"We have a boolean" is not a defense. "Here is the sentence they agreed to, the URL, and the timestamp" is.**

The right primitive already exists in the schema and is unused: `nr_quiz_results.consent_version_accepted`
(table currently empty). It is the only versioning concept anywhere in the system.

**What is owed:** extract each string to a versioned constant, store the version alongside every consent
record, and keep prior versions retrievable. Do not edit the copy in place without incrementing a version.

**Care required:** these pages are server-rendered specifically so Twilio's crawler can verify opt-in text
without JavaScript, and the A2P campaign was approved after three rejections. Per the platform's own CLAUDE.md:
never move SMS consent back to a client-only component. Version the text; do not restructure the pages.

---

## 4. HARD ORDERING CONSTRAINT — the platform gates a Hub migration

**Read `HUB_Bulk_Campaigns_Design.md` §12.2b before scheduling any of this.**

The Hub's Layer 1 makes `contacts.email_consent` and `sms_consent` trigger-derived and **revokes `UPDATE` on
those columns from the application role.** The platform writes those exact columns directly, on the money path:

- `src/app/api/stripe/create-checkout/route.ts:259-262` (existing-contact branch)
- `src/app/api/stripe/create-checkout/route.ts:282-285` (new-contact branch)

Both write into the **shared** `contacts` table in `htfrfaxlcuyawtlztxxm`. The Hub does not own this writer.

**Required order:**

1. Platform switches to writing `consent_events` instead of the `contacts` columns.
2. Verified live with a real checkout producing a real `consent_events` row.
3. **Only then** does the Hub revoke the app-role `UPDATE` grant.

> **If this runs in the wrong order, every Stripe checkout starts failing at contact-write and payments stop.**

The Hub cannot verify step 2 on its own, and the revoke does not fail loudly on the Hub side. It fails in
platform checkout, in production.

---

## Summary

| # | Item | Priority | Blocks |
|---|---|---|---|
| **0** | **Checkout capture path has never executed** | **Investigate FIRST** | Scoping items 1–3 meaningfully |
| 1 | Email consent capture does not exist | Highest, once 0 is understood | Any evidence-based email audience |
| 2 | `sms_consent_at` written unconditionally | High before `consent_events` | Ledger correctness |
| 3 | Consent text hard-coded, unversioned | Medium | Ability to answer "what did they agree to" |
| 4 | Shared-column write collision | **Sequencing gate** | Hub Layer 1, and the money path if ignored |

**Item 0 is a question, not a task, and it gates the estimate on 1 through 3.** Those three assume the checkout
path runs; if it does not, fixing them produces no consent records. Items 2 and 3 should land before the Hub's
`consent_events` migration so the ledger imports clean data. Item 4 is a sequencing constraint rather than a
defect. Item 1 is a project.
