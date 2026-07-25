# Hub CRM — Bulk Email + SMS Campaigns (Design Spec)

> **STATUS: DESIGN, NOT BUILT.** Read-only investigation completed 2026-07-25 against the live Hub DB
> (`htfrfaxlcuyawtlztxxm`, shared with the platform). No code written, no migration applied. This doc
> is written to hand to a build session cold.
>
> **Scope: NPU-hub-v2 only.** The send machinery is worth building. It is NOT the thing that unblocks
> reaching people. Read §0 before anything else — it changes what "done" means.

---

## 0. THE REACHABILITY GATE (resolve before building sends)

**Finding: `contacts.email_consent` is `NOT NULL DEFAULT false`. The 232 false values are the default
applied at import, not recorded opt-outs. This is a consent-was-never-captured problem, and it cannot
be swept.**

Proof (all read-only, 2026-07-25):

1. **Column default is `false`** (pg_catalog: `pg_attrdef`). `sms_consent` too. Every contact created
   without an explicit consent decision is born unreachable.
2. **Categorical, not scattered.** Every bulk-import cohort is uniformly `email_consent=false`:
   `xregulation` 0/24, `media_appearance` 0/17, `Import` 0/11, every scraped LinkedIn/Instagram
   record 0/1. Genuine opt-outs scatter within a cohort; a whole import reading uniformly false is a
   default the import never overrode.
3. **`contact_consents` audit table is EMPTY (0 rows).** No ledger overrides the boolean; the boolean
   is the sole consent state and nothing ever recorded a decision. `do_not_contact_list` is also empty
   (the ~12 trues are not contradicted).
4. **Reachable today: ~12 email / ~9 SMS.** The `true` values exist only in manual/relationship
   sources (`(null)` 22, `Other`, `Podcast`, `Website`, `Workshop`).

**Consequence.** The 232 are scraped/imported people who never agreed to be emailed. Flipping them to
`true` manufactures consent that was never given — CAN-SPAM / GDPR exposure, and spam complaints from
non-opt-ins would destroy the Resend domain reputation and make the ~12 *legitimate* recipients
undeliverable. **A bulk sender reaches twelve people. The missing piece is a consent-capture path, not
a sender.**

### What actually unblocks this (prerequisite work, not part of the sender)

- **G1 — Consent capture.** An opt-in mechanism that writes a real decision: public subscribe/preference
  page, double opt-in email, and consent-at-source on the forms that create contacts (website, xreg,
  checkout). Until this exists, the sender has no audience to grow into.
- **G2 — Consent provenance.** Repurpose the empty `contact_consents` table as the append-only ledger
  (who, when, channel, method, IP/source). The boolean on `contacts` becomes a *cache* of "latest
  ledger state," never the source of truth. This makes consent auditable, which is the thing a
  regulator asks for.
- **G3 — Malformed-email sweep** (small, real): 1 `mailto:` prefix (Rachel Kimmel), 1 missing `@`,
  4 literal "test", 1 fails basic shape. Note a naive `%@%`/shape regex PASSES `mailto:rachel@x.com`
  and `test@test.com` — the sweep needs explicit prefix + pattern checks, then a normalize
  (strip `mailto:`, trim) or quarantine.

**Every section below that assumes a reachable audience is tagged `⟦GATE⟧`. Those parts are inert until
G1 exists.** The parts NOT tagged (ledger, pipeline, adapters, consent enforcement, engagement wiring,
composer) are worth building now because they are correct regardless and because the 1:1 and sequence
surfaces already need several of them.

---

## 1. What already exists — REUSE MAP (do not rebuild)

