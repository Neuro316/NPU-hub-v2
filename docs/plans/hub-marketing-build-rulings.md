# Hub marketing engine: rulings and plan

**Branch:** `feat/hub-marketing-engine` (NPU-hub-v2 only)
**Status:** Stage 0 APPROVED 2026-09-30. Stage 1 in progress.

## 0. Stage 0 approval rulings (Cameron, 2026-09-30)

1. `funnel_campaigns` approved (A1).
2. The consent ledger starts empty; only the two real SMS decisions are imported. No re-permission campaign in this build (A5).
3. Contact position in its own table approved (A2).
4. Direct Resend REST API approved (A6).
5. Branch fallback approved (A7). Every object copied by hand is listed in the Stage 1 results, and the tests run the real functions.
6. `university_assets` and `/a/<token>` approved (A9, A10). The token is single-purpose, expiring and carries no personal data; the redirect is allowed only to the University's own domain.
7. Middleware public paths approved as **exact paths only**: intake, unsubscribe, the Resend webhook (signature verified, unsigned rejected), and `/a/*`. No other wildcards.
8. **Marketing sender** is read from an org setting (`org_settings` key `hub_send_policy`, fields `from_address` and `from_domain`), defaulting to a placeholder subdomain value Cameron will set. Never hardcoded. The provider refuses a live send while the placeholder is in place.
9. **Migration files are named with a `hub_` prefix**, starting at 211: `hub_211_marketing_engine.sql`.

### Assumptions recorded in Stage 1 (2026-09-30)

- **A15. The two imported SMS decisions are recorded narrowly.** Cameron's checkout grant is recorded as `kind = service` only, because a checkout reminders checkbox is not evidence of marketing consent. Melissa's revocation is recorded for both `service` and `marketing`, because a refusal is read as broadly as possible.
- **A16. Team membership helper.** RLS for staff reads uses a new security-definer function `hub_team_org_ids()` over active `team_profiles` rows, per ruling 17. The platform's `user_org_ids()` reads `org_members`, which is a different membership model, so it is not reused.
**Written:** 2026-09-30
**Queue ref:** this file is the record for the Hub. Hub has no Addendum C; the Hub backlog lives in `CURRENT.md` and `docs/`. A pointer entry goes into `CURRENT.md` at Stage 4.

---

## 1. Rulings (Cameron, 2026-09-30, filed verbatim in substance, not relitigated)

1. Build Hub Phases 1 and 2 only. No NeuroReport or platform changes. Where the platform must later call the Hub, build the receiving endpoint and document it in `docs/INTEGRATION_CONTRACT.md`. Do not build the caller.
2. Migrations are additive only, in the Hub band (200 and up), numbered after the max of both repos. Nothing drops, renames or rewrites existing columns or tables. Existing pipelines, contacts, sequences and stage emails keep working untouched until a flag switches them over.
3. Pipelines and stages get real tables with stable uuid ids. Everything new references ids, never names. Backfill from the current stage names and keep the old name columns as they are.
4. Single write door: enrollment, stage moves and consent changes go through Postgres functions (security definer, `search_path` set). Routes call the function.
5. One enrollment engine: `enroll(contact, campaign, source_key, event_id)` is idempotent on (contact, campaign, source event). Every entry event calls it. Routing rules map a source key to a campaign.
6. Sequences are the only drip engine. Stage emails keep running as they do. Campaign steps live on sequences.
7. Consent is a ledger: `consent_events` (contact, channel email or sms, kind marketing or service, granted or revoked, source, timestamp, text shown). Marketing sends need marketing consent for that channel. Service messages need only a service basis. Unsubscribe and STOP write a revoked row and suppress immediately.
8. Send gate order, every send: flag (live or dry-run), consent for kind and channel, DNC and suppression, quiet hours (contact local time, default 8 AM to 8 PM), frequency cap (default 3 marketing messages per contact per 7 days, overridable per org), then claim-then-send on an outbox row. Every decision is logged with its reason.
9. Email provider is Resend, reusing the existing `RESEND_API_KEY` variable name. Never read or print its value. Provider module behind an interface, verified sender, `List-Unsubscribe` and `List-Unsubscribe-Post` headers, one-click unsubscribe endpoint, webhook route for delivered, bounced, complained, opened, clicked, which suppresses on hard bounce and complaint. The Apps Script relay stays.
10. Everything ships in dry-run. Live sending only to the allowlist `campaign_test_contacts`. Going live for real contacts is a per-campaign switch that only Cameron flips.
11. A `deliver_asset` step creates a tokenised, expiring link to a University resource and records the grant. University access rules are not changed.
12. One public intake endpoint, forms defined in data (`form_definitions`), exact consent text recorded, honeypot plus rate limit.
13. `job_runs` for every cron; a watchdog texts Cameron through `hub_sms_outbox`. New crons are in `vercel.json`, reachable through middleware, fail closed. The six never-running crons are listed, not fixed.
14. Every new service-role route sits behind the auth wrapper or a verified secret. The only new public routes touching contacts are intake, unsubscribe and the provider webhook.
15. Every new env var goes in `.env.example` with a comment.
16. No em dashes in anything written. Complete flowing sentences in user-facing copy.
17. `pg_catalog` for grants and constraints; RLS on every new table with explicit policies, `WITH CHECK` on UPDATE, aliased correlated subqueries; org derived from membership; clinic tables untouched.
18. Reads against live run autonomously. Writes only with approval on exact SQL. Never `supabase db push`. Test the bundle on a Supabase branch first.

---

## 2. What the live database and the repo actually hold (measured 2026-09-30)

| Fact | Measured | Consequence |
|---|---|---|
| `public.campaigns` **exists with 4 rows**, a marketing-program planning entity (`budget`, `icp_id`, `funnel_config`, `phases`) | pg_class, count(*) | **A new table cannot be named `campaigns`.** See A1 |
| `pipelines`, `pipeline_stages`, `consent_events`, `message_sends`, `form_definitions`, `job_runs`, `asset_grants`, `campaign_routes`, `suppressions`, `send_log`, `campaign_test_contacts` | none exist | free names |
| Pipelines live in `org_settings.crm_pipelines` JSON: NP 17 pipelines, Sensorium 7, stage ids like `stage-0` | org_settings read | backfill source for ruling 3 |
| `sequences`, `sequence_steps`, `sequence_enrollments` | **0 rows each** | additive columns carry no data risk |
| `contacts` live rows | 326 | has `pipeline_id`, `pipeline_stage`, `email_consent`, `sms_consent`, `do_not_contact`, `timezone`, `source`, `acquisition_utm` |
| `hub_sms_outbox` | exists, **0 policies**, service-role only | watchdog inserts there |
| Hub migrations on disk | max **210** | |
| Platform migrations | max **pf_201** (applied today) | ⚠ the platform has entered the 200s with the `pf_` prefix; recorded as a finding |
| **Next Hub number** | **211** | one bundle, `hub_211_marketing_engine.sql` |
| Supabase branches | `preview` exists, status **MIGRATIONS_FAILED**, schema-only | see A7 |
| Resend in the Hub | **none**: no package, no key read; only a provider dropdown label in settings | new module |
| Resend in the platform | `src/lib/notify/send.ts`, sender `NPU University <onboarding@neuroprogeny.com>`, npm `resend` | root domain `neuroprogeny.com` is already a Resend sender |
| Auth wrapper in the Hub | **none exists**; each route hand-rolls `getUser()` | one is created (`src/lib/api-guard.ts`) |
| CI in the Hub | **no `.github/workflows`** | one is created |

