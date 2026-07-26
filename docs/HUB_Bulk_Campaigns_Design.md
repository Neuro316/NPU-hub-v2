# NPU Hub CRM: Bulk Email and Bulk SMS Campaigns

**Repo:** NPU-hub-v2 only. **Supabase project:** `htfrfaxlcuyawtlztxxm` (shared with npu-platform-v2 and neuroreport-app).
**Status:** Design and proposal. No migration has been applied. No schema has changed.
**Live verification date:** 2026-07-25. Every count in this document carries that date and a source query ID from the Appendix.

---

## §0 Status, scope, boundaries

### 0.1 What this document is

This is the single authoritative spec for bulk email and bulk SMS campaigns in the Hub CRM. It supersedes and merges four prior documents:

| Source | Role in this merge |
|---|---|
| `NPU_Hub_Bulk_Campaigns_Design_v594.md` (594 lines, 2026-07-24) | **Primary source for the data model.** Part 2 DDL, Part 5 enforcement model, Part 2.6 suppression precedence are ported from here. |
| `HUB_Bulk_Campaigns_Design.md` (342 lines) | The file this document replaces. It was a rewrite of v594 that lost the DDL and the `do_not_contact` and phone-format findings. |
| `bulk-campaigns-design.md` (790 lines, untracked) | Source of the manufactured-consent finding and the dead-route inventory. |
| Live verification, 2026-07-25 | **Wins every disagreement.** See §1.5. |

The three source documents remain in `docs/` pending review and are to be deleted once this document is accepted, so that exactly one spec remains.

### 0.2 SCOPE SPLIT BY CHANNEL (2026-07-26) — read this before anything else

**This document was written as one feature. It is now two, over a shared substrate. A cold session reading any section below without this split will build the wrong thing.**

| | **SMS** | **EMAIL** |
|---|---|---|
| What it is | **Participant reminders** | **Newsletters** |
| Classification | **Transactional, NOT marketing** | **Marketing** |
| How a send starts | **Manual, from the Conversations section.** Staff select contacts (usually filtered by enrolled pipeline stage), compose, send. | Campaign entity, scheduled |
| Campaign entity | **None** | Yes (§4.4) |
| Audience resolver | **None** — staff pick the recipients | Yes (§5.2 Layer 3) |
| Preflight report | **None** | Yes (§6.1) |
| Approval flow | **None** | Yes (§6.1) |
| AI composer + voice lint | **None** | Yes (§9) |
| Status | **Buildable now** on the shared substrate | **Blocked** on platform-side consent capture, which does not exist (`docs/PLATFORM_CONSENT_WORK.md` items 0 and 1) |

**The shared substrate serves both and is the current build:**

- `consent_events` (§4.2)
- `message_sends` (§4.3)
- `assertSendable()` (§5.3)

**Everything above that line is now per-channel.** §4.4 campaign tables, §6.1 preflight and approval, and §9 composer are **EMAIL ONLY and DEFERRED**. They are not deleted, because the newsletter needs them exactly as specced.

**A future university calendar integration will eventually drive SMS reminders. NOT NOW. Nothing in this build may assume it exists**, and no schema should be shaped around it in advance.

**Consequence for consent.** SMS being transactional does not loosen the consent rule. D1 (§5.2) still applies: SMS is strict opt-in, `existing_business_relationship` never satisfies an SMS send, and STOP handling is still required. Transactional describes the *content*, not the permission.

### 0.2b Definition of done, per channel

**SMS (this build):** staff filter contacts by pipeline stage in Conversations, compose, send; every send passes `assertSendable('sms', …)`, writes a `message_sends` row, and honours STOP via a `consent_events` revoke. No campaign object exists.

**EMAIL (deferred):** compose a campaign, resolve an audience, see a preflight count, test send, approve, launch, throttled delivery, per-recipient ledger, unsubscribe handled, engagement rolled up.

Both org-scoped for white-label across Neuro Progeny and Sensorium. Consent capture is a **component of the email feature**, not an external gate that must clear first.

### 0.3 Boundaries that govern any session working from this document

- **NPU-hub-v2 only.** Do not edit or commit anything in `npu-platform-v2` or `neuroreport-app`. Read-only inspection of those repos requires explicit per-question authorization; report and come back out.
- **All three repos share one database.** A migration here is visible there. See §13 for the numbering rule that exists because of this.
- **Migrations are proposed one at a time and applied only with review.** Never automatically.
- **`pg_catalog`, never `information_schema`,** for grant, constraint, policy, and default checks. Least-privilege returns false empties from `information_schema`.

### 0.4 The two framings this document holds simultaneously

Both are true and neither replaces the other:

1. **The send core is correctness work.** It fixes live bugs that exist today, independent of campaigns: three send paths that write no ledger row, engagement scoring that reads an empty table and therefore scores every contact at zero, and two code paths manufacturing consent on every save. This work is worth doing even if a bulk campaign never launches.
2. **Acquisition is what changes the audience number.** Shipping the sender does not unlock reach. Reading the current boolean state alone, the deliverable audience is six people (§1.2). The D1 decision (§5.2) raises that to **27 immediately and up to 73 after adjudication**, by recording a defensible basis for contacts who already have a real relationship. That is a one-time correction of a data defect, not growth. Once it is applied the number stops moving, and only consent capture (§5.1) and upstream acquisition move it again.

Prior versions of this document conflated these, which is how a send system with no audience came to be treated as an unblock.

---

## §1 Ground truth (live, 2026-07-25)

### 1.1 Consent is unprovenanced in both directions

This is the load-bearing finding of the entire document.

`contacts.email_consent` and `contacts.sms_consent` are both `boolean NOT NULL DEFAULT false` (2026-07-25, Q1). Neither number carries user intent:

| Measure | Count | Source |
|---|---|---|
| Live contacts (`merged_into_id is null`) | **271** | Q2 |
| Total rows including merged-away | 306 | Q2 |
| `email_consent = true` | **21** | Q2 |
| …of which carry a consent timestamp (`email_consent_at`) | **0 of 21** | Q2 |
| `email_consent = false` | **250** | Q2 |
| …of which carry an unsubscribe timestamp (`email_unsubscribed_at`) | **0 of 250** | Q2 |

**The falses are a column default nobody ever wrote.** Zero contacts have ever recorded an unsubscribe. Every contact created by every import, scrape, Stripe webhook, quiz sync, and inbound call path was born `false` and never touched.

**The trues are hard-coded by application code with no evidence.** Two create paths asserted `email_consent: true` on every save, with no timestamp, no source, and no record of what the person agreed to:

- `src/app/(dashboard)/crm/contacts/page.tsx:399` (manual contact create)
- `src/app/(dashboard)/ehr/accounting/page.tsx:1629` (EHR patient create)

Both were removed on 2026-07-25 as part of this work. The only code path that stamps `email_consent_at` is `POST /api/contacts/consent`, and no row in the database bears its fingerprint.

**Consequence.** `email_consent` is not a record of user intent in either direction. Treating `false` as an opt-out is a factual error about our own data. Treating `true` as consent is legally indefensible, because we cannot produce the record. This is why §4.2 makes the flags derived and unwritable by application code.

### 1.2 The audience chain, filter by filter

Every prior document quoted a single audience number without the filter that produced it, and the number moved between sessions with no visible reason. That ends here.

**Two axes, always both. A number on one axis alone is misleading and will be misquoted.**

| Axis | Question it answers | What raises it |
|---|---|---|
| **FORMAT-ELIGIBLE** | Is the address or number well formed and deliverable? | Data hygiene |
| **CONSENT-ELIGIBLE** | Does a valid basis exist for this channel under D1 (§5.2)? | Recorded consent or a cohort judgment |

**Format-eligible is a ceiling, never a permission.** The two move independently, and the hygiene sweep of 2026-07-25 proved it: normalizing 48 phone numbers took SMS format-eligibility from 0 to 5 while creating exactly zero consent.

**Email chain — post-sweep, 2026-07-25 (Q3, Q4):**

| # | Filter applied | Removed | FORMAT-ELIGIBLE | CONSENT-ELIGIBLE |
|---|---|---|---|---|
| 0 | Live contacts (`merged_into_id is null`) | 35 merged | **271** | — |
| 1 | `email_consent = true` (legacy boolean) | 250 | **21** | 0 |
| 2 | Email address present and non-empty | 10 | **11** | 0 |
| 3 | `do_not_contact = false` | 3 | **8** | 0 |
| 4 | Address well formed (no `mailto:`, passes shape) | 0 | **8** | 0 |

**8 format-eligible. 0 rest on evidence. Not one of the 21 legacy trues carries a consent timestamp** (§1.1), so the consent column is zero at every step. Of the 8, only **3** (Brent Beam, Christopher Times, Rachel Kimmel) fall in a source cohort that D1 grants a basis to; the other 5 are null-source, held pending triage.

**The operative D1 email audience is 27, and it is not derived from this chain at all.** It comes from source cohort A (§5.2), independent of the legacy boolean, which D1 discards. This chain describes the data's condition, not the audience.

**SMS chain — post-sweep, 2026-07-25 (Q3):**