| Capability | Where | Reuse |
|---|---|---|
| **Campaign shell (email)** | `email_campaigns` table — name, subject, body_html/text, from_name, reply_to, status, scheduled_at, started/completed_at, total/sent/failed counts, **filter_tags / filter_stages / exclude_tags**, created_by | Data model is ~80% built. Extend, don't recreate. No SMS analog yet. |
| **Claim-before-send guard** | `stage_email_sends` + `src/app/api/crm/stage-emails/route.ts` (migration 077, 080) | The canonical pattern: INSERT a claim keyed on stable ids, unique index arbitrates races, stale-claim release (15m), skip persisted as a durable row. **This is the campaign send primitive.** |
| **Drip engine** | `sequences`, `sequence_steps`, `sequence_enrollments` + `src/app/api/sequences/process-step/route.ts` (cron) | Per-contact multi-step scheduler with a cron worker. Template for the campaign queue worker. See §2 for extend-vs-standalone. |
| **Per-channel consent check** | stage-emails route (`email_consent === false` → skip) and process-step (`!sms_consent`/`!email_consent` → skip) | Precedent exists but is a *code check*, easy to forget. §6 makes it structural. |
| **Twilio org send + campaign routing** | `src/lib/twilio-org.ts` — `getOrgTwilioConfig(orgId)`, `SendContext` already includes `'campaign'` and `'sequence'` → `outreach` number purpose; `src/lib/twilio.ts` `sendSms(to, body)` | Bulk SMS number routing is ALREADY anticipated. Reuse `receiverIdentity(orgId)` + outreach caller ID. |
| **Send ledger (email)** | `email_sends` — campaign_id, contact_id, status, sent_at, **opened_at, clicked_at**, external_message_id, error_message | Exists. See §7 — it is read by scoring but under-written. |
| **Engagement scoring** | `src/lib/crm-server.ts:419` reads `email_sends.opened_at/clicked_at` (15% of score) | Every contact scores 0% because opens/clicks are never populated. §7 fixes this. |
| **DNC** | `do_not_contact_list` + `isDNC()` in crm-server.ts | Global suppression, already checked by sequences. Campaigns must check it too. |

**Two existing gaps this design must not reproduce:**

- **Email does not go through Resend today.** Both stage-emails and sequences send via a **Google Apps
  Script / Gmail webhook** (`org_email_config.webhook_url`). The design constraint says Resend. Moving
  to Resend is what makes open/click tracking (§7) and domain reputation manageable — but it is a real
  adapter swap, not a given (see §5).
- **Sequences write `crm_messages` for SMS and nothing to `email_sends` for email.** So sequence emails
  are invisible to scoring too. The ledger write (§7) should be shared by all three surfaces.

---

## 2. Architectural decision — extend sequences, or stand alone?

**Recommendation: a thin new campaign surface that REUSES the send primitives, not an extension of the
sequence enrollment model.**

They share primitives (per-recipient claim, consent gate, channel adapter, cron worker) but differ in
shape:

- A **sequence** is N messages to ONE contact over time (`sequence_enrollments` is per-contact, has
  `current_step` / `next_step_at`).
- A **campaign** is ONE message to N contacts at once (or scheduled once). Modeling that as N
  single-step enrollments abuses the enrollment table and pollutes sequence analytics.

So: `campaigns` + `campaign_recipients` as the new surface; the claim guard, adapters, consent gate,
and ledger are **shared libraries** both surfaces call. The `process-step` cron is the template for a
`process-campaign` cron. This keeps sequences and campaigns as siblings over one send core, which is
also where the §6 consent gate belongs so neither can bypass it.

---

## 3. Data model

### 3a. Reuse + rename `email_campaigns` → `campaigns` (channel-generic)

`email_campaigns` already has the shell. Add a channel discriminator rather than a parallel SMS table:

```
campaigns (rename from email_campaigns, or add columns)
  id, org_id, name, status, created_by, created_at, updated_at
  channel            text NOT NULL CHECK (channel IN ('email','sms'))   -- NEW
  -- email fields (nullable when channel='sms')
  subject, body_html, body_text, from_name, reply_to
  -- sms fields (nullable when channel='email')                          -- NEW
  sms_body           text
  -- audience (already present)
  filter_tags text[], filter_stages text[], exclude_tags text[]
  -- scheduling + counters (already present)
  scheduled_at, started_at, completed_at, total_recipients, sent_count, failed_count
  skipped_count      integer DEFAULT 0                                   -- NEW (consent/DNC skips)
```

`status`: `draft → scheduled → sending → sent → failed` (mirror `email_campaigns.status` values).