---

## 3. Assumptions (safer reading taken where the rulings are silent)

**A1. The campaign table is `funnel_campaigns`, not `campaigns`.** The ruling names a table `campaigns`; that name is a populated planning table (and the Bulk Campaigns design §2.2 already rejected colliding with it). Creating it would fail, and altering the planning table's meaning is a rewrite. `funnel_campaigns` carries a nullable `planning_campaign_id` FK to `campaigns(id)` so the two can be linked in the UI. The UI still says "Campaigns".

**A2. Contact position is a new table, not a new column on `contacts`.** `contact_pipeline_positions(contact_id, pipeline_id uuid, stage_id uuid)` keeps `contacts` (shared with the platform) byte-identical. `move_stage()` writes the position row and, only when the `engine` flag is on for the org, also mirrors the legacy `contacts.pipeline_id` / `pipeline_stage` text so the existing board keeps rendering. With the flag off it mirrors nothing and nothing reads the new table.

**A3. Pipeline backfill keeps the JSON's text id as `legacy_key`**, unique per org, so the existing board and stage emails (which key on `stage-N` text ids) can be joined to the new uuids without either changing. A stage rename in the JSON updates `pipeline_stages.name` through `sync_pipelines_from_settings()`; ids never move. Stage emails keep reading the JSON (ruling 6).

**A4. Outbox table uses the already-approved design name `message_sends`** (Bulk Campaigns §4.3, DDL reused with `kind` and `dry_run` added). `send_log` is the decision log (one row per gate evaluation, including refusals). `stage_email_sends` and `email_sends` are untouched.

**A5. The consent ledger merges ruling 7 with the approved §4.2 design**: columns for `kind` (marketing, service), `basis`, `method`, `source`, `text_shown`, `evidence`. **No backfill from the legacy booleans**, because they are unprovenanced (§1.1 of the design). The two real SMS decisions (Cameron granted, Melissa revoked, design §4.2.1) are imported as ledger rows. **Legacy `contacts.*_consent` columns are not touched and not made derived**; making them derived is Layer 1, which breaks platform checkout per design §12.2b. Consequence, stated: the marketing audience is zero until consent capture (intake forms) produces real grants.

**A6. Resend is called over its REST API with `fetch`.** Hub CLAUDE.md requires approval for new npm packages; the REST call needs none. Key read at call time, so rotation needs no code change.

**A7. If a new Supabase branch fails its migration replay** (the existing `preview` did), the bundle is tested on the branch after bootstrapping only its dependencies (`organizations`, `contacts`, `profiles`, `team_profiles`, `org_settings`, `sequences*`, `do_not_contact_list`, `hub_sms_outbox`, the RLS helper functions) from DDL read out of live `pg_catalog`. The branch results will say which objects were bootstrapped rather than replayed. The branch is deleted after the live apply.

**A8. Flags and send policy live in `org_settings`**, keys `hub_marketing_flags` and `hub_send_policy`, per org, read server-side only. No new table. Missing key means every flag off.

**A9. The University asset list is a small Hub table `university_assets`** (title, description, University path). The ruling lists `asset_grants` but a grant needs something to point at; the platform catalogue is not readable without a platform change. Cameron fills the list in the UI.

**A10. The deliver link is a Hub URL `/a/<token>`** that validates the token, records the redemption, and redirects to `https://university.neuroprogeny.com<path>` (the existing signup and access path). Only a sha256 of the token is stored.

**A11. The auth wrapper derives org from active `team_profiles` membership** (ruling 17), never from the body and never from `profiles.organization_id`.

**A12. The cross-repo migration-number guard reads a committed snapshot** of the platform's migration names (`scripts/guards/platform-migrations.txt`), because CI cannot read the private platform repo. Locally it can also read `../npu-platform-v2/supabase/migrations`. The snapshot is refreshed by `npm run guards:refresh`.