| # | Filter applied | Removed | FORMAT-ELIGIBLE | CONSENT-ELIGIBLE |
|---|---|---|---|---|
| 0 | Live contacts | 35 merged | **271** | — |
| 1 | `sms_consent = true` | 265 | **6** | 0 |
| 2 | Phone present and non-empty | 1 | **5** | 0 |
| 3 | `do_not_contact = false` | 0 | **5** | 0 |
| 4 | Phone conforms to E.164 (`^\+1[0-9]{10}$`) | 0 | **5** | 0 |

**5 format-eligible. 0 consent-eligible. This is the number most likely to be misread in this document.**

Before the sweep this chain ended at **0**, because only 2 of 52 stored numbers were in E.164. Normalizing 48 numbers moved it to 5. **No consent was created; the numbers merely became well formed.** Not one of the five carries `sms_consent_at` on its live row, and SMS is strict opt-in under D1, where a cohort judgment is worthless (§5.2.1). The only evidenced SMS grant anywhere in the system is Cameron Allen's, and it sits on a merged-away row awaiting import (§5.2.2).

**The defensible bulk SMS audience is zero, and it stays zero** until consent capture produces real opt-ins and the §12.1 prerequisites clear.

**Membership changed even where totals did not.** The email chain ended at 8 both before and after the sweep, but the roster is different: **Jane Doe left** (quarantined as a test record, H4) and **Rachel Kimmel entered** (her `mailto:` prefix was stripped, H1, so she now passes step 4). A stable total concealing a changed roster is precisely the failure this document exists to end, so the composition is recorded, not just the count.

**Why this document says 8 where an earlier session said 7, and 6 before that.** Three separate causes, each a filter rather than a judgment call:
1. The session that said **7** applied `do_not_contact` by hand, removing Laura Lawrence as staff while missing that Melissa Allen also carried the flag.
2. Applying `do_not_contact` mechanically gave **9 → 8** at step 4 and **6** after excluding internal and test rows.
3. The sweep then removed Jane Doe by quarantine and admitted Rachel Kimmel by fixing her address, landing at **8** format-eligible with a different roster.

The v594 document reached **9** because it stopped at step 4 and counted 306 pre-merge rows.

### 1.3 The suppression surfaces contradict each other

| Measure | Count | Source |
|---|---|---|
| `contacts.do_not_contact = true` | **57** | Q3 |
| Rows in the `do_not_contact_list` table | **0** | Q3 |
| Contacts with `do_not_contact` AND `email_consent` both true | **2** | Q3 |

Two suppression surfaces exist with no documented precedence between them, one holding 57 flags and the other empty. §4.5 makes precedence explicit and resolves the two contradictions deterministically as suppressed.

### 1.4 Address hygiene

Of 112 contacts with an email address (2026-07-25, Q5):

| Issue | Count |
|---|---|
| `mailto:` prefix | 1 |
| Mixed case requiring normalization | 5 |
| Duplicate after normalization | 1 |
| Missing `@`, whitespace, literal "test", failing shape | 0 |
| Distinct addresses after normalization | 111 of 112 |

**The `mailto:` trap, verified live.** `mailto:rachel17313@gmail.com` **passes** a naive shape regex of the form `^[^@\s]+@[^@\s]+\.[a-z]{2,}$`, because `mailto:rachel17313` contains no `@` and no whitespace. A shape check alone will not catch it. The validator must strip and reject the prefix explicitly. This record is the live test case for the email adapter's `validate()` in §7.1.

### 1.5 Where the source documents disagree with live data

**Live wins in every row below.** The v594 document measured against 306 pre-merge rows on 2026-07-24, before 35 contacts were merged away.

| Claim | Source document | Live 2026-07-25 | Verdict |
|---|---|---|---|
| 306 contacts / 128 addressed / 27 consented / 279 false | v594, 790-draft | **271 / 112 / 21 / 250** | Live wins; merged rows excluded |
| `do_not_contact = true`: 92 | v594 | **57** | Live wins |
| Contradictory rows: 8 | v594 | **2** | Live wins |
| Email sendable: 9 | v594 | **8** at step 4, **6** at step 5 | Live wins; v594 stopped at step 4 |
| Email reachable: ~12, SMS ~9 | 342-line doc | **8** and **0** | Live wins; that doc applied neither `do_not_contact` nor E.164 |
| SMS sendable: 0 | v594 | **0** | **Confirmed** |
| Phones in E.164: 2 of 56 | v594 | **2 of 52** | Confirmed, denominator corrected |
| `campaign_automations`: 2 rows | v594 | **2** | Confirmed |
| Malformed emails: 10 of 128 | 790-draft | **7 of 112** | Live wins; most were test rows since merged |

All figures from the four source documents not appearing in this section are superseded and should be treated as stale.

---

## §2 Rejected designs: do not re-propose these

**This section exists because every reversal in this project happened the same way: a prior session found an empty table and assumed empty meant free.** Empty means unbuilt, not unused. Each rejection below is recorded with the evidence that killed it, so it is not re-litigated.

### 2.1 REJECTED: repurpose `contact_consents` as the consent ledger

**Proposed by:** the 342-line doc (§3c) and the 790-line draft.
**Rejected on:** 2026-07-25, evidence below.

`contact_consents` has zero rows, which is what made it look available. It is not available. Its actual shape (Q6) is `id, org_id, contact_id, consent_id, sent_at, sent_by, sent_by_name, viewed_at, signed_at, signature_data, status, email_sent_to, notes`, and its foreign keys are:

```
contact_consents_consent_id_fkey -> consent_library
contact_consents_contact_id_fkey -> contacts
contact_consents_org_id_fkey     -> organizations
contact_consents_sent_by_fkey    -> auth.users
```

This is the **clinical EHR signed-consent-document feature**: send a consent form from a library, track when it was viewed, capture a signature. It is an unbuilt feature's table, not a spare one. No source file references it, so repurposing would appear to work and would silently destroy a planned feature's schema on a database two other repos share.

Marketing channel consent is a different domain with a different shape and a different lifetime. It gets its own table: `consent_events` (§4.2).

### 2.2 REJECTED: rename `email_campaigns` to `campaigns`

**Proposed by:** the 342-line doc (§3a).
**Rejected on:** 2026-07-25, evidence below.

A `campaigns` table already exists and **holds 4 rows** (Q7). Its shape is `brand, description, icp_id, quiz_id, budget, start_date, end_date, goals, post_ids, funnel_config, ai_suggestions, phases, template_key`.

That is a **marketing-program planning entity**: campaigns with budgets, ICPs, funnels, and social posts. It is not a message blast. The v594 document independently flagged this in its §0.7 ("Do not overload it"), and live inspection confirms it with data in it. Renaming into this name would collide with a populated table belonging to another feature.

New campaign tables take unused names: `outreach_campaigns` and `outreach_recipients` (§4.3, §4.4).

### 2.3 REJECTED: `ALTER email_sends` into a general send ledger

**Proposed by:** both the 342-line doc (§7) and the 790-line draft (§2.5 Option A).
**Rejected on:** 2026-07-25, evidence below.

`email_sends` cannot become a general ledger without three separate changes, and it is the wrong shape even after all three:

| Property | Live state (Q8) | Why it blocks |
|---|---|---|
| Rows | **0** | Nothing to preserve |
| `campaign_id` | `uuid NOT NULL`, no default | Any non-campaign send violates the constraint |
| Foreign key | `email_sends_campaign_id_fkey -> email_campaigns ON DELETE CASCADE` | A row cannot exist without a campaign row |
| `org_id` | **absent** | Tenant requires a join through `campaign_id` |
| RLS | single policy `email_sends_via_campaign` | Admits only campaign-tied rows |

Making it work requires the ALTER, plus a policy rewrite, plus adding `org_id`. That is rebuilding `message_sends` in place, badly, on a shared database, while leaving three ledgers in the system.

**The decisive structural point, from v594 §0.6, confirmed live:** `email_sends` is not a general ledger that is failing to log. It is a *campaign recipient ledger that structurally cannot hold a row unless a campaign exists*, and no campaign has ever existed. Every stage email, every 1:1 email, and every transactional send is architecturally excluded from it. Therefore `crm-server.ts:420` reading it for engagement scoring is reading a table that only the parked feature could ever populate. **The engagement-scoring gap and the parked campaign feature are one defect, not two.**

Creating a new `message_sends` table touches nothing any repo currently reads (§4.1) and is therefore strictly lower blast radius than the ALTER.

---

## §3 Inventory: what to reuse, what is broken, what is dead

### 3.1 Reuse without modification

