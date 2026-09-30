# Hub marketing engine: rulings and plan

**Branch:** `feat/hub-marketing-engine` (NPU-hub-v2 only)
**Status:** Stage 0, awaiting plan approval. Nothing built, nothing applied.
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
| **Next Hub number** | **211** | one bundle, `211_hub_marketing_engine.sql` |
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

## 4. Migration bundle outline (`211_hub_marketing_engine.sql`, one file, one apply)

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