**A13. Contract tests run against the Supabase branch, not in CI** (CI has no secrets, matching the platform's rule). They are a `REQUIRES_LIVE` script run by hand, with results pasted into the Stage 1 proposal and the Stage 4 pack.

**A14. Contact merge during enrollment:** `enroll()` resolves `merged_into_id` to the survivor before inserting, and the idempotency key is on the survivor, so an event arriving for a merged-away id enrolls the survivor once.

---

## 4. Migration bundle outline (`hub_211_marketing_engine.sql`, one file, one apply)

Rollback block written first, in the file.

**Tables** (all `org_id uuid not null`, RLS on, `revoke all from anon, authenticated` then explicit grants only where a browser reads; writes go through functions or service-role routes):

| Table | Purpose |
|---|---|
| `pipelines` | id, org_id, legacy_key, name, is_default, position |
| `pipeline_stages` | id, pipeline_id, org_id, legacy_key, name, position, is_closed_won, is_closed_lost |
| `contact_pipeline_positions` | contact, pipeline, stage, moved_at, moved_by, source (A2) |
| `funnel_campaigns` | name, status, entry pipeline id + stage id, sequence_id, goal (jsonb), `live_enabled boolean default false`, `planning_campaign_id` |
| `campaign_routes` | org, source_key, campaign_id, active, priority |
| `campaign_enrollments` | contact, campaign, source_key, event_id, status; **unique (contact_id, campaign_id, source_key, event_id)** |
| `consent_events` | append-only ledger (A5); update/delete revoked from every role |
| `suppressions` | org, channel, address, reason (hard_bounce, complaint, unsubscribe, stop, manual) |
| `message_sends` | outbox with claim index `(contact_id, channel, dedupe_key) where status in ('sending','sent')`, `dry_run`, `kind` |
| `send_log` | every gate decision: step, outcome, reason |
| `provider_events` | Resend webhook events, unique on provider event id |
| `form_definitions` | slug, fields jsonb, consent text per channel and kind, campaign/source_key, version |
| `form_submissions` | raw submission audit, ip hash, for rate limiting |
| `campaign_test_contacts` | allowlist: seeded with Cameron's email and his Hub profile phone |
| `job_runs` | job, started_at, finished_at, rows_touched, ok, error |
| `university_assets` | A9 |
| `asset_grants` | contact, asset, token_hash, expires_at, redeemed_at |

**Additive columns on sequences** (0 rows): `sequences.campaign_id uuid null`, `sequence_steps.step_type text default 'message'` (message, deliver_asset), `sequence_steps.kind text null` (marketing, service), `sequence_steps.asset_id uuid null`, `sequence_enrollments.campaign_enrollment_id uuid null`.

**Functions** (security definer, `set search_path = ''`, `revoke execute from public`, granted to `service_role` only unless a browser path needs it):
`sync_pipelines_from_settings(org)`, `enroll(contact, campaign, source_key, event_id)`, `route_and_enroll(org, contact, source_key, event_id)`, `move_stage(contact, stage, actor, source)`, `record_consent(contact, channel, kind, action, source, text_shown, evidence)`, `consent_state(contact, channel, kind)`, `gate_check(contact, channel, kind, org)` returning the decision and reason, `claim_send(...)`.

**Data:** pipeline backfill via `sync_pipelines_from_settings` for both orgs; the two SMS ledger imports; allowlist seed.

---

## 5. Ordered work and files

**Stage 1.** Branch, bootstrap if needed (A7), apply 211, run contract tests there, propose for live with rollback and results. **Stop.** Apply on go, read back.

**Stage 2** (`src/lib/marketing/*`):
`flags.ts`, `gate.ts` (calls `gate_check`, then claim), `providers/types.ts`, `providers/resend.ts`, `providers/twilio.ts` (wraps existing `sendOrgSms`), `engine.ts` (enroll, move, step executor), `tokens.ts`, `job-runs.ts`, `src/lib/api-guard.ts`, `src/components/ui/toast.tsx`.
Routes: `api/intake/[slug]` (public), `api/email/unsubscribe` + page `/u/[token]` (public), `api/webhooks/resend` (public, signature verified), `api/cron/campaign-watchdog`, `api/marketing/*` (staff, wrapped), `/a/[token]` redirect.
Changes to existing files, all behind flags: `api/sequences/process-step` (campaign-linked enrollments go through the gate; others untouched), `api/twilio/inbound-sms` (STOP writes `record_consent` revoked, in addition to what it does now), `supabase-middleware.ts` public paths, `vercel.json`, `.env.local.example`.
Tests: `scripts/marketing/contract-*.cjs` (live), `scripts/guards/*.cjs` (pure, CI), `scripts/marketing/flags-off-parity.cjs` (pure).

**Stage 3** UI: Campaigns hub (funnels view, detail with entry pipeline and stage, sequence steps with email and SMS preview, deliver step), contact drawer tabs Timeline, Consent, Campaigns, source attribution panel, University assets list, forms builder, settings (sender, quiet hours, caps, flags read-only view).

**Stage 4** as specified.

---

## 6. Proving existing behaviour is unchanged

1. **Untouched files stay untouched.** `api/crm/stage-emails/route.ts`, `api/cron/sms-outbox/route.ts`, `lib/notify-sms.ts`, `lib/sms-outbox.ts`: `git diff main -- <files>` must print nothing. Asserted by a guard.
2. **Flags-off parity harness** for every existing file that does change (`process-step`, `inbound-sms`): compile `main`'s version and the branch's version, run both against the same stubbed Supabase and Twilio with flags absent, record every DB call and send, and diff the transcripts. Must be identical. Tamper: turn the engine flag on in the branch run and it must differ.
3. **Live read-only before and after** of `stage_email_sends`, `hub_sms_outbox`, `crm_messages` counts around the deploy, plus one stage-email drag and one outbox row by Cameron if he wants a live confirmation (not done by me).
4. HEAD~1 discrimination on every harness at Stage 4.

---

## 7. Costs and risks stated

- One Supabase branch for the duration of Stage 1 (billed hourly, deleted after).
- `inbound-sms` and `process-step` are live paths; their changes are flag-gated and covered by the parity harness.
- Middleware public-path change is an auth change and is listed for review.
- CI suite does not exist in the Hub, so there is no budget to exceed; the new suite is pure and should run in well under a minute.

---

## 8. Stage 1 results (2026-09-30)

**Branch:** `hub-marketing-211`, project ref `ykhgxzpagiviimshzfxc`. Like the existing `preview`
branch it came up `MIGRATIONS_FAILED` with 0 tables, so fallback A7 was used.

**Objects copied by hand onto the branch** (`supabase/branch-bootstrap/hub_211_dependencies.sql`,
copied from live `pg_catalog`, columns, defaults, PK/unique/check constraints and the FKs between
them; no policies, triggers or indexes):
type `user_role`; tables `organizations`, `profiles`, `team_profiles`, `contacts`, `org_settings`,
`sequences`, `sequence_steps`, `sequence_enrollments`, `do_not_contact_list`, `campaigns`,
`contact_timeline`; two fixture `organizations` rows (Neuro Progeny, Sensorium). One correction was
needed: `contacts.search_vector` is a generated column on live, so it is created `generated always`.

**The tests run the real functions** from `hub_211` (`scripts/marketing/contract-211.sql`), with
fixtures inside a subtransaction that is always rolled back.

| Run | Cases | Red | Declared | Verdict |
|---|---|---|---|---|
| none | 45 | {} | {} | pass |
| quiet (end boundary inclusive) | 45 | {G_QUIET_2000} | same | pass |
| cap (`>` for `>=`) | 45 | {G_CAP_AT_LIMIT} | same | pass |
| dupactive (no active check) | 45 | {E_ACTIVE_NO_2ND_SEQ, M_GOAL_ENDS_DRIP} | same | pass |
| revokeorder (oldest event wins) | 45 | {C_STOP_SUPPRESSES, C_UNSUB_KEEPS_SERVICE, G_REVOKED_MID} | same | pass |
| merge (no merge resolution) | 45 | {E_MERGED_DUP, E_MERGED_TO_SURVIVOR} | same | pass |

Covered: duplicate event, revoked consent mid-sequence, stage rename (id kept) and stage removal
(archived), contact merge during enrollment, quiet-hours boundaries at 07:59:59, 08:00, 19:59:59 and
20:00 local, frequency-cap boundary (2 allowed, 3 refused, a send exactly 7 days old not counted,
service exempt), live versus dry-run mode, claim-once, append-only ledger, cross-org refusal, RLS as a
real `authenticated` staff member (own org readable, other org not, no writes, no function execute,
`job_runs` closed).

**A defect the tamper run found, fixed before proposing.** The first `revokeorder` run reddened
nothing. Cause: two consent events in one transaction share `now()`, so "the latest event" had no
defined order and the result depended on heap order. `consent_events` now carries a
`seq bigint generated always as identity` tiebreaker and every read orders by
`occurred_at desc, seq desc`. The rollback block was then exercised on the branch (it left exactly the
11 bootstrap tables and 0 functions), the bundle reapplied, and the suite rerun to the table above.

**Branch default privileges differ from live.** On the branch a new table gives `service_role` no DML;
on live it gets all 8. The bundle now grants `service_role` explicitly (the ledger gets SELECT and
INSERT only), so the result is the same in both. Probed as `service_role`: insert accepted, update
refused `42501`. That delta was applied to the branch as a separate statement after the reapply.

**pg_catalog posture on the branch:** 17 new tables, RLS on 17, `anon` grants 0, `authenticated`
holds SELECT only on 16 (not `job_runs`), 16 policies all SELECT, the only new function executable
beyond `service_role` is `hub_team_org_ids` (to `authenticated`, needed by the policies).

**Live pre-flight (read-only, 2026-09-30):** no name collisions for the 17 tables, the 17 functions
or the 5 columns (controls in the same query form found 2 of 2 known objects); ledger has no `211`;
sequences tables hold 0 rows; no `hub_marketing_flags` or `hub_send_policy` rows exist, so every
flag is off after apply. Expected data effects: 24 pipelines, 175 stages, 270 contact positions (of
280 contacts carrying a legacy pipeline; 10 have a stage name not found in their pipeline and are
left unpositioned), 3 consent rows (Cameron service grant; Melissa service and marketing revoke),
1 allowlist row.

### Assumptions recorded in Stage 1, continued

- **A17. Stages without a JSON id** (15 of them, in the NP `Subscribed` and `Mastermind` pipelines)
  are keyed `name:<name>`. Renaming one of those in the old editor creates a new stage and archives
  the old one, because there is no id to follow. Stages with ids keep their uuid through a rename.
- **A18. A second entry event while a contact is active in the same campaign** is recorded with
  status `duplicate` and starts nothing, so one person never runs two copies of one drip.
- **A19. A service message needs a service basis**: the latest service-kind event for that channel,
  or, when there is none, a standing marketing grant. An email unsubscribe revokes marketing only;
  SMS STOP revokes both kinds.

### Stage 1 re-verification and live apply (2026-10-01, on Cameron's go)

**Fresh branch, verbatim files.** `reset_branch` replays the branch's own recorded history, so it
restored the earlier objects rather than an empty schema. That branch was deleted and a fresh one
created (`hub-marketing-211b`, ref `wprcaujbcprnondqziuj`, 0 tables). Both files were then loaded
unmodified and proven byte-identical from the branch ledger: sha256 of the recorded statements
`2c4c0482...59fc` (bootstrap) and `e5a61a82...13e6` (hub_211), equal to the local files.

**Rerun:** 45 cases green; quiet {G_QUIET_2000}, cap {G_CAP_AT_LIMIT}, dupactive
{E_ACTIVE_NO_2ND_SEQ, M_GOAL_ENDS_DRIP}, revokeorder {C_STOP_SUPPRESSES, C_UNSUB_KEEPS_SERVICE,
G_REVOKED_MID}, merge {E_MERGED_DUP, E_MERGED_TO_SURVIVOR}. Identical to the earlier run.
service_role on the fresh branch: funnel_campaigns full DML, consent_events SELECT and INSERT only.

**Live apply:** ledger version `20261001002152`, recorded sha256 `e5a61a82...13e6`. Read back through
pg_catalog: 17 tables, RLS on 17, 16 policies, 17 functions, 5 new columns, 0 anon grants, engine
functions not executable by PUBLIC, anon or authenticated; consent_events service_role privileges
SELECT and INSERT only. Data: 24 pipelines, 175 stages, 270 positions, 3 consent rows (service
granted, service revoked, marketing revoked), 1 allowlist row, 0 flag rows (every flag off).
Both test branches deleted.

**Concurrent activity seen:** `pf_202_platform_ledger` was applied by a platform session at
`20261001001328`, between the preflight and the apply. It touches only `commission_ledger`.

**The 10 contacts left without a stage position** (their stage text is not a stage of their pipeline):

| Contact | Pipeline | Stage text on the contact |
|---|---|---|
| Bradley Mitchell | Enrolled | Signed up |
| Cameron Allen | Enrolled | Checkout started |
| Dyann Meyers | Enrolled | Paid |
| Dylan Constance | Enrolled | Signed up |
| Laurie Tewksbury | Enrolled | Signed up |
| Logan Berzenski | Enrolled | Signed up |
| Luke Harris | Enrolled | Signed up |
| Savanna Poole | Enrolled | Signed up |
| Hazel Thornton | (pipeline key not found) | Enrolled |
| Test Test | (pipeline key not found) | Application |

All Neuro Progeny. Eight sit on stage names the `Enrolled` pipeline does not define (`Signed up`,
`Checkout started`, `Paid`); Dyann Meyers is the `Paid` case CURRENT.md already records for repair
206. Two carry a pipeline key that matches no pipeline in the settings.

---

## 9. Stage 2 (2026-10-01)

Built: engine (`src/lib/marketing/engine.ts`), gate client, Resend and Twilio providers behind
`providers/types.ts`, unsubscribe (`/api/email/unsubscribe`), Resend webhook (`/api/webhooks/resend`),
intake (`/api/intake`), asset redirect (`/a/<token>`), crons `/api/cron/campaign-steps` and
`/api/cron/watchdog` with `job_runs`, flags, the staff routes under `/api/marketing/*` behind
`withStaff`, the guards (`scripts/guards/run-guards.cjs`), the harnesses and `npm run verify`
(also `.github/workflows/verify.yml`, no secrets).

### Assumptions recorded in Stage 2

- **A20. Campaign steps run on their own cron, `/api/cron/campaign-steps`.** The existing
  `/api/sequences/process-step` is one of the six crons middleware redirects to `/login`, so it has
  never run; ruling 13 says not to fix it. The new cron processes the same `sequence_enrollments` and
  `sequence_steps` tables (still one drip engine) but only rows with `campaign_enrollment_id`, and
  `process-step` now skips those rows so no enrollment can ever be handled by both.
- **A21. Existing crons do not write `job_runs`.** Ruling 13 says every cron writes it; adding writes
  to `sms-outbox` would break the promise that the stage-email and sms-outbox paths are unchanged.
  The two new crons write it and the watchdog monitors them. Wiring the existing ones in is listed
  as a decision.
- **A22. STOP and START write the consent ledger even with every flag off.** STOP revokes both
  kinds and suppresses the number; START restores service messages only, because marketing needs an
  express opt-in. The existing contact writes and the reply to Twilio are unchanged (parity harness).
- **A23. `.env.example` was gitignored** by the existing `.env*` rule. A negation `!.env.example` was
  added so the variable catalogue ruling 15 asks for can be committed. It holds names only.
- **A24. Unlabelled steps are treated as marketing**, the stricter of the two consent rules.
- **A25. A live marketing email also needs `HUB_UNSUBSCRIBE_SECRET`**, since no email may go without
  a working one-click unsubscribe. A missing secret skips the send with a recorded reason.

### Findings while building (not fixed)

- Six crons in `vercel.json` can never run: middleware redirects a cookieless request to `/login`
  (`/api/sequences/process-step`, `/api/sms/process-scheduled`, `/api/inbox/process-unsnooze`,
  `/api/stats/daily-rollup`, `/api/usage/rollup`, `/api/maintenance/cleanup-recordings`).
- `verifyCronSecret` (`src/lib/crm-server.ts:525`) and `/api/cron/crm-due-dates` compare against
  `` `Bearer ${process.env.CRON_SECRET}` ``, which accepts the literal `Bearer undefined` if the secret
  is ever unset. Guard G2 lists nine crons that do not fail closed.
- Guard G1 lists 74 existing service-role routes that do not use a shared auth wrapper. Most hand-roll
  `getUser()`; they are listed, not audited one by one.
- Platform migrations `pf_200`, `pf_201`, `pf_202` sit in the Hub's 200 band; `pf_202` and the Hub's
  `202_crm_messages_recovered_at` share a number.

### Stage 2 code review (code-reviewer subagent, 2026-10-01) and what was done

Fixed in code: (1) a retry after an ambiguous provider outcome could send twice: email now carries
an idempotency key that is the same on every retry, an SMS whose request may have reached Twilio is
recorded `outcome_unknown` and never retried, and a reaper converts sends stuck in `sending` for 30
minutes into `outcome_unknown`; (2) a public form could reverse someone's opt-out or grant SMS
consent to a number already on file: it may now only add consent, never override a revocation, and
SMS consent counts only for the number the visitor typed; (3) merge values were pasted raw into email
HTML: they are escaped, and the STOP-line check reads the template, not merged text; (4) `withStaff`
admitted participant and facilitator team rows: it now admits super_admin, admin and team_member
only; (5) a failure after the claim stranded the row: before the provider call the row is marked
failed and retried, after it the reaper applies; (6) saving a sequence deleted and re-inserted steps:
steps are now updated in place by position, keeping their ids; (7) SMS length is checked after merge
tags and the STOP line, in dry runs too; (9) time zone and send window are validated as stored;
(10) unsubscribes and bounces also suppress the address the message was sent to; (11) engine writes
check their row count; (12) the honeypot path is rate limited; (13) START records consent only in
the org that owns the receiving number; (14) SMS now has its own flag, `provider_sms`.

Not fixed, recorded: (8) deleting a funnel campaign sets `sequence_enrollments.campaign_enrollment_id`
to NULL (the FK is `on delete set null` in hub_211), which would make those rows look like legacy
enrollments to `/api/sequences/process-step`. It is latent: nothing in the UI deletes a campaign
(campaigns are archived), and `process-step` cannot run while middleware redirects it. A follow-up
migration should change that FK; it is listed as a decision. (15) Naming differences from the Stage 0
file list: intake is `/api/intake` with the form slug in the body, the watchdog is
`/api/cron/watchdog`, the unsubscribe confirmation is the GET of the same route, the gate client
lives in `engine.ts`, and the Twilio provider is `providers/twilio-sms.ts`.

- **A26. Single opt-in.** A form records consent on submission without a confirmation email. Double
  opt-in is listed as a decision.

---

## 10. Stage 4 (2026-10-01)

- **Merged** `feat/hub-marketing-engine` into `main` as `5f22e95fc573061163520a5bf918dea456f577e1`
  (69 files, +5584 -10 against `3492d97`). **Deployed** as `dpl_Ben8FXWTX4if9ktoaL5b9RnV8kPx`, Ready,
  holding `hub.neuroprogeny.com`, selected by `vercel ls --meta githubCommitSha=<merge sha>` (1 row; the
  pre-merge sha selects a different deployment).
- **Production probes:** unsubscribe with a bad token 400, `/api/cron/campaign-steps` without the
  secret 401, `/api/webhooks/resend` unsigned 401, `/api/intake` unknown form 404, `/a/<bad>` 410,
  `/api/marketing/overview` without a session 307 to `/login`.
- **HEAD~1 discrimination:** today's harnesses run against the tree before the merge: parity 3 red
  (no marked blocks), guards 26 new G3 findings (no `.env.example`), pure harness fails (modules absent).
- **End to end dry run on live, once:** NP `engine` switched on and the send window opened to all day
  (both via org_settings rows that did not exist before), one active campaign "Dry run check
  (2026-10-01)" with a single SMS service step, the owner's contact enrolled through `public.enroll`.
  The deployed cron ran at 00:55:09 UTC:
  - `job_runs`: `campaign-steps ok=true rows=1 {"counts":{"dry_run_completed":1}}`
  - `send_log`: `sms service allow mode=dry_run step=all reason=passed`
  - `message_sends`: `sms service status=dry_run dry_run=true body="Hub dry run check for Cameron. Nothing is sent in a dry run."`
  - the enrollment completed.
  Afterwards both settings rows were deleted (back to absent, `hub_flag(engine)` reads `off`) and the
  campaign archived. Nothing was sent: before and after the deploy and the run, `stage_email_sends` 13,
  `hub_sms_outbox` 1, `crm_messages` 62.


---

## 11. Funnels made self-explanatory (2026-10-01, UI only)

Built: an (i) popover on every section title and non-obvious field, a "How a funnel campaign works"
overview, a Starts from picker that produces the existing source keys (with "Advanced: type a key"),
a five-step guided setup (purpose and name, who enters, pipeline, messages with starter templates,
review and test with a readiness checklist), "Run the guided setup again" on drafts, empty and error
states that say what to do next, and the latest test drive decision with its plain reason on the
campaign page. One read-only route was added, `GET /api/marketing/campaigns/<id>/activity`, and the
overview now says whether the unsubscribe secret is set (a boolean, never the secret). No engine,
gate, flag, consent or permission code changed.

### Assumptions recorded

- **A27. A test drive needs the campaign to be Active.** `public.enroll` only enrolls into active
  campaigns, and changing that would change engine behaviour. The guided setup therefore offers
  "Save, set Active and test drive", says plainly that Active lets real people enter from its
  sources, and that while live sending is off they only get dry runs.
- **A28. Only forms are connected today.** The picker offers missed and answered calls, bookings,
  tags, stage changes, quizzes and imports, which produce `call:`, `booking:`, `tag:`, `stage:`,
  `quiz:` and `import:` keys, but nothing in the Hub emits those events yet. The picker and the
  campaign page say "Nothing sends this event yet" beside them rather than hide them.
- **A29. A stage-change source is keyed by stage id** (`stage:<uuid>`), so renaming a stage does not
  break the route (ruling 3).
- **A30. The University asset template is a service message**, because the person asked for it.
  The welcome and nurture templates are marketing; the reminder template is service.
- **A31. "Previews checked" and "test drive run" are tracked for the current setup session.** The
  Hub stores no record of who previewed what, and adding one would be a schema change.
- **A32. The activity route shows message bodies only for allowlisted test contacts**, so the
  campaign page never displays a real person's message.

## 12. Bug: "The sequence could not be created" (2026-10-01)

**What the funnel code sent.** `POST /api/marketing/sequences` (`src/app/api/marketing/sequences/route.ts`)
inserted `created_by: ctx.userId`. `ctx.userId` is the AUTH user id, from the cookie session in
`withStaff` (`src/lib/api-guard.ts`). Live `sequences.created_by` is
`FOREIGN KEY (created_by) REFERENCES team_members(id)`, so every new sequence failed with 23503.
`sequence_steps` and `sequence_enrollments` have no column pointing at a user and were not affected.

**Why the branch tests missed it.** `supabase/branch-bootstrap/hub_211_dependencies.sql` copied only
the foreign keys whose target was another copied table or `auth.users`. `sequences_created_by_fkey`
points at `team_members`, which was not copied, so the constraint was silently left out and the
branch accepted any `created_by`. A bootstrap that drops a constraint makes every test on that
table blind to it. The next bootstrap must include every FK of every copied table, copying the
target table too, or list each dropped FK by name.

**Fix.** `src/lib/marketing/team-member.ts` resolves the signed-in user's `team_members.id` by
membership, `(org_id, user_id)` (UNIQUE) and `is_active`, never by `profiles.organization_id`. No
active row means null; `sequences.created_by` is nullable (checked in `pg_attribute`). Constraint
failures in the campaign, steps, source and asset routes now return a plain sentence
(`src/lib/marketing/db-errors.ts`), for example "The steps could not be saved because your team
member record could not be matched to this organization.", never SQL.

**Every foreign key from a column the new code writes into an EXISTING table, verified in pg_catalog
2026-10-01:**

| Column the code writes | Constraint | Value the code sends | Verdict |
|---|---|---|---|
| `sequences.created_by` | `sequences_created_by_fkey` -> `team_members(id)` | was the auth user id; now the team_members id or null | **fixed** |
| `sequences.org_id` | `sequences_org_id_fkey` -> `organizations(id)` | the org from membership | correct |
| `sequences.campaign_id` | `sequences_campaign_id_fkey` -> `funnel_campaigns(id)` | a campaign checked to be in the org | correct |
| `sequence_steps.sequence_id` | `sequence_steps_sequence_id_fkey` -> `sequences(id)` | the sequence just read or created | correct |
| `sequence_steps.asset_id` | `sequence_steps_asset_id_fkey` -> `university_assets(id)` | an asset checked to be in the org | correct |
| `sequence_enrollments.sequence_id` | `sequence_enrollments_sequence_id_fkey` -> `sequences(id)` | set inside `public.enroll` | correct |
| `sequence_enrollments.campaign_enrollment_id` | -> `campaign_enrollments(id)` | set inside `public.enroll` | correct |
| `contacts.org_id` (intake) | `contacts_org_id_fkey` -> `organizations(id)` | the form's org | correct |
| `contacts.assigned_to`, `contacts.identity_id` | -> `team_members(id)`, -> `identity_graph(id)` | never written by the new code | not affected |
| `org_settings.org_id` | `org_settings_org_id_fkey` -> `organizations(id)` | the org from membership | correct |
| `contact_timeline.org_id` | `contact_timeline_org_id_fkey` -> `organizations(id)` | the contact's org, inside the functions | correct |
| `hub_sms_outbox` (watchdog) | `org_id`, `user_id` | NP org and the owner's profile id | written the same way as before this build |

Columns holding a user id that have **no** foreign key on live, so the auth user id stays:
`funnel_campaigns.created_by`, `funnel_campaigns.live_enabled_by`, `form_definitions.created_by`,
`consent_events.actor_id`, `suppressions.lifted_by`, `contact_pipeline_positions.moved_by`,
`contact_timeline.actor_id`.

**Contract test.** `scripts/marketing/sequence-created-by-probe.cjs` (REQUIRES_LIVE database, read
only): compiles the real route, runs it as a real staff user against live reads with every write
captured and never sent, and requires the `created_by` it would insert to be null or an active
`team_members` id for that user in that org. Its control C1 proves the auth user id is not a
`team_members` id. `TAMPER=authid` reddens exactly S1.

- **A33. A missing team_members row saves with `created_by` null** rather than refusing, because the
  column is nullable and authorship is not worth blocking a save for.

## 13. Entry events: stage, calls, tags, imports (2026-10-01)

Request: wire the entry events the Funnels page lists but nothing fired, behind the engine flag,
through the existing `route_and_enroll` and routing rules, idempotent on a stable event id.
Branch `feat/entry-events`. Migration `hub_212_entry_events.sql`: **PROPOSED, not applied to live.**

### Every code path that writes a contact's stage (measured by grep for `pipeline_stage` writes)

| # | Path | Write | Raises a stage event? |
|---|---|---|---|
| 1 | Board drag, `crm/pipelines/page.tsx:880` via `crm-client.ts updateContact` (browser) | UPDATE | **yes**, trigger |
| 2 | Board pipeline change `:891`, clear pipeline `:898` | UPDATE | yes when it lands on a stage; clearing has no stage |
| 3 | Contact drawer, `components/crm/contact-detail.tsx:1679, 1683, 1696` | UPDATE | **yes**, trigger |
| 4 | Bulk "move to stage" and "set pipeline", `api/contacts/bulk-action` | UPDATE, one statement | **yes**, trigger; plus one job log summary and the cap note |
| 5 | Accounting payment marks paid, `api/accounting/payments:120` | UPDATE | **yes**, trigger |
| 6 | Identity resolve, `api/identity/resolve:98`, `lib/identity-client.ts:359` | UPDATE | **yes**, trigger |
| 7 | Onboarding pipeline existing contact, `lib/onboarding-pipeline.ts:219` | UPDATE | **yes**, trigger |
| 8 | Any write from another app on the shared database (the University, NeuroReport) | UPDATE | **yes**: the trigger is on the table, so it sees writes this repo cannot |
| 9 | Board create `:713`, contacts page create `:770`, EHR client create `ehr/ecr:448`, equipment import `:134`, identity resolve `:81`, onboarding new contact `:240`, Stripe auto tagger new buyer `:155`, NeuroReport sync `:233`, accounting signup `accounting-auth.ts:211`, CRM import new rows | INSERT | **no** (A35) |
| 10 | Engine moves: `move_stage` mirroring a campaign's entry stage | UPDATE | **no**, deliberately (A37) |
| 11 | Contact merge, winner update, `api/contacts/merge` | UPDATE | **no**: guarded (A38) |
| 12 | CRM import updating an existing duplicate | UPDATE | **no**: guarded (A38) |

Tags follow the same rule: every UPDATE that adds to `contacts.tags` (drawer, bulk add tags,
Stripe auto tagger, onboarding, any other app) and every INSERT into `contact_tags` raises
`tag:<slug>`. `merge_union_tags` (075) is honoured exactly as `trg_contact_tag_change` honours it.

### How it is built

- **Triggers queue, a cron enrolls.** Stage and tag changes are caught by statement-level
  triggers on `contacts` and `contact_tags`, because nine paths write them and some are in the
  browser or in other repos. Calls are raised from `api/twilio/ring-complete`. Chosen imports are
  queued by `POST /api/marketing/import-events`. All of them only insert into `entry_events`
  through `raise_entry_event`, which does nothing unless the engine flag is on **and** an active
  route listens for that key. `/api/cron/entry-events` (every 5 minutes, `CRON_SECRET`) feeds the
  queue to the existing `route_and_enroll`, at most 100 per run, one `job_runs` row per run.
- **Enrolling sends nothing by itself.** Every message still goes through `gate_check` when its
  step runs, so a bulk move enrolls people without sending anything the gate would block.
- **No event creates or changes consent.** Nothing on this path calls `record_consent` or touches
  `consent_events`, `suppressions` or the consent columns; the contract proves the counts are
  unchanged and `entry-wiring-tamper` W10 proves no such call exists in the code.
- **A trigger can never block the write it observes.** Each trigger body is wrapped so any failure
  is a warning and the contact update still commits. `contacts` is shared with the University.
- **Cheap when idle.** Each trigger first checks whether any active route listens for a stage or a
  tag at all, and returns at once when none does, which is the state of every org today.

### Event ids (idempotency)

| Source | Source key | Event id |
|---|---|---|
| Stage change | `stage:<stage uuid>` | `stage_change:<contact>:<stage>:<transaction id>` |
| Tag added | `tag:<slug>` | `tag_added:<contact>:<slug>:<transaction id>` |
| Call answered | `call:answered` and the older `call:inbound` | `call:<CallSid>` |
| Call missed | `call:missed` | `call:<CallSid>` |
| Import, chosen | `import:<slug>` | `import_completed:<batch>:<contact>` |

`entry_events` is unique on (org, source key, event id), and `enroll` is unique on (contact,
campaign, source key, event id). A Twilio retry, a double click or a re-run of the import enroll is
the same event and starts nothing new.

### Branch results (preview branch `lapearkxzeqrfeavchsq`)

Loaded `hub_211_dependencies.sql`, hub_211's statements, `branch-bootstrap/hub_212_dependencies.sql`
(objects copied by hand from live pg_catalog: `contact_tag_definitions`, `contact_tags`,
`contact_import_batches`, and `merge_union_tags` verbatim from 075), then hub_212 through
`apply_migration`. The ledger's stored statement hashed to the file body's sha256
(`d12ba8f6...`), so the branch ran exactly the file. The rollback block was run once on the branch
and left 0 functions, 0 tables, 0 triggers and 0 ledger rows; hub_212 was then reapplied.

`scripts/marketing/contract-212.sql`: **22 cases green** under `none`, and each planted defect
reddened exactly its declared set: `flagoff` {F_OFF_RAISE}, `noidem` {D_SAME_EVENT_ONCE},
`noguard` {M_GUARD_SKIPS}, `mergetags` {T_MERGE_UNION_SILENT}, `enginemove` {E_ENGINE_MOVE_SILENT},
`nocap` {B_BULK_CAP}.

**Found by the contract and fixed before proposing:** `process_entry_events` first set its
"engine is writing" switch for the whole transaction, so any later stage change in the same
transaction raised nothing (`S_STAGE_RAISED` read 0). It is now switched on for the
`route_and_enroll` call only. Production runs the cron in its own transaction, so this was latent,
not live.

### Assumptions recorded

- **A34. "call:answered", "tag:added" and "import:completed" are event NAMES; the source keys a
  route listens on stay specific.** A funnel must say which tag or which import starts it, so the
  keys are `tag:<slug>` and `import:<slug>`, and the event names live in the event id. An answered
  call raises both `call:answered` and the older `call:inbound`, because one live route
  (`call:inbound`) already exists; the picker now offers `call:answered`.
- **A35. Creating a contact is not a stage change or a tag being added.** INSERTs raise nothing.
  Otherwise every plain import (which inserts with a stage and tags) would enroll, which the
  request forbids. Cost: a Stripe buyer whose contact is created with a tag does not raise
  `tag:<slug>`; only a later tag addition does.
- **A36. The per-run cap is 100 every 5 minutes, and one import may queue at most 1,000.** Above
  1,000 the import enroll refuses with a message to split the file, and queues nobody. Bulk stage
  moves are never refused: they queue, and the person is told how long entry will take.
- **A37. Stage moves the engine makes itself raise nothing.** When `enroll` moves a contact into a
  campaign's entry stage, that is not a person's action; letting it raise an event would chain
  campaigns into each other.
- **A38. Merges and import updates are guarded by a time window, per contact.** The merge route
  opens a 10 minute window on both contacts before it repoints anything and closes it at the end;
  the import page opens a 60 minute window on the duplicates it will update and closes it when
  done. Any event raised for those contacts inside the window is skipped. Cost: a real stage
  change made to those exact contacts during that window is skipped too. If the guard cannot be
  set, the merge or import does not run.
- **A39. Import enrollment is open to any staff member running the import**, because the person
  importing is the one who chooses, as the request says. It still needs the engine on and an
  active campaign listening for that import name.
- **A40. "Connected" comes from the database and the line settings**: the triggers and queue
  function exist (`entry_source_status()`, read through pg_catalog), and the org has at least one
  phone line in CRM Settings, Twilio. Booking and quiz show "not connected yet" because nothing in
  the Hub raises them.
- **A41. The bulk summary counts this org's stage events since the move started**, so a stage
  move by someone else in the same second is counted too. It is a summary line, not a ledger.

### Not connected yet, and why

- **Booking** (`booking:<slug>`): the Hub has no booking flow that knows the booking kind; the
  session ledger lives in the University. Needs a decision on which system fires it.
- **Quiz** (`quiz:<slug>`): quiz results are written by the University and NeuroReport
  (`nr_quiz_results`), not the Hub. A trigger on that table would work, and is a separate change to a
  shared table the University owns.
- **A new contact created with a tag or a stage** (A35).

### Overhead benchmark and the revision it forced (2026-10-01, before any live apply)

Cameron's condition on the go: measure a bulk stage update of at least 300 contacts with the
engine off, on with nobody listening, and listening, against the same update without the trigger,
and stop if the first two add noticeable overhead.

**Method.** 400 contacts on the branch; per case, 12 rounds of updating all 400, each round
running no trigger, the approved trigger and the revised trigger in a rotating order, so table
bloat from earlier updates hits all three equally; first round dropped, medians reported, every
run rolled back. A first, sequential attempt was discarded: each case ran after the previous ones
in one transaction, so later cases were slowed by dead rows regardless of design.

| case (400-row update, median ms) | no trigger | approved file (d656be3f) | revised file (0630d111) |
|---|---|---|---|
| engine off, a campaign listening | 17.5 / 23.5 | 32.2 / 35.7 (+12 to 15) | 19.7 / 23.7 (+0 to 2) |
| engine on, nobody listening | 19.3 / 26.0 | 19.8 / 25.3 (none) | 19.7 / 25.0 (none) |
| engine on, listening to a different stage | 22.3 | 76.1 (+54) | 70.2 (+48) |
| engine on, listening, 400 events queued | 23.8 | 168.6 | 165.2 (+141, about 0.35 ms an event) |
| unrelated column only, a campaign listening | 27.4 | 44.5 | 45.5 (+17) |

**The approved file failed the engine-off condition**: its cheap exit asked only whether any stage
or tag route existed, so with the engine off it still joined and checked the flag row by row. The
revised file's exit asks whether any org **with the engine on** has an active stage or tag route,
once per statement. Only the trigger bodies changed; the contract (22 cases, 6 planted defects)
was rerun on the revised body and is green.

**A row-level trigger was tried and rejected**: limited to the stage and tag columns it costs
nothing on unrelated updates, but it runs its checks once per row, and a 400-row stage move with
nobody listening cost +26 ms (later +70 ms) against about 0 for the statement trigger.

- **A42. The remaining cost is accepted and stated**: once an org with the engine on has a stage or
  tag campaign, every update of `contacts` pays about 0.04 ms a row to materialise the changed rows,
  including updates that touch neither column (+17 ms per 400 rows). Until then it is about zero.
  On live today no stage or tag route exists, so the exit is taken on every update.

### Live apply, deploy and click-through (2026-10-01, on Cameron's go for the revised file)

- **Applied** the body of `hub_212_entry_events.sql` (the file's first 46 lines are comments only).
  Ledger `20261001114831`, stored statement sha256 `cdb0c469...`, matching the tested body;
  8 functions, 3 triggers, `raise_entry_event` executable by postgres and service_role only.
- **Deployed** `69b92af` (deployment `dvu4v9pwe`, holding `hub.neuroprogeny.com`), then the fix
  below as `246b3a2` (deployment `339ykq3mt`, holding the alias). Each confirmed by
  `vercel ls --meta githubCommitSha`, with the previous commit selecting a different deployment.

**Defect found by the click-through, fixed the same hour.** The entry-events cron logged runs at
12:00, 12:05 and 12:10 reporting "processed 0, still waiting 0" while a pending event sat in the
queue. `pg_stat_statements` showed **one** call to `process_entry_events` across three runs: the
repeated rpc, a POST with an identical body inside a GET route handler, was answered from the
Next.js Data Cache and never reached the database. `force-dynamic` did not prevent it.
`createAdminSupabase` now forces `cache: 'no-store'` on every request, and the three crons set
`fetchCache = 'force-no-store'`. `entry-wiring-tamper` W11 guards it (`TAMPER=cached`); against the
pre-fix `main` exactly W11 is red. The first run after the fix (12:15) processed the event.

- **A43. The same cache could have answered any repeated identical rpc from a service-role client
  in a GET route**, including a repeated `gate_check` in the campaign-steps engine. Measured: the
  campaign-steps table reads did reach the database on every run (135 runs, 135 reads), so the
  exposure was to repeated identical POST bodies. The factory fix covers every caller.

**Board drag, end to end (test funnel "TEST entry events 2026-10-01", one service text step,
source `stage:c4810bd4...`, "Completed course Joined Alumni Membership", a stage with no stage
emails):**

| time (UTC) | what |
|---|---|
| 12:01:40 | the card for Cameron's own contact dragged on the Enrolled board; one `entry_events` row, `pending` |
| 12:15:20 | cron: "processed 1, enrolled 1, skipped 0, failed 0, still waiting 0 (cap 100 per run)" |
| 12:20:09 | campaign-steps: `dry_run_completed: 1`; gate `allow`, mode `dry_run`, reason `passed`; one `message_sends` row, `dry_run`, SMS to the test number |

Afterwards the route was removed and the campaign archived. Read back: **0** active stage or tag
routes, the test funnel archived, its one enrollment Cameron's own contact, **0** live sends.
No stage email was sent by the drag.

**Missed call: not triggered.** Nothing available to this session can place an inbound call.
Steps for Cameron are in the review pack.

**Left as found, for Cameron:** the test contact now sits in "Completed course Joined Alumni
Membership"; it was in "Checkout started", which is not a column on the board. And the existing
`call:inbound` route on campaign `c2616c69...` now receives real answered calls on both lines,
because ring-complete raises `call:inbound` alongside `call:answered` (A34).

### Enrolled pipeline: unplaced contacts (2026-10-01)

**SUPERSEDED, DO NOT APPLY: `supabase/data-fixes/2026-10-01_enrolled_missing_stages.sql`** (branch
`data/enrolled-missing-stages`, `c10030a`, sha256 `dbcbef27...`). It added "Signed up", "Checkout
started" and "Paid" as stages. Cameron ruled against it: "Paid" is a defect value the Hub already
corrected to "Paid/ payment plan" (`accounting-auth.ts:56-60`), and "Signed up" is the NeuroReport
sync's old default, since replaced by the pipeline's first stage (`cf6c5ce`). Adding them would
create near-duplicate columns.

**PROPOSED instead: `supabase/data-fixes/2026-10-01_enrolled_checkout_started.sql`**, not applied.
Adds only "Checkout started" (settings JSON plus the existing sync, no stage emails), moves the 6
"Signed up" contacts to "Signed up - add user email used to sign up in Circle; dependency has to be
joined circle " and the 1 "Paid" contact to "Paid/ payment plan", and places all 8, including
contact 4cb236f6 at "Checkout started". "Checkout started" is written live by the University's
checkout (`npu-platform-v2/src/app/api/stripe/create-checkout/route.ts:363, 385`).

- **A44. The two target stages DO have stage emails configured** ("Signed up - add user email...":
  one client email with empty subject and body, plus legacy fields marked enabled, subject "Test",
  to internal; "Paid/ payment plan": one internal email, subject "Test"). Cameron's precondition was
  that they have none; it does not hold. The write still sends nothing: stage emails are sent only
  by `POST /api/crm/stage-emails`, which only the board calls from the browser on a drag, and no
  database trigger, function or webhook sends one (pg_catalog, all three repos searched). The file
  aborts if any `stage_email_sends` or `message_sends` row is written in its transaction. Dragging
  one of these 7 contacts on the board later will send that stage's email as it always has.
- **A45. Side effect:** `trg_pipeline_timeline` writes one "pipeline_changed" row per moved contact
  (7), and the rollback writes 7 more.