| Capability | Where | Why it is the reference |
|---|---|---|
| **Claim-before-send guard** | `stage_email_sends` + `/api/crm/stage-emails/route.ts` (migrations 077, 080) | The only send path with real rows and a proven pattern. Verified live (Q9): `stage_email_sends_once` is `UNIQUE (contact_id, stage_id, email_id) WHERE status IN ('sending','sent')`, and `stage_email_sends_stale` is `(status, claimed_at) WHERE status = 'sending'`. The insert *is* the lock. Generalize it, do not redesign it. |
| **Durable skips** | migration 080 | `status='skipped'` with a reason, deliberately outside the unique index, so a skip never permanently bars a later legitimate send. |
| **Twilio org routing** | `src/lib/twilio-org.ts` | `SendContext='campaign'` already routes to the outreach number. `receiverIdentity(orgId)` remains the single source of the client identity string. `forward_number` stays retired. |
| **Webhook dedupe** | `webhook_events` (exists, Q10) | Already has the dedupe gate built for Stripe. Reuse for Resend and Twilio callbacks. |
| **Delivery-tracking shape** | `nr_quiz_results` (exists, Q10) | `email_status, email_sent_at, email_attempts, email_last_error, email_resend_id` alongside `consented_at, consent_version_accepted`. The best in-house precedent. Copy it rather than inventing one. |
| **Daily rollup target** | `org_email_daily_stats` (0 rows, Q10) | Per-org per-day sent/delivered/opened/clicked/bounced/complained. Correctly shaped, simply has nothing to aggregate yet. |

### 3.2 Broken: three send paths that write no ledger row

All three send real mail and record nothing. This is the live bug the send core fixes.

| Path | What breaks | Evidence |
|---|---|---|
| `/api/crm/stage-emails/route.ts:244` | Inserts into `email_sends` without `campaign_id`, violating `NOT NULL`. Error assigned to `logError` and passed to `console.error`. | 3 confirmed sends in `stage_email_sends`, **0 rows** in `email_sends` (Q8, Q11) |
| `/api/email/send/route.ts:53` | Inserts `to_email`, a column that does not exist, and omits `campaign_id`. The error is never checked, so `emailSend` is `undefined`, the mail sends anyway at line 77, and the subsequent `.update().eq('id', undefined)` matches nothing. | Route read 2026-07-25 |
| Sequences (`/api/sequences/process-step`) | Writes `crm_messages` for SMS and nothing at all for email. `sequences` has **no send ledger** of any kind. | `sequences` 0 rows, `sequence_enrollments` 0 rows (Q10) |

**The misleading comment.** The block above `stage-emails/route.ts:244` attributes the empty table to RLS and states that "a stage email has `campaign_id` NULL". Both halves are wrong: `campaign_id` cannot be null, and the fix that comment justifies (switching to the admin client) cannot help, because service_role bypasses RLS and constraints are not RLS. A future session reading that comment will be misdirected. It should be corrected when the route is migrated to `message_sends`.

### 3.3 Dead code, removed 2026-07-25

Three routes were written against a schema that was never applied, referencing `to_email`, `batch_size`, `filter_criteria`, `provider_message_id`, and `batch_number`, none of which exist on `email_campaigns` (Q12).

| Route | Disposition | Reason |
|---|---|---|
| `/api/email/campaign/launch` | **Deleted** | No callers. |
| `/api/email/campaign/process-queue` | **Deleted** | No callers, and it was wired to a `* * * * *` cron in `vercel.json`. A one-minute cron whose safety depended on `email_campaigns` staying empty, when the first act of this build is putting rows in that table. The cron entry was removed with it. |
| `/api/email/send` | **KEPT** | **Not dead.** Two callers: `email-composer.tsx:173`, mounted live at `contact-detail.tsx:2100` as the 1:1 email button, and `crm-task-card.tsx:232`, a placeholder. It sends real mail. It is a migration target for `message_sends` (§8), not deletable code. |

Stale registry entries for the two deleted routes were removed from `/api/auditor/route.ts`.

### 3.4 Unresolved duplication

`campaign_automations` holds **2 rows** (Q3) and is a node/edge visual automation builder with `type` defaulting to `email_drip`. It overlaps conceptually with `sequences` (0 rows, better schema, better indexes). **Two drip engines exist on paper.** Recommendation: keep `sequences`, give it a ledger by pointing it at `message_sends`, retire `campaign_automations`. This is decision D4 in §12.2.

---

## §4 Data model

DDL below is ported from `NPU_Hub_Bulk_Campaigns_Design_v594.md` Part 2, with the naming decisions of 2026-07-25 applied and the corrections from §2 folded in. **No migration in this section has been applied.**

### 4.1 Central principle, and the blast-radius finding that clears the way

**Do not build a campaign send ledger. Build one outbound message ledger, and let campaigns, sequences, stage emails, manual sends, and transactional sends all write to it.**

Three parked ledgers is how engagement scoring came to read an empty table. One ledger means engagement scoring, deliverability rollups, suppression, and frequency capping each have exactly one source of truth, permanently.

> **VERIFIED FINDING, 2026-07-25 — blast radius of `email_sends` is Hub-only.**
> An authorized read-only search for the string `email_sends` across `npu-platform-v2` and `neuroreport-app` returned **zero matches in both repositories**. No code outside NPU-hub-v2 reads or writes that table.
>
> **Therefore `email_sends` can eventually be DROPPED, not merely deprecated.** It holds 0 rows, has no external readers, and its only in-repo readers (`crm-server.ts:420`, `/api/email/send`, `/api/email/webhook-inbound`) are all migration targets in this plan.
>
> **A future session must not re-litigate this.** The sequencing is: build `message_sends`, repoint all readers, live-test, then drop `email_sends` in a separate reviewed migration. Do not drop it in the same migration that creates `message_sends`.

### 4.2 New table: `consent_events` (append-only)

Ported from v594 §2.3 unchanged.

```sql
create table consent_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  contact_id    uuid not null references contacts(id) on delete cascade,
  channel       text not null check (channel in ('email','sms')),
  action        text not null check (action in ('granted','revoked')),
  basis         text not null check (basis in
                  ('express_consent','double_optin','existing_business_relationship',
                   'transactional','import_asserted','manual_admin')),
  method        text not null,      -- 'web_form','checkout','quiz','reply_stop','admin_ui','import'
  evidence      jsonb not null default '{}'::jsonb,
                -- ip, user_agent, form_url, exact checkbox text shown, campaign_id, STOP message body
  source_ref    text,
  actor_id      uuid references auth.users(id),
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index consent_events_lookup on consent_events (contact_id, channel, occurred_at desc);
```

Append-only. Never updated, never deleted.

`contacts.email_consent` and `sms_consent` remain as denormalized read caches but become **derived**: written only by a trigger off this table, never by application code. That single change makes the §1.1 failure mode structurally impossible, because the timestamp and the evidence *are* the write.

`evidence` must capture the exact checkbox text shown at the moment of consent. When someone complains two years later, "we have a boolean" is not a defense, and "here is the sentence they agreed to, the URL, and the timestamp" is.

**Channel separation is absolute.** An email opt-in grants email only. SMS is a separate row. There is no code path where one channel's basis is read for the other.

### 4.3 New table: `message_sends`

Ported from v594 §2.2, unchanged except that `campaign` source ids now refer to `outreach_campaigns`.

```sql
create table message_sends (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  contact_id          uuid not null references contacts(id) on delete cascade,

  channel             text not null check (channel in ('email','sms')),

  source_kind         text not null check (source_kind in
                        ('campaign','sequence','stage','manual','transactional')),
  source_id           text,
  source_step_id      text,

  dedupe_key          text not null,

  to_address          text not null,  -- normalized: lower(trim(email)) or E.164
  status              text not null default 'sending'
                      check (status in ('sending','sent','failed','skipped','suppressed','bounced')),
  skip_reason         text,

  consent_basis       text not null,
  consent_evidence_id uuid references consent_events(id),
  consent_snapshot    jsonb not null default '{}'::jsonb,

  external_message_id text,
  crm_message_id      uuid references crm_messages(id) on delete set null,
  error_code          text,
  error_message       text,
  attempts            integer not null default 0,

  claimed_at          timestamptz not null default now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  opened_at           timestamptz,
  clicked_at          timestamptz,
  bounced_at          timestamptz,
  complained_at       timestamptz,
  unsubscribed_at     timestamptz
);

-- the 077 pattern generalized: one live send per contact per channel per logical message
create unique index message_sends_once
  on message_sends (contact_id, channel, dedupe_key)
  where status in ('sending','sent');

-- the 077 stale-claim reaper
create index message_sends_stale
  on message_sends (status, claimed_at)
  where status = 'sending';

create index message_sends_contact on message_sends (contact_id, claimed_at desc);
create index message_sends_source  on message_sends (source_kind, source_id, status);
create index message_sends_org_day on message_sends (org_id, sent_at desc);
```

Load-bearing choices:

- **`org_id NOT NULL` on the row.** `email_sends` has no `org_id` and must reach through `campaign_id` to know its tenant. Given the R0.4 cross-tenant findings, no new table should require a join to know who it belongs to.
- **`dedupe_key` composed by the caller:** `stage:{stage_id}:{email_id}`, `campaign:{campaign_id}`, `sequence:{sequence_id}:{step_id}`, `manual:{uuid}`. This single generalization lets one partial unique index serve all five send sources.
- **`skipped` and `suppressed` sit outside the unique index**, per migration 080, so a skip never blocks a later legitimate send.
- **`consent_snapshot` is immutable proof.** If a contact later revokes, the record of the basis at send time survives. This is what makes a complaint defensible.
- **`crm_message_id`** links a bulk SMS to the conversation row it created, so the 1:1 thread stays truthful (§7.2).