### 3b. `campaign_recipients` — the per-recipient claim ledger (NEW, models `stage_email_sends`)

This is the send primitive. One row per (campaign, contact), and the row IS the claim.

```
campaign_recipients
  id            uuid pk
  campaign_id   uuid not null references campaigns(id) on delete cascade
  org_id        uuid not null                       -- denormalized for RLS, per Hub convention
  contact_id    uuid not null references contacts(id) on delete cascade
  channel       text not null                       -- copied from campaign, immutable
  to_address    text not null                       -- resolved email or E.164 phone at claim time
  status        text not null default 'pending'
                --  pending | sending | sent | failed | skipped
  skip_reason   text                                -- 'no_consent' | 'no_address' | 'dnc' | 'malformed'
  external_message_id text                          -- Resend id / Twilio sid
  error_message text
  claimed_at    timestamptz
  sent_at       timestamptz
  opened_at     timestamptz                         -- email only (webhook)
  clicked_at    timestamptz                         -- email only (webhook)
  created_at    timestamptz not null default now()

  -- THE GUARD (mirrors stage_email_sends' partial unique index):
  -- one live claim per (campaign, contact); 'skipped'/'failed' never block a retry.
  UNIQUE (campaign_id, contact_id) WHERE status IN ('sending','sent')
```

Design choices carried over from 077/080 verbatim, because they were paid for once already:
- **Claim, not check.** INSERT the `sending` row first; only send if the insert won the partial unique
  index. A check-then-send races.
- **Skips are durable rows** (`status='skipped'`, `skip_reason`), so "why didn't X get it?" is answered
  from the DB, not a lost HTTP response. Matches migration 080.
- **`skipped`/`failed` excluded from the unique index**, so a transient failure or a consent-skip never
  permanently bars a contact from a later campaign.

### 3c. Consent ledger `contact_consents` (repurpose the empty table) `⟦partly GATE⟧`

Make it the append-only source of truth; the `contacts.email_consent/sms_consent` booleans become a
cache updated by trigger or by the capture endpoints.

```
contact_consents (columns TBD against current empty table; proposed shape)
  id, org_id, contact_id
  channel        text CHECK (channel IN ('email','sms'))
  granted        boolean            -- true = opt-in, false = opt-out
  method         text               -- 'double_opt_in' | 'form' | 'import_attested' | 'manual' | 'unsubscribe'
  source         text               -- url / campaign / staff user id
  occurred_at    timestamptz
  proof          jsonb              -- IP, user agent, form id, confirmation token
```

Per-channel by construction: an email opt-in row grants email only. SMS is a separate row. This makes
"email consent ≠ SMS consent" a data fact, not a convention.

---

## 4. Send pipeline (claim, throttle, retry, dedupe)

A cron worker (`/api/campaigns/process`, cron-secret gated exactly like `sequences/process-step`) that
runs in small batches. **Materialize recipients once, then process idempotently.**

1. **Materialize `⟦GATE⟧`** — when a campaign goes `scheduled → sending`, resolve the audience from
   `filter_tags/stages` minus `exclude_tags`, and INSERT one `campaign_recipients` row per contact at
   `status='pending'`. This is the dedupe boundary: the unique index means re-materializing is a no-op.
2. **Claim** — worker selects `pending` rows for due campaigns, `LIMIT batch`, and moves each to
   `sending` via the guarded insert/update. Two workers cannot claim the same recipient.
3. **Consent + suppression gate (§6)** — evaluated at claim time, on fresh data. Fail → write
   `status='skipped'` with `skip_reason`, increment `campaigns.skipped_count`, never call the provider.
4. **Send** — channel adapter (§5). Success → `sent` + `external_message_id` + `sent_at`. Failure →
   `failed` + `error_message` (claim released from the unique index, so it is retryable).
5. **Throttle** — per-org rate limit (Resend/Twilio quotas + reputation). Batch size + inter-batch
   delay; carry a per-org token budget in the worker. SMS throttle is stricter (A2P 10DLC throughput).