### 4.4 New tables: `outreach_campaigns` and `outreach_recipients`

> **EMAIL ONLY — DEFERRED (§0.2).** Newsletters use these. **SMS does not**: participant reminders are sent manually from Conversations with no campaign entity. Do not build these for the SMS track, and do not shape them around it. Not deleted; the newsletter needs them exactly as specced below.

**Naming decision, 2026-07-25.** v594 §2.4 proposed extending `email_campaigns` in place. That is superseded: `email_campaigns` is marked **DEPRECATED** (0 rows, no data to migrate) and is not renamed, because renaming it to `campaigns` collides with a populated planning table (§2.2). New names are unused.

```sql
create table outreach_campaigns (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete cascade,
  name                 text not null,
  channel              text not null check (channel in ('email','sms')),

  -- email fields (null when channel = 'sms')
  subject              text,
  body_html            text,
  body_text            text,
  from_name            text,
  reply_to             text,
  -- sms fields (null when channel = 'email')
  sms_body             text,

  -- audience
  filter_tags          text[] not null default '{}',
  filter_stages        text[] not null default '{}',
  exclude_tags         text[] not null default '{}',
  audience_query       jsonb  not null default '{}'::jsonb,
  audience_snapshot_at timestamptz,
  required_basis       text[] not null default '{}',

  -- governance
  status               text not null default 'draft'
                       check (status in ('draft','scheduled','sending','sent','failed','cancelled')),
  throttle_per_hour    integer,
  voice_lint_status    text not null default 'unchecked'
                       check (voice_lint_status in ('unchecked','passed','failed','overridden')),
  voice_lint_report    jsonb,
  test_send_at         timestamptz,
  approved_by          uuid references auth.users(id),
  approved_at          timestamptz,

  scheduled_at         timestamptz,
  started_at           timestamptz,
  completed_at         timestamptz,
  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table outreach_recipients (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  campaign_id         uuid not null references outreach_campaigns(id) on delete cascade,
  contact_id          uuid not null references contacts(id) on delete cascade,
  to_address          text not null,
  consent_basis       text not null,
  consent_evidence_id uuid references consent_events(id),
  state               text not null default 'pending'
                      check (state in ('pending','claimed','sent','failed','suppressed','skipped')),
  suppress_reason     text,
  merge_data          jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create unique index outreach_recipients_once
  on outreach_recipients (campaign_id, contact_id);
create index outreach_recipients_pending
  on outreach_recipients (campaign_id) where state = 'pending';
```

`audience_snapshot_at` records when the recipient list was materialized, so a campaign edited mid-send cannot silently change its own audience.

**Counters are derived, never authoritative.** Sent, failed, and skipped counts are computed from `outreach_recipients` and `message_sends`, not stored and incremented. Counts derive from rows; rows never derive from counts.

### 4.5 Suppression: one resolver, explicit precedence

Ported from v594 §2.6.

```sql
create or replace function is_suppressed(p_contact_id uuid, p_channel text)
returns table (suppressed boolean, reason text)
language sql stable as $$
  -- precedence, highest first:
  --   1. contacts.do_not_contact
  --   2. do_not_contact_list match on normalized email or phone
  --   3. hard bounce or spam complaint in message_sends
  --   4. most recent consent_events row for this channel is 'revoked'
  ...
$$;
```

Precedence is not negotiable and lives in exactly one place. `do_not_contact` always wins over consent, which resolves the two contradictory rows of §1.3 deterministically as suppressed, pending decision D2 (§12.2).

### 4.6 Table dispositions

| Table | Disposition |
|---|---|
| `email_sends` | **Deprecated now, droppable later.** 0 rows, Hub-only (§4.1). Drop in a separate reviewed migration after readers are repointed and live-tested. |
| `email_campaigns` | **Deprecated.** 0 rows. Superseded by `outreach_campaigns`. Not renamed. |
| `stage_email_sends` | **Keep read-only** after its 6 rows migrate into `message_sends`. Do not drop until the new path is live-tested. |
| `contact_consents` | **Do not touch.** Belongs to the EHR consent-document feature (§2.1). |
| `campaigns` | **Do not touch.** Marketing-program planning entity, 4 rows (§2.2). |
| `campaign_automations` | Retire pending D4 (§12.2). |

---

## §5 Consent: capture and enforcement

### 5.1 Capture surfaces are build items, not an external gate

Consent capture is **part of this feature**. Each surface writes a `consent_events` row with real evidence:

| Surface | Basis written | Evidence captured |
|---|---|---|
| Public preference / subscribe page | `express_consent` or `double_optin` | IP, user agent, form URL, exact checkbox text, confirmation token |
| Double opt-in confirmation email | `double_optin` | Token, confirming IP, timestamp |
| Consent at source on contact-creating forms (website, xreg, checkout, quiz) | per form | Form URL, checkbox text, submission id |
| Admin UI toggle | `manual_admin` | Staff actor id, free-text justification |
| Unsubscribe link / `STOP` reply | `revoked` | Signed token or inbound message body |

The admin toggle records `manual_admin` and is explicitly **not** treated as marketing-grade consent by the resolver.

**The 21 existing unprovenanced `email_consent = true` flags are not carried forward as consent in any form.** They are discarded. Under §5.2 a contact's basis comes from its source cohort, not from the legacy boolean, so the flag stops being an input. Five of the 21 fall in cohort A and receive a basis by the cohort rule; the other 16 fall in cohort E and receive none until triaged. The design refuses to inherit a lie, which means it does not launder the lie into a basis either.

### 5.2 D1 RESOLVED — default basis by source

**Decision, 2026-07-25: email operates on an OPT-OUT basis with a working unsubscribe. SMS is STRICT OPT-IN, no exceptions.**

**This is implemented as a default basis assigned per source cohort, never as a global default-true boolean.** A blanket flip is what created the problem this document exists to fix. The backfill assigns a basis only where one is defensible, and assigns none where it is not.

Cohorts measured live 2026-07-25 (Q16). Counts are live contacts; "emailable" means an address present and `do_not_contact = false`:

| Cohort | Contacts | Emailable | Default basis | Email |
|---|---|---|---|---|
| **A. Owned channels** — `xregulation`, `neuroreport`, `Podcast`, `Website`, `Workshop`, `inbound_call`, `manual_ecr`, `stripe`, `Other` | 33 | **27** | `import_asserted`, `method='import'` (§5.2.1) | **Yes** |
| **B. Media appearances** — `media_appearance` | 16 | **13** | `import_asserted` **only where a real interaction is on record**, adjudicated per contact | Case by case |
| **C. Bulk imports** — `Import`, conference and city lists, `Thinkers50`, `ChatGPT curated` | 52 | 19 | **None** | **No** |
| **D. Social scrapes** — URL-valued `source`, 104 of 109 created 2026-03-11/12 | 109 | 15 | **None** | **Never without new consent** |
| **E. Null source** | 61 | 33 | **None until triaged** (D8) | Held |

**Reachable under D1 today: 27 immediately (cohort A), up to 40 once cohort B is adjudicated, up to 73 if cohort E triages cleanly.** Cohorts C and D together hold 34 emailable addresses that stay excluded. This supersedes the earlier "up to ~111" estimate, which counted every address regardless of provenance.

**Why cohort D is excluded, and this is a deliverability decision rather than a legal one.** A new sending domain has no reputation. Reputation is earned by mailing people who open, click, and do not complain. Mailing 109 scraped strangers from a cold domain produces the opposite signal at exactly the moment the domain is most fragile, and the cost does not fall on the scraped list. It falls on cohort A, the people with a real relationship, whose mail starts landing in spam. **Excluding cohort D protects the deliverability of the audience that matters.** Even if counsel returned an opinion that CAN-SPAM permits the send, the answer here would not change.

**Cohort B is adjudicated, not assumed.** "Appeared on a podcast together" is a real relationship; "found in a media database" is not. The 13 emailable rows are reviewed individually before a basis is written, because a cohort-level default here would be the same shortcut in a smaller costume.

**SMS is unaffected by every line above.** Strict opt-in throughout. No source cohort receives a default SMS basis. `existing_business_relationship` never satisfies an SMS send, and email consent never satisfies an SMS send. Under the TCPA the bar is express written consent, and cohorts A through E all sit below it. The SMS audience remains **zero** until consent capture produces real opt-ins and the §12.1 prerequisites clear.

### 5.2.1 A recorded business judgment is not a user's decision

**The resolver must be able to tell them apart, so they are written with different `basis` and `method` values and are never collapsed.**

| | Cohort backfill (§5.2) | A real user decision |
|---|---|---|
| `basis` | `import_asserted` | `express_consent` / `double_optin` |
| `method` | `import` | `checkout`, `web_form`, `quiz`, `reply_stop` |
| `occurred_at` | the date of this decision, 2026-07-25 | the moment the user acted |
| `evidence` | source value, cohort rule applied, who decided | IP, user agent, form URL, exact text shown |
| Email under D1 | **Sendable.** The opt-out basis is exactly this business judgment. | Sendable |
| **SMS** | **Never sendable.** | Sendable only with express consent |
| Withstands a complaint | Shows a documented, dated basis and a working unsubscribe | Shows what the person actually agreed to |

`import_asserted` is a real basis under an opt-out email regime and a **worthless** one under the TCPA. That asymmetry is the entire point of separating them, and it is why cohort A can be emailed and can never be texted.

**Every cohort-A and adjudicated cohort-B row is written as a `consent_events` row** with `basis='import_asserted'`, `method='import'`, `occurred_at` = the decision date, and evidence recording the source value and the cohort rule applied. A default basis is still a recorded decision with provenance. It is not a boolean nobody wrote.

### 5.2.2 Two real consent decisions exist and must be imported, not overwritten

**Verified live 2026-07-25 (Q17). The `consent_events` migration does not start empty.**

Exactly two contacts in the entire system carry a genuine, timestamped, user-made consent decision. Both were captured by the platform checkout, both sit on rows that were merged away on 2026-07-22, and both are corroborated by the `contact_merge_log` snapshot as well as the surviving loser row:

| Contact | Decision | Recorded | Import as |
|---|---|---|---|
| Cameron Allen (loser `68099477` → `4cb236f6`) | SMS **granted** | 2026-07-14 07:30:57Z | `basis='express_consent'`, `method='checkout'`, `action='granted'` |
| Melissa Allen (loser `9af172f5` → `5c661e5c`) | SMS **DECLINED** | 2026-07-15 20:43:44Z | `basis='express_consent'`, `method='checkout'`, `action='revoked'` |

**Melissa Allen's live record currently reads `sms_consent = true`.** She declined. The merge kept the survivor's unprovenanced flag and left her recorded decision stranded on the loser row. Importing these two rows correctly therefore *reduces* live SMS consent by one, and that is the correct outcome. See §12.3.

**Neither row carries email consent.** No email consent has ever been captured by any surface in any repo. Cohort A's email basis is entirely §5.2's business judgment, and nothing in the system contradicts or corroborates it.

### 5.3 Four-layer enforcement

Ported from v594 Part 5. Application-level checks alone do not achieve "structurally impossible to send without consent", because the next route someone writes will forget.

**Layer 1 — derived flags.** `contacts.email_consent` and `sms_consent` become trigger-maintained from `consent_events`. `UPDATE` on those columns is revoked from the application role. A form can no longer set a flag without writing evidence, because the flag is not writable. *This layer alone would have prevented §1.1.*

**Layer 2 — database send gate.** A `BEFORE INSERT` trigger on `message_sends` rejects any row with `status='sending'` unless a valid, non-revoked consent basis exists for that contact and channel, and unless `is_suppressed()` returns false. A rogue route, a coding mistake, or a manual `INSERT` in the SQL editor all fail at the database. **This is the layer that makes the guarantee real.**

**Layer 3 — resolver function.** `campaign_eligible_recipients(campaign_id)` as `SECURITY DEFINER`, the only supported way to build an audience. It re-checks consent and suppression at resolve time **and again at claim time**, because a revoke arriving mid-campaign must take effect on the remaining sends.

**Layer 4 — RLS, and the R0.4 trap.** All new tables get org scoping via `org_id IN (SELECT user_org_ids())`, **never** the correlated-subquery form that produced the 033b defect across 50 tables. Every `UPDATE` policy gets an explicit `WITH CHECK`, not only a `USING` clause. Per migration 030 new tables are born locked, so an explicit `grant` sits next to the RLS; per 031 new functions are born PUBLIC-executable, so `revoke execute ... from public` is mandatory.

**A guard never watched to fire is not a guard.** Layer 2 requires a test that proves a consent-less insert is rejected.

---

## §6 Send pipeline

> **EMAIL ONLY — DEFERRED (§0.2).** The whole staged pipeline below — audience resolve, **preflight report**, test send, **approval flow**, queued/sending worker — is the newsletter path.
>
> **SMS uses none of it.** A participant reminder is: staff pick recipients in Conversations, compose, send. Each send still passes `assertSendable()` and writes `message_sends`, but there is no campaign, no resolver, no preflight, and no approval gate to pass through.
>
> The claim/throttle/retry/reaper machinery in §6.2 is worth reading for the SMS track as *reference*, since throughput limits still apply, but it is not built for SMS in this phase.

### 6.1 Stages

```
draft
  -> voice lint (§9)
  -> audience resolve      (writes outreach_recipients, stamps audience_snapshot_at)
  -> preflight report      (eligible / suppressed / malformed, shown before launch)
  -> test send             (to a verified internal address, required before launch)
  -> approve               (human gate, records approved_by and approved_at)
  -> queued
  -> sending               (worker loop)
  -> completed | failed | cancelled
```

**The preflight report is the feature that would have surfaced this entire blocker months ago.** It must state plainly, every time: *"This campaign will reach 6 of 271 contacts. 250 have no recorded sending basis, 57 are suppressed, 1 has a malformed address."* Make the audience visible before the send, always.

### 6.2 Claim, throttle, retry, reap

**Claim.** A bounded batch per worker pass:

```sql
update outreach_recipients
   set state = 'claimed'
 where id in (
   select id from outreach_recipients
    where campaign_id = $1 and state = 'pending'
    order by created_at
    limit $2
    for update skip locked
 )
returning *;
```

`FOR UPDATE SKIP LOCKED` allows multiple workers. Then per recipient, insert into `message_sends` with `status='sending'`. A unique violation on `message_sends_once` means another worker holds it, so skip silently. Identical in shape to migration 077.

**Throttle.** Two server-side limits: a per-org daily cap incremented against `org_email_daily_stats`, and a per-campaign `throttle_per_hour`, so a large batch does not go out in ninety seconds and torch domain reputation. SMS throttle is stricter because of A2P 10DLC throughput.

**Retry.** Reuse `scheduled_jobs`, which already has atomic claim, `attempts`, and `last_error`. Do not build a second queue. Retry only transient provider errors (429, 5xx, timeout). Never retry a hard bounce, an invalid address, or a Twilio opt-out error; those write terminal status and feed suppression.

**Reap.** A periodic pass over `message_sends` where `status='sending' AND claimed_at < now() - interval '15 minutes'`, resolving against the provider by `external_message_id` where one exists and marking failed where none does. Ported directly from 077.

**Dedupe on normalized address, not contact id.** 112 addresses collapse to 111 distinct (§1.4). Two contact rows sharing an address must not both receive the same campaign.

---

## §7 Channel adapters

One interface so the pipeline never branches on channel:

```ts
interface SendAdapter {
  channel: 'email' | 'sms';
  validate(address: string): { ok: boolean; normalized?: string; reason?: string };
  send(input: SendInput): Promise<{ externalId: string } | { error: SendError }>;
  classifyError(err: unknown): 'transient' | 'permanent' | 'suppress';
}
```

### 7.1 Email — Resend

- `validate` lowercases and trims, **strips and rejects a `mailto:` prefix explicitly**, then applies a shape check. Per §1.4 a shape check alone passes `mailto:rachel17313@gmail.com`; that record is the required test case.
- Every send carries a `List-Unsubscribe` header and a one-click unsubscribe URL with a signed token. Non-negotiable for CAN-SPAM and for reputation.
- Store the Resend id in `external_message_id`, matching the `email_resend_id` convention already in `nr_quiz_results`.
- Webhook receives `delivered`, `opened`, `clicked`, `bounced`, `complained`, deduped through `webhook_events`. **These events are the first real data `opened_at` and `clicked_at` will ever hold**, which is what ends the constant-zero engagement score.
- Hard `bounced` and `complained` write a suppression entry **and** a `consent_events` revoke row immediately. A bad address or an annoyed recipient is never targeted again. This is what protects the six legitimate recipients' deliverability.
- **Migrate the existing email paths onto this adapter**, replacing the Google Apps Script / Gmail webhook (`org_email_config.webhook_url`), so there is one email path, one place opens and clicks are tracked, and one domain-reputation surface.

### 7.2 SMS — Twilio

> **CORRECTION, verified live 2026-07-26.** An earlier version of this section said campaign sends reuse `SendContext='campaign'` to route to the `outreach` number. **That routing is inert.** In `sendOrgSms` (`src/lib/twilio-org.ts:181-185`) `messagingServiceSid` and `from` are mutually exclusive, and Neuro Progeny has a Messaging Service configured (`MG5f74847d0c4f63becadbf0c7a9adb6c2`), so `pickNumber()` is computed and then discarded on every send. **Twilio's Messaging Service selects the sender from its own pool; the `purpose` taxonomy has no effect on SMS today.** Both `src/lib/twilio.ts sendSms()` and `sendOrgSms()` route through that one service, so 1:1 and any future bulk traffic share it — and share whatever A2P campaign is attached to it. Sender selection is a Twilio-side sender-pool question, not ours.