6. **Retry** — `failed` rows are eligible next tick up to `max_attempts` (add an `attempts int`); after
   the cap, terminal `failed`. Transient (5xx / network) retries; hard bounces (invalid address) go
   terminal and SHOULD write a consent/suppression signal (§7).
7. **Complete** — when no `pending`/`sending` remain, campaign → `sent`, stamp `completed_at`, reconcile
   `sent_count/failed_count/skipped_count` from the ledger (counts derive from rows, never the reverse).

**Stale-claim release** (15m, from 077): a worker that dies mid-send leaves a `sending` row; the next
tick releases claims older than the threshold to `failed` before claiming, so nothing wedges forever.

---

## 5. Channel adapters

One interface, two implementations, called only by the pipeline:

```
sendOne(channel, orgId, to, rendered) -> { success, externalId?, error?, hardBounce? }
```

### Email — Resend (NEW adapter) `⟦partly GATE⟧`
- Current email path is the Apps Script/Gmail webhook. **Introduce `src/lib/resend.ts`** using the
  org's verified sending domain (per-org for white-label — NP vs Sensorium send from their own domains).
- **Migrate stage-emails and sequences to the same adapter** so there is one email path, one place opens/
  clicks are tracked, and one domain-reputation surface. This is the change that makes §7 real.
- Set `external_message_id` from Resend; wire Resend **webhooks** (delivered/opened/clicked/bounced/
  complained) to the ledger (§7).
- Every email includes a working **unsubscribe** (List-Unsubscribe header + link) that writes a
  `contact_consents` opt-out and flips the cache. Required for CAN-SPAM and reputation.

### SMS — Twilio (REUSE) 
- Reuse `getOrgTwilioConfig(orgId)` + `sendSms`, with `SendContext='campaign'` → `outreach` number
  (already defined in `twilio-org.ts`). No new Twilio plumbing.
- **Decision needed:** bulk SMS currently would write `crm_messages` (the 1:1 store) as sequences do,
  intermixing blasts with human threads. Recommend campaign sends log to `campaign_recipients` only and
  NOT into `crm_messages`, to keep the 1:1 inbox clean — but inbound replies to a campaign still land in
  `crm_messages` via the existing Conversations webhook (that is correct and desired).
- A2P 10DLC throughput + STOP handling: Twilio auto-handles STOP, but STOP must write a
  `contact_consents` sms opt-out and flip the cache, or the next campaign re-includes them.

---

## 6. Consent enforcement — structural, not a code check

Today consent is an `if` inside each send path. The design makes it impossible to send without valid,
per-channel consent, in **two layers**:

1. **Application gate (single chokepoint).** All three surfaces (campaign, sequence, stage-email) call
   ONE `assertSendable(channel, contact, orgId)` that returns sendable | skip(reason). It checks, in
   order: address present + well-formed → not in `do_not_contact_list` → consent granted for THIS
   channel. No surface talks to an adapter without passing through it. One function to audit, one place
   that can never be forgotten.