- Reuses the existing account, `receiverIdentity(orgId)`, and outbound caller ID from the completed 1:1 build. Those constraints carry over unchanged and are not to be re-litigated.
- `validate` normalizes to E.164. Given 2 of 52 phones conform (§1.2), **normalization is a prerequisite, not a nicety.**
- **Bulk SMS writes to `crm_messages`, not a parallel table.** When a recipient replies, the reply lands in the existing conversation thread; if the outbound campaign message is absent from that thread, the softphone shows a reply to nothing. `message_sends.crm_message_id` links the accounting row to the conversation row. `crm_messages` already has the right dedupe primitive in `uq_crm_messages_twilio_sid`.

  *Note: this reverses the 342-line doc's recommendation to keep campaign sends out of `crm_messages`. Thread truthfulness wins over inbox tidiness, and the link column keeps the accounting separable.*
- Inbound `STOP`, `UNSUBSCRIBE`, `QUIT` write a `consent_events` revoke row and a suppression entry, not merely a Twilio-side block, so the Hub's own view of consent stays accurate.
- Quiet hours by recipient timezone and a per-campaign send window. Bulk SMS at 6am is a complaint generator.

---

## §8 Engagement tracking

**The fix is to repoint `src/lib/crm-server.ts:420` from `email_sends` to `message_sends`.**

Once every outbound message lands in one ledger, engagement scoring sees stage emails, sequence steps, campaign sends, and manual sends alike, and a contact's score reflects their actual history rather than their campaign history. Today the 15% email-engagement component scores every contact at zero, because the table it reads holds zero rows and structurally cannot hold more (§2.3).

**Migration targets, in order:**

1. `/api/crm/stage-emails/route.ts:244` — write `message_sends` with `source_kind='stage'`, and **surface the error rather than `console.error` it**. Correct the misleading RLS comment (§3.2).
2. `/api/email/send/route.ts:53` — write `message_sends` with `source_kind='manual'`. This is the route with two live callers.
3. `/api/sequences/process-step` — write `message_sends` with `source_kind='sequence'`. It currently writes no email ledger at all.
4. `/api/email/webhook-inbound` — repoint from `email_sends`.
5. `crm-server.ts:420` — repoint scoring.

**Backfill:** the 6 `stage_email_sends` rows migrate into `message_sends` with `source_kind='stage'` and a composed `dedupe_key`. Small enough to verify by eye.

**Rollups:** a small job aggregates `message_sends` into `org_email_daily_stats` per org per day.

> **The single most important sentence for the build session:** *A send that is not in the ledger did not happen.* The ledger write must be part of the same code path as send finalization, and its error must be surfaced, not swallowed. The current `if (logError) console.error(...)` is exactly how three real sends vanished.

---

## §9 AI composer and voice rules

> **EMAIL ONLY — DEFERRED (§0.2).** The composer and the voice linter are newsletter tooling.
>
> **SMS reminders are composed by a human, every time.** No AI drafting, no `voice_lint_status` gate, no merge-tag renderer. The voice rules themselves still govern anything a human writes, but nothing in the SMS track enforces them in code.

### 9.1 Voice rules as a gate, not a prompt

Prompt instructions drift. The rules are enforced as a lint that blocks a campaign from leaving draft. `voice_lint(text)` returns located findings:

| Rule | Check |
|---|---|
| No em dashes | Literal scan for the character and the double-hyphen substitute |
| Complete flowing sentences | Flag fragments, verb-less sentences, staccato runs |
| No negation of brokenness | Pattern list: "not broken", "nothing wrong with you", "isn't damaged". Preferred replacement surfaced inline: "your nervous system has never made a mistake" |
| Mechanism before modality | First mention of a modality must not precede the first mention of a mechanism |
| Capacity over pathology | Banned-term list, **shared with the AI Coach's existing list** rather than maintained twice |
| HRV as mirror, not score | Flag "HRV" near "score", "good", "bad", "high", "low". Never "sympathovagal balance" |
| Questions orient forward | Flag interrogatives containing past-failure framing; prefer time-anchored and "name 3 things" structures |
| Reading level | Flesch-Kincaid above grade 9 fails |

`voice_lint_status` is `unchecked`, `passed`, `failed`, or `overridden`. Only `passed` or `overridden` may leave draft, and an override records who and why.

**The linter must have a test that proves it rejects a bad draft** containing an em dash, a pathologizing phrase, and a reading level above grade 9. A guard never watched to fire is not a guard.

### 9.2 Composer behavior

Use the installed `@anthropic-ai/sdk` with `claude-opus-4-8`.

- Drafts subject, preview text, and body from a brief plus segment context. Never auto-sends; a human edits and approves.
- Returns the lint report alongside the draft, so revision is one loop rather than a surprise at launch.
- SMS drafts enforce segment count, per-channel length, and a required opt-out line ("Reply STOP to opt out").
- Merge tags render against `outreach_recipients.merge_data` with a mandatory fallback per tag. **Trim in the renderer:** several first-name values carry trailing whitespace, which renders as `Hi Melissa ,`.
- **The composer never sees the recipient list.** It writes copy; it does not select an audience.

---

## §10 White-label and org scoping

Everything org-scoped for Neuro Progeny and Sensorium. Sending identity, domain, brand nouns, and tone come from org settings, never from a constant.

### 10.1 Two live identity leaks, both verified 2026-07-25

| Leak | Location | Effect |
|---|---|---|
| `email_templates.from_email` defaults to `'admin@sensoriumneuro.com'` (Q13) | Column default | **Every Neuro Progeny template inherits a Sensorium address.** A white-label leak that fires on the first template created without an explicit from address. |
| `from_email: 'cameron.allen@gmail.com'` hard-coded | `crm-task-card.tsx:232` | A personal Gmail address baked into a send payload. Currently inert because the surrounding call is a broken placeholder, but it is a live string in shipped code. |

Both must be resolved before any send path goes through Resend. Sender identity is org-scoped, resolved server-side, never a default and never a literal.

### 10.2 Untested white-label path

All 271 contacts belong to Neuro Progeny. **Sensorium has zero contacts.** The white-label path is therefore untested against real data, so org scoping needs deliberate tamper testing rather than incidental verification: attempt a cross-org read and confirm it fails, do not merely observe that the correct rows appear.

---

## §11 Build order

**Restructured 2026-07-26 for the §0.2 channel split.** Three tracks: a shared substrate both channels need, an SMS track buildable now, and an email track blocked on platform-side consent capture.

### 11.1 SHARED SUBSTRATE — the current build

Serves both channels. Nothing above this line should start before it lands.

| # | Work | Depends on | Status |
|---|---|---|---|
| S0 | **Stop manufacturing consent.** Remove hard-coded `email_consent: true` from both create paths. Delete the two dead routes and the one-minute cron. | Nothing | **Done 2026-07-25** (`743f553`) |
| S1 | **Data hygiene sweep.** Normalize emails, trim names, phones to E.164, quarantine test records. | Nothing | **Done 2026-07-25**, 6 + 9 + 48 + 4 rows |
| S2 | **Merge consent fix** — most-restrictive-wins, `rejected_caller_fields`. **No contact merges until this ships.** | Nothing | Committed `b38ce55`; **live test not yet run** |
| S3 | **`consent_events`** (migration 200) + derived-flag trigger + import the 2 real checkout records + cohort A backfill | S2 proven | **Next** |
| S4 | **`message_sends`** (migration 201) + backfill the 6 `stage_email_sends` rows | S3 | Follows |
| S5 | **`assertSendable(channel, contact, org)`** single chokepoint | S3, S4 | Follows |
| S6 | **Repoint `crm-server.ts:420`** to `message_sends`; migrate the three unlogged send paths (§8) | S4 | Follows |
| S7 | **`is_suppressed()`** + reconcile the two suppression surfaces + adjudicate the 2 contradictions and 57 DNC rows | D2, D3 | Needs decisions |
| S8 | **Layer 1**: derived flags become authoritative, revoke app-role `UPDATE`. **Gated by §12.2b ordering — breaks platform checkout if run early.** | Platform switchover verified live | **Blocked, cross-repo** |
| S9 | **Drop `email_sends`** in a separate reviewed migration | S6 live-tested | Cleanup |

### 11.2 SMS TRACK — participant reminders, transactional, buildable after the substrate

No campaign entity, no approval flow, no preflight, no composer, no audience resolver.

| # | Work | Depends on | Status |
|---|---|---|---|
| M1 | **Contact picker in Conversations**: filter by pipeline stage, multi-select recipients | S5 | After substrate |
| M2 | **Manual compose + send**, each recipient through `assertSendable('sms', …)`, writing `message_sends` and `crm_messages` | S5, M1 | After substrate |
| M3 | **STOP / HELP keyword handling** writing a `consent_events` revoke, not only a Twilio-side block | S3 | After substrate |
| M4 | **Quiet hours** by recipient timezone | M2 | Follows |
| — | *University calendar integration* | — | **NOT NOW.** Explicitly out of scope; build nothing that assumes it. |

**Hard prerequisites before any SMS send (§12.1):** R0.4 Stage 3 `crm_messages.org_id` backfill-and-enforce, A2P 10DLC use case confirmed to permit the traffic, and E.164 normalization (done in S1). **Note the §7.2 correction: sender selection is made by the Twilio Messaging Service, not by `pickNumber()`.**

### 11.3 EMAIL TRACK — newsletters, marketing, DEFERRED

**Blocked on platform-side consent capture, which does not exist.** See `docs/PLATFORM_CONSENT_WORK.md` items 0 and 1. Nothing here is deleted; the newsletter needs all of it as specced.

| # | Work | Depends on | Status |
|---|---|---|---|
| E1 | **Consent capture surfaces** (§5.1) + the §5.2 cohort A backfill | S3, platform item 1 | **The actual unblock** |
| E2 | **`outreach_campaigns` + `outreach_recipients`** (§4.4) + resolver (Layer 3) | S4, S7 | **EMAIL ONLY, deferred** |
| E3 | **Send pipeline**: claim, throttle, retry, reaper, ported from 077 (§6) | E2 | **EMAIL ONLY, deferred** |
| E4 | **Resend adapter** + unsubscribe + webhooks + DB send gate (Layer 2) | E3 | **EMAIL ONLY, deferred** |
| E5 | **Preflight report + campaign UI** (§6.1) | E2, E3 | **EMAIL ONLY, deferred** |
| E6 | **AI composer + voice lint** (§9) | Nothing technically | **EMAIL ONLY, deferred** |

**E1 — consent capture — is the actual unblock for reach, and it is the only item on this page that moves the audience number.** Everything else in 11.1, 11.2, and 11.3 is correctness work or delivery machinery. Both are worth building; neither grows the audience. E1 additionally depends on platform-side work this repo does not own (`docs/PLATFORM_CONSENT_WORK.md` items 0 and 1), so it cannot be scheduled from here alone.

*(STOP handling and quiet hours moved to the SMS track as M3 and M4, where they belong — they serve manual participant reminders, not the deferred newsletter. The old combined "Twilio bulk adapter" row is gone: there is no bulk SMS adapter in this design, because SMS has no campaign entity.)*

---

## §12 Blockers and open decisions

### 12.1 SMS has three hard prerequisites

**All three must clear before M2 (the first real SMS send) in §11.2.** None is optional and only one is code.

**These apply to manual participant reminders, not only to volume sends.** The §0.2 split removed bulk SMS from the design entirely, and that does not soften any of the three below: R0.4 Stage 3 is a tenancy-isolation defect that a single send exercises just as surely as a thousand, A2P registration governs whether the traffic is permitted at all, and an unnormalized number fails one at a time as readily as in a batch.

1. **R0.4 Stage 3 — `crm_messages` org scoping. This is a BACKFILL-AND-ENFORCE problem, not an add-column problem.** The `org_id` column **already exists** on `crm_messages` (Q14). It is **nullable**, and **7 of 9 rows have it NULL**. The work is: backfill `org_id` from `conversations`, then enforce `NOT NULL`, then scope the RLS policy on it. A prior framing of this as "`crm_messages` has no `org_id`" is wrong and would send a build session looking for the wrong fix. Every SMS send writes to `crm_messages`, so an unscoped row is created by the first reminder, not only by a batch; volume multiplies the exposure surface but does not create it.

2. **Twilio A2P 10DLC registration. This is external lead time, not code.** Brand and campaign registration with the carriers takes days to weeks and cannot be compressed by engineering. It gates throughput and deliverability. Start it early or it becomes the critical path by default.

3. **Phone normalization to E.164.** 2 of 52 stored phones conform, and **zero** consented contacts have a conforming number (§1.2). Without this the SMS audience is zero no matter what else ships, and unnormalized numbers produce silent failures plus duplicate sends across format variants of the same person.

### 12.2 Decisions that are business calls, not engineering calls

| # | Decision | Options | What it blocks |
|---|---|---|---|
| ~~D1~~ | ~~Email sending basis~~ | **RESOLVED 2026-07-25: email is OPT-OUT with a working unsubscribe; SMS is STRICT OPT-IN.** Implemented as default basis by source cohort, not a global default-true. See **§5.2**. | Was blocking the backfill. Now decided. |
| D2 | The 2 contradictory rows (`do_not_contact` and `email_consent` both true) | Suppress both, or review individually | Recipient resolution correctness |
| D3 | The 57 `do_not_contact = true` rows | Confirm as intentional, or treat the bulk-import cohort as an artifact and reset | Audience size |
| D4 | `sequences` vs `campaign_automations` | Keep `sequences` (recommended), retire the other | §4 data model |
| D5 | `org_email_config` Gmail / Apps Script transport | Retire the transport, keep the throttle and warmup concepts | §6.2 throttle |
| D6 | Bulk SMS at all, given an audience of zero and a higher consent bar | Build the seam now, ship later | Scope |
| D7 | Does the xregulation participant agreement constitute consent? (24 contacts) | Requires reading the agreement's consent clause | Audience size |
| D8 | The null-source contacts | Triage by hand, or treat as unconsented | Audience size |

**Recommendation on D6:** build the ledger and the adapter seam so SMS drops in cleanly, ship email first, hold SMS until consent capture produces real opt-ins and the three prerequisites clear.

### 12.2b HARD ORDERING CONSTRAINT: Layer 1 will break platform checkout unless sequenced

> **Consequence of getting this order wrong, in one sentence: the day the Hub revokes the app-role UPDATE grant on the consent columns, every Stripe checkout on the platform starts failing at contact-write, and payments stop.**

**§5.2 Layer 1 makes `contacts.email_consent` and `sms_consent` trigger-derived and revokes `UPDATE` on those columns from the application role.** The platform writes those exact columns directly, on the money path:

- `npu-platform-v2/src/app/api/stripe/create-checkout/route.ts:259-262` (existing-contact branch)
- `npu-platform-v2/src/app/api/stripe/create-checkout/route.ts:282-285` (new-contact branch)

Both write `sms_consent`, `sms_consent_at`, `terms_accepted`, `terms_accepted_at` into the **shared** `contacts` table. The Hub does not own that writer, and revoking the grant does not fail loudly in the Hub. It fails in the platform, in checkout, in production.

**The order is not negotiable:**

1. **Platform switches to writing `consent_events`** instead of the `contacts` columns directly.
2. **Verified live with a real checkout** producing a real `consent_events` row. Not a code review, not a staging assumption: a real transaction, confirmed in the ledger.
3. **ONLY THEN does the Hub revoke the app-role `UPDATE` grant** and enable the derived-flag trigger.

**A future session reading §5.2 Layer 1 in isolation must not apply it.** Layer 1 is correct and it is also a cross-repo change with a money-path blast radius. It is not a Hub-only migration, and the Hub cannot verify step 2 by itself. Confirm steps 1 and 2 are done before touching the grant.

See `docs/PLATFORM_CONSENT_WORK.md` for the platform-side work this depends on.

### 12.3 BLOCKER: contact merges lose consent in the permissive direction

**Until this is fixed, no contact merges. Verified live 2026-07-25 (Q17, Q18).**

The merge path never reconciles consent. `/api/contacts/merge/route.ts:26-28` states the design intent plainly: *"Field-level merge toward the fuller record is deliberately NOT decided here. The caller passes `winner_updates` with the fields it chose; this route only applies them. Policy lives in the review UI, mechanism lives here."*

For most fields that separation is correct. For consent it is not, because the review UI does not pass consent fields, so the survivor silently keeps its own values and the loser's recorded decision is abandoned. The failure is asymmetric: **it always resolves toward the more permissive record**, because an unprovenanced `true` on the survivor beats an evidenced `false` on the loser.

Live consequence, one real person: **Melissa Allen declined SMS at checkout on 2026-07-15 with a timestamp, and her live record reads `sms_consent = true`.**

Two corrections to earlier framing in this project, both stated so they are not repeated:

1. **The evidence is stranded, not destroyed.** The merge is a soft delete: the loser row is preserved, and since 2026-07-22 `contact_merge_log.merge_details` also holds a full `loser_snapshot`. Both sources independently confirm Melissa's `false`. An earlier session described the merge as destroying consent, which overstated it. It abandons consent, which is recoverable and is how this was found.
2. **`merge_contact_repoint` is not the culprit.** That function only repoints `*contact_id*` foreign keys and touches no consent column. The defect is in the caller's delegation of policy to the UI.

**Proposed fix (not applied).** Consent reconciliation is a safety invariant, not a presentation choice, so it moves out of the UI and into the route as mechanism:

- Add `email_consent`, `sms_consent`, `email_consent_at`, `sms_consent_at`, `terms_accepted`, `terms_accepted_at`, `email_unsubscribed_at` to the route's `BLOCKED` set at line 148, so the UI can never supply them.
- Compute them server-side, most-restrictive-wins per channel: `winner.x_consent AND loser.x_consent`. A revoke on either side survives the merge.
- Carry evidence forward with `coalesce`, preferring whichever row actually has a timestamp, so provenance is never the thing that gets dropped.
- Record the reconciliation in `merge_details.consent_resolution` with both inputs and the rule applied.
- **Once `consent_events` exists this becomes simpler and strictly better:** consent is no longer a field on the row, so the merge just repoints ledger rows to the winner and the derived flags recompute from the union of both histories. The trigger already produces most-restrictive-wins for free. The field-level reconciliation above is the interim fix for the window before the ledger lands.