2. **Database backstop.** A partial unique index cannot express "consent," but a **trigger on
   `campaign_recipients`** can reject a transition to `status='sending'` when the contact's cached
   consent for `channel` is false. Defense in depth: even a future code path that skips the app gate
   cannot flip a row to `sending` without consent. (Mirrors the platform's "identity/consent from the
   server, never the caller" posture.)

**Per-channel is enforced by shape:** consent lives in `contact_consents(channel)` and the cache is two
booleans. An email campaign reads email consent; it is structurally unable to consult SMS consent.

**`⟦GATE⟧`** — this section is correct today but has almost nothing to admit until G1 populates real
consent. That is the point: the gate is built so that when the audience arrives, it is already safe.

---

## 7. Engagement tracking — fix the `email_sends` logging gap

**Problem:** `crm-server.ts:419` scores email engagement from `email_sends.opened_at/clicked_at`, but
those are never populated (stage-emails only recently began writing `email_sends` at all, via the admin
client to bypass the `email_sends_via_campaign` RLS policy; sequences write nothing). So every contact
scores 0% on the 15% email-engagement component.

**Design:**
- **One ledger, written by the shared send core.** `campaign_recipients` is the campaign detail; on each
  send also upsert a row into `email_sends` (`campaign_id` set for campaigns, NULL for stage/sequence —
  the RLS policy already tolerates admin-client writes). Scoring keeps reading `email_sends` unchanged.
  Alternatively, point scoring at a `UNION` view over `campaign_recipients` + `email_sends`; simpler to
  keep one physical ledger and write it from the core.
- **Populate opens/clicks from Resend webhooks.** The `opened`/`clicked` events set `opened_at/clicked_at`
  by `external_message_id`. This is the first time these columns get real data, so scoring stops being a
  constant 0.
- **Bounces/complaints are consent signals, not just failures.** A hard bounce or spam complaint writes a
  `contact_consents` opt-out (§3c) and flips the cache, so a bad address or an annoyed recipient is never
  targeted again. This is what protects the ~12 good recipients' deliverability.

---

## 8. AI composer — voice rules

A drafting aid that proposes subject + body (email) or message (SMS) for a campaign, which a human edits
and approves. Never auto-sends.

**Hard voice rules applied to every draft (from the brand voice standard):**
- Complete, flowing sentences. **No em dashes anywhere.**
- No negation-of-brokenness; capacity over pathology ("all behavior is adaptive").
- **Mechanism before modality** — explain the nervous-system *why* before naming the practice.
- 9th-grade reading level.
- HRV as a mirror of state, never a score to optimize; never "sympathovagal balance."
- Questions orient FORWARD (emerging/possible), never back into past failure. Time-anchored
  ("by the end of this week"). "Name 3 things" structure preferred over open-ended.

**Enforcement, not just prompting.** The voice rules go in the system prompt AND a post-generation
linter rejects drafts containing em dashes, pathologizing phrases, or a reading level above grade 9,
and returns them for regeneration. Same "a guard you have never watched fire is not a guard" discipline
as the platform: the linter must have a test that proves it rejects a bad draft.

- Org-scoped tone: NP vs Sensorium sending identity, domain, and any brand nouns come from org settings.
- SMS drafts respect segment length and always include opt-out language ("Reply STOP to opt out").

---

## 9. Dependency flags — what is inert until the gate clears

| Section | Depends on the reachability gate? |
|---|---|
| §3a campaigns shell, §3b `campaign_recipients` | No — build now, correct regardless |
| §3c `contact_consents` ledger | **G2** — build now; it is *how* G1 records consent |
| §4 pipeline | Machinery: no. **Materialize step (§4.1): ⟦GATE⟧** — resolves to ~12 recipients until G1 |
| §5 Resend adapter | No — also fixes stage/sequence email + enables §7 |
| §5 Twilio SMS | No — reuses existing infra |
| §6 consent gate | Build now; **has almost nothing to admit until G1** |
| §7 engagement wiring | No — fixes a live scoring bug independent of campaigns |
| §8 composer | No |
| **Actually sending a bulk campaign to a real audience** | **⟦GATE⟧ — blocked on G1 (consent capture). Today: ~12 email / ~9 SMS.** |

---

## 10. Suggested build order

1. **G3 malformed-email sweep** + **G2 `contact_consents` ledger** with the booleans-as-cache trigger.
   (Small, unblocks correctness, no audience needed.)
2. **§7 Resend adapter + ledger wiring + webhooks.** Fixes the live 0% engagement bug and gives every
   surface one email path. Independently valuable.
3. **§6 `assertSendable` chokepoint + DB backstop trigger.** Route stage-emails and sequences through it.
4. **§3/§4 campaigns + `campaign_recipients` + process cron**, reusing the 077 claim pattern.
5. **§8 composer + voice linter.**
6. **G1 consent capture** (opt-in page, double opt-in, consent-at-source). **This is the real unlock**
   and is arguably a separate project; everything above is safe and useful before it lands, and inert
   for reach until it does.

> The through-line: this session was asked to confront that a campaign system with no audience is what
> got the work parked. It still has no audience. The correct move is to build the send core (safe,
> reusable, fixes existing bugs) and to name consent capture (G1) as the actual blocker — not to
> manufacture consent on 232 scraped contacts to make the demo look populated.