**Note on legal posture.** Express written consent, existing business relationship, CAN-SPAM's opt-out regime, and transactional messaging are four different bases with four different rules. A boolean cannot express any of them, which is why the field is empty. The CAN-SPAM and TCPA determination should go to counsel, particularly because Sensorium is a clinical entity. The engineering consequence does not depend on how counsel rules: record a basis and its evidence per contact per channel, and SMS stays strictly opt-in regardless, because the TCPA leaves no room.

---

## §13 Durable operational rules

### 13.1 Migration numbering: Hub starts at 200

**The rule: Hub migrations are numbered from 200 upward. The platform stays in the current sequence. Never cross.**

This is a number, not a principle, because the ledger gives no warning. `supabase_migrations.schema_migrations` keys on a **timestamp `version`**, not on the filename prefix. Two files can both be called `084_*` and both apply cleanly with no error, which is exactly what happened:

| Ledger row | `version` | Owner |
|---|---|---|
| `084_v_platform_signups` | 20260724152537 | **Hub** |
| `083_drop_handle_new_user_trigger` | 20260724225332 | platform |
| `084_complete_signup_rpc` | 20260724225937 | platform |

Both 084s are applied and both objects are live (verified 2026-07-25, Q15). Hub's landed roughly seven hours before the platform's, and nothing errored. Related drift: the Hub tree has no 083, and `072_merge_duplicate_cameron_contact.sql` exists as a file with **no ledger row**, meaning it was applied outside `apply_migration`.

**Highest number currently applied: 084, claimed twice by two repos.** Starting the Hub at 200 leaves a wide gap that the platform will not reach for a long time, and makes ownership readable from the filename alone.

### 13.2 Local `npm run build` halts on `/api/integrations/*`, and this is not a gate failure

**Known non-blocker, diagnosed 2026-07-25.** `npm run build` on this machine compiles successfully, then fails during "Collecting page data" with:

```
Error: supabaseUrl is required.
Failed to collect page data for /api/integrations/neuroreport/sync
```

**Cause:** that route instantiates a Supabase client at **module scope** (`src/app/api/integrations/neuroreport/sync/route.ts:16`) reading `process.env.NEXT_PUBLIC_SUPABASE_URL`, and this working tree contains only `.env.local.example`, no `.env.local`. Any build here fails there regardless of the diff under test.

**Vercel builds fine**, because the environment variables are set there.

**What this means for the gate:** `npx tsc --noEmit` is the reliable local signal and must be clean. A local build failure at `/api/integrations/*` with `supabaseUrl is required` is environmental. **Confirm the failing route is one you did not touch before dismissing it**, and never dismiss a failure elsewhere in the build on these grounds. To get a genuinely green local build, supply a real `.env.local`.

### 13.3 Next artifact clash

When switching between `npm run build` and `next dev`, or after deleting a route, run `rm -rf .next` first. Stale generated type stubs in `.next/types/app/**` reference deleted routes and produce `TS2307: Cannot find module` errors that are not real. This fired during the 2026-07-25 route deletions and resolved cleanly on a fresh `.next`.

---

## Appendix: source queries

Every count in this document traces to one of these, run read-only against `htfrfaxlcuyawtlztxxm` on **2026-07-25**. `base` is `select * from public.contacts where merged_into_id is null`.

```sql
-- Q1: consent column defaults (pg_catalog, never information_schema)
select a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull,
       pg_get_expr(d.adbin, d.adrelid) as default_expr
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
 where c.relname = 'contacts' and a.attname ~ 'consent|unsub|opt';

-- Q2: population and consent provenance in both directions
select count(*) filter (where email_consent)                                    as consent_true,
       count(*) filter (where email_consent and email_consent_at is null)       as true_unprovenanced,
       count(*) filter (where not email_consent)                                as consent_false,
       count(*) filter (where not email_consent
                          and email_unsubscribed_at is not null)                as real_optouts
  from base;

-- Q3: the audience chains, suppression surfaces, contradictions
select count(*) filter (where do_not_contact)                                   as dnc_flag,
       (select count(*) from do_not_contact_list)                               as dnc_table,
       count(*) filter (where do_not_contact and email_consent)                 as contradictions,
       count(*) filter (where phone ~ '^\+1[0-9]{10}$')                         as e164,
       count(*) filter (where sms_consent and not do_not_contact
                          and phone ~ '^\+1[0-9]{10}$')                         as sms_sendable
  from base;

-- Q4: email chain step 4, the eight well-formed non-suppressed consented contacts
select id, first_name, last_name, email, source from base
 where email_consent and not do_not_contact
   and coalesce(btrim(email),'') <> ''
   and btrim(email) !~* '^mailto:'
   and btrim(email) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$';

-- Q5: address hygiene sweep
select count(*) filter (where btrim(email) ilike 'mailto:%')                    as mailto_prefix,
       count(*) filter (where btrim(email) <> lower(btrim(email)))              as mixed_case,
       count(distinct lower(btrim(replace(email,'mailto:',''))))                as distinct_normalized
  from base where coalesce(btrim(email),'') <> '';

-- Q6: contact_consents shape and foreign keys (why it was rejected)
select conname, confrelid::regclass from pg_constraint
 where conrelid = 'public.contact_consents'::regclass and contype = 'f';

-- Q7: the existing campaigns table (why the name was rejected)
select count(*) from public.campaigns;

-- Q8: email_sends structure (why the ALTER was rejected)
select conname, confrelid::regclass, confdeltype from pg_constraint
 where conrelid = 'public.email_sends'::regclass and contype = 'f';
select polname from pg_policy where polrelid = 'public.email_sends'::regclass;

-- Q9: the 077 claim patterns to generalize
select pg_get_indexdef(indexrelid) from pg_index
 where indrelid = 'public.stage_email_sends'::regclass;

-- Q10: scaffolding inventory
select (select count(*) from org_email_config), (select count(*) from org_email_daily_stats),
       (select count(*) from sequences),        (select count(*) from sequence_enrollments);

-- Q11: the ledger gap
select (select count(*) from email_sends)       as email_sends_rows,
       (select count(*) from stage_email_sends where status = 'sent') as real_sends;

-- Q12: email_campaigns columns (proving the dead routes' schema never existed)
select a.attname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
 where c.relname = 'email_campaigns';

-- Q13: the white-label leak
select pg_get_expr(d.adbin, d.adrelid) from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'from_email'
  join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
 where c.relname = 'email_templates';

-- Q14: R0.4 Stage 3, the backfill-and-enforce shape
select count(*) as total, count(*) filter (where org_id is null) as org_id_null
  from crm_messages;

-- Q15: the cross-repo migration collision
select version, name from supabase_migrations.schema_migrations
 where name ~ '^08' order by version;

-- Q16: source cohorts for the D1 default-basis assignment (§5.2)
with c as (
  select *,
    case
      when source in ('xregulation','neuroreport','Podcast','Website','Workshop',
                      'manual_ecr','inbound_call','stripe','Other') then 'A_owned_channel'
      when source = 'media_appearance'                               then 'B_media_interaction'
      when source ilike 'http%'                                      then 'D_social_scrape'
      when source is null                                            then 'E_null_source'
      else 'C_bulk_import'
    end as cohort
    from base)
select cohort, count(*) as contacts,
       count(*) filter (where coalesce(btrim(email),'') <> ''
                          and not do_not_contact)             as emailable,
       count(*) filter (where created_at::date
                          in ('2026-03-11','2026-03-12'))     as from_scrape_days
  from c group by cohort order by cohort;

-- Q17: EVERY consent-bearing column across ALL merged-away rows.
-- This is the coverage proof for "only two rows carry real evidence": it tests all
-- nine columns, not just the timestamped two. 35 merged rows; 8 carry any flag;
-- 1 evidenced divergence (Melissa Allen); 0 chained merges.
with m as (select * from contacts where merged_into_id is not null)
select left(m.id::text,8) as merged_row, m.email,
       m.email_consent, s.email_consent as surv_email_consent,
       m.sms_consent,   s.sms_consent   as surv_sms_consent,
       m.sms_consent_at, m.terms_accepted, m.terms_accepted_at,
       m.email_consent_at, m.email_unsubscribed_at, m.consent_forms
  from m join contacts s on s.id = m.merged_into_id
 where m.email_consent or m.sms_consent or m.sms_consent_at is not null
    or m.terms_accepted or m.email_consent_at is not null
    or m.email_unsubscribed_at is not null
    or (m.consent_forms is not null and m.consent_forms::text not in ('[]','{}','null'));
-- chain check (returned 0, so no multi-hop merges to follow):
select count(*) from m where merged_into_id in (select id from m);

-- Q18: the merge-log snapshot corroborating the loser rows (both merged 2026-07-22)
select left(loser_id::text,8), left(winner_id::text,8), created_at::date,
       merge_details->'loser_snapshot'->>'sms_consent'    as snap_sms_consent,
       merge_details->'loser_snapshot'->>'sms_consent_at' as snap_sms_at
  from contact_merge_log
 where loser_id in ('9af172f5-...'::uuid, '68099477-...'::uuid);
```
