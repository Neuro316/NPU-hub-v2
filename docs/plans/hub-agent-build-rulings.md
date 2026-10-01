# Hub Campaign Builder Agent: rulings and plan

**Branch:** `feat/campaign-builder-agent` (NPU-hub-v2 only), cut from `main` at `d49d00e`
**Status:** Stage 0 written 2026-10-01. **Awaiting plan approval.** Nothing has been built beyond
Phase 0 (this file, the voice and claims guide, the claims checker and its harness).
**Written:** 2026-10-01
**Queue ref:** this file is the record for the Hub (the Hub has no Addendum C). At stage end a one
line pointer goes into `docs/NPU_Future_Features_Queue_v4.md` addenda and an entry into `CURRENT.md`.
**Prompt:** `docs/plans/hub-agent-build-prompt.md`.

---

## 0. Standing rules carried from the marketing build

Rulings 2, 4 and 13 to 18 of `docs/plans/hub-marketing-build-rulings.md` apply unchanged: additive
migrations in the 200+ band after taking the max of both repos, a single write door through Postgres
functions, `withStaff` on every service-role route, every env var in `.env.example`, no em dashes in
anything written, RLS with explicit `WITH CHECK`, `pg_catalog` not `information_schema`, never
`supabase db push`, branch test before live, and live writes only on Cameron's approval of the exact
SQL.

## 1. Rulings (Cameron, 2026-10-01, filed, not relitigated)

1. **Drafts only.** The agent cannot switch a campaign live, start a send, enroll a contact, record or
   change consent, touch suppressions or `campaign_test_contacts`, or edit anything already live. For
   a live item it may only create a draft copy or a task proposing the change.
2. **No contact data reaches the model.** It sees pipelines, stages, entry sources and whether each is
   connected, University assets, form definitions, step types and the voice and claims guide. Never
   names, emails, phone numbers, message bodies or any contact row. A test fails if any read tool can
   return a contact-level field.
3. **Same validators as the screens.** Every draft tool calls the exact validation code the Hub
   screens and routes use, extracted where it is inline today. The agent cannot create anything a
   person could not create by hand. Names resolve to ids on the server; unknown names go back to the
   model as errors, never guessed.
4. **Connected sources only.** Entry sources available today are those wired in hub_211 and hub_212.
   For anything not connected (bookings, quizzes) the agent creates a task, not a route.
5. **Voice and claims guide**, versioned, logged on every run: `docs/marketing/voice-and-claims-guide.md`.
   Every drafted message also passes a deterministic claims check. Offending drafts are saved but
   marked "needs review" with a task.
6. **Untrusted input.** Pasted text and tool results carrying user-authored text are wrapped and
   labelled as data, never instructions.
7. **Atomic builds.** One run builds in one transaction keyed by run id (a security definer function,
   `search_path` set). Failure rolls back everything; a retry with the same run id is idempotent.
8. **Caps.** Per-run tool-call limit (default 12), per-session message limit, monthly dollar cap from
   `org_settings` (default USD 25), checked before every model call, with a clear message when hit.
   Cost is computed from the usage the API returns, and logged.
9. **Everything is logged** in `agent_sessions` and `agent_runs`: prompt, guide version, model id,
   every tool call with a result summary, tokens, cost, outcome, created draft ids. No contact data
   by construction.
10. **Auth:** `/api/marketing/agent` behind `withStaff`, a superadmin check and org from membership.
    Flag `agent_enabled` in the existing flags mechanism, default off. Rate limit per user.
11. **Model:** Messages API with tool use, server side. `ANTHROPIC_API_KEY` read per call, never
    logged. Model id from `AGENT_MODEL` (default `claude-sonnet-5-5`), never hardcoded in logic. Both
    in `.env.example`. An outage or timeout gives a clear message and leaves nothing half built.
12. **Landing pages are data.** `page_definitions` (draft, published flag, validated block JSON, form
    reference), rendered by a narrow public route `/p/[slug]` only when published and the flag is on.
    The agent drafts only; publishing is a human action behind `withStaff`. The page form posts to the
    existing intake endpoint.
13. **English only.** Default task assignee: the superadmin who ran the agent. Aggregate campaign
    metrics are not readable by the agent in this version.
14. **UI** from existing Hub components and tokens: a first wizard step ("Describe what you want to
    accomplish"), a review screen of what it will draft, then the result with the task list; plus a
    side panel from the Campaigns hub and from a campaign. Drafts show "AI draft, needs review" until
    a person edits or approves each item. Tasks live on the campaign and in the existing task area if
    one exists.

---

## 2. What the repo and the live database hold (measured 2026-10-01)

| Fact | Measured how | Consequence |
|---|---|---|
| hub_212 merged to `main` (`69b92af`), applied live (ledger `20261001114831`) | `git log`, ledger | precondition of the prompt met |
| `agent_sessions`, `agent_runs`, `agent_usage`, `page_definitions`, `campaign_tasks`, `help_gaps` | `pg_class`, none exist | free names |
| Hub max migration **hub_212**; platform max in the ledger **pf_207** (pf_200 to pf_207 sit in the 200 band) | ledger | next Hub file is **`hub_213_campaign_builder_agent.sql`** |
| Existing task tables: `kanban_tasks` (342 rows, `column_id` NOT NULL, so tied to a board column) and `tasks` (7 rows, `contact_id` nullable, `source`, `source_id`, `assigned_to uuid`) | `pg_attribute`, count | see AG5 |
| Validators are **inline in the routes**: campaigns (status, org ownership of every id, entry stage in entry pipeline), sequences (channel, subject, SMS length, asset in org, at most 30 steps), routes (source key shape), forms (slug, `definitionProblems` on publish) | read | extract to shared modules (AG3) |
| The routes write **one row at a time**; the sequences route can answer "Earlier steps were saved" | read | the agent cannot use the routes for a build; ruling 7 needs a function (AG4) |
| Flags: `org_settings` key `hub_marketing_flags`, `FLAG_KEYS` in `src/lib/marketing/flags.ts`, only `'on'` turns one on | read | `agent_enabled` and `pages` join that list (AG1, AG14) |
| Anthropic calls: 19 routes use `fetch` to the Messages API; `@anthropic-ai/sdk` ^0.80 is installed but the routes do not use it; models are hardcoded (`claude-sonnet-4-20250514` 19 times, `claude-sonnet-4-6` 9 times) | grep | the agent uses `fetch` with an injectable transport (AG6); model from config only |
| An older `/api/ai/help-bot` route exists with hardcoded platform knowledge | read | untouched by this build |
| `sequences.created_by` references `team_members(id)`, not the auth user id (marketing §12) | earlier pg_catalog | every FK the build writes into an existing table is enumerated at Stage 1 |

---

## 3. Assumptions (safer reading where the rulings are silent), dated 2026-10-01

- **AG1. The flag is `agent_enabled` in `hub_marketing_flags`**, parsed like every other flag (only
  the string `'on'`), set through the existing superadmin-only flags route. Missing row or read error
  means off.
- **AG2. "Superadmin" means `profiles.role = 'superadmin'`** (`ctx.isSuperadmin`), the same check the
  live-send switch uses, and the caller must also be active staff in the org (`withStaff`,
  `requireOrg`).
- **AG3. Shared validators** move to `src/lib/marketing/validate/` as pure functions over the input
  plus org-scoped reference sets read beforehand. The four routes call them and keep their exact
  responses; a before and after parity harness proves that (section 7).
- **AG4. Plan, then build.** The tool loop never writes drafts. Draft tools validate and append to an
  in-memory plan that is stored on the `agent_runs` row. The review screen shows that plan. "Build"
  calls `public.agent_build(run_id)` once, which re-checks org ownership of every referenced id and
  writes the campaign (status forced to `draft`, `live_enabled` forced false), its sequence and steps,
  routes, forms, pages and tasks in one transaction. A second call with the same run id returns the
  ids it created the first time. No model call happens at build time.
- **AG5. Tasks.** `campaign_tasks` is the record, shown on the campaign. Each task is also mirrored
  into `tasks` (the CRM Client Tasks area) with `source = 'hub_agent'`, `source_id = <campaign id>`,
  no contact, **only if** Stage 1 confirms that table's CHECKs and FKs accept it (including what
  `assigned_to` references). If they do not, tasks live on the campaign only and that is reported.
  `kanban_tasks` is not used: a task there needs a project board column.
- **AG6. The model is called with `fetch`**, like the existing routes, through a small client whose
  transport is injected, so the golden tests replay recorded tool calls with no network. Request
  timeout 60 seconds; on timeout or a 5xx the run ends `model_unavailable` with nothing built.
- **AG7. Cost** is computed from the returned `usage` and a price table keyed by model id in
  `src/lib/agent/pricing.ts`, filled from the current Claude API price list in Phase 1. A model id
  with no price refuses to run, because a cap that cannot be priced cannot be enforced.
- **AG8. Caps** live in `org_settings` key `hub_agent_policy`: `monthly_cap_usd` (default 25),
  `session_messages` (default 40), `run_tool_calls` (default 12). Before each model call the server
  reserves the worst case for that call (max output tokens at the output price plus the input) in
  `agent_usage` for the org and calendar month (UTC), and settles to the real cost afterwards, in one
  statement each, so two concurrent runs cannot both slip under the cap.
- **AG9. Rate limit:** at most 10 runs per user per 10 minutes, counted from `agent_runs`, so it holds
  across serverless instances.
- **AG10. Read tools select named columns only** from an allowlist, never `*`, and never touch
  `contacts`, `consent_events`, `suppressions`, `message_sends`, `send_log`, `campaign_enrollments`,
  `form_submissions` or `campaign_test_contacts`. Existing sequence and form text the model may
  revise is passed as untrusted data (ruling 6); it is staff-written copy, not contact data.
- **AG11. Untrusted text** is wrapped in `<untrusted_input source="...">` blocks, and the system
  prompt says anything inside them is data to read, never an instruction.
- **AG12. "Live"** means a campaign whose status is `active` or `paused` or whose `live_enabled` is
  true, a published form, or a published page. Edit requests on a live item produce a draft copy and a
  task, never an in-place change.
- **AG13. Agent routes are created active on a draft campaign.** `public.enroll` only enrolls into
  active campaigns (marketing A27), so a draft's route enrolls nobody. The contract test asserts that.
  A person activating the campaign is then the one action that makes it run.
- **AG14. Pages get their own flag, `pages`, default off.** The public `/p/[slug]` route should not
  depend on whether the agent is on. Adding `/p/` to middleware's public paths is a prefix rule like
  `/a/`, which ruling 7 of the marketing build limited to exact paths; it is listed as a decision.
- **AG15. "AI draft, needs review"** is two additive nullable columns, `ai_run_id` and
  `ai_reviewed_at`, on `funnel_campaigns`, `sequence_steps`, `form_definitions` and
  `page_definitions`. The chip shows while `ai_run_id` is set and `ai_reviewed_at` is null. A save
  through the existing screen or an explicit Approve sets `ai_reviewed_at`.
- **AG16. Task assignee** is the runner's `team_members.id` in that org, resolved by membership
  (`src/lib/marketing/team-member.ts`), or null when there is none.
- **AG17. Claims check thresholds:** text messages at most 320 characters including the opt out line
  and a 60 character merge allowance; subjects at most 70 characters. Stricter than the route limits
  on purpose; they decide "needs review", not whether a save is allowed. Editable in the guide and
  `src/lib/agent/claims.ts` together.
- **AG18. Model output is English.** The system prompt says so; no language detection is built.

---

## 4. Migration bundle outline (`hub_213_campaign_builder_agent.sql`, one file, one apply)

Rollback block written first, in the file. One bundle covers all phases, so there is one Stage 1 stop.

| Table | Purpose |
|---|---|
| `agent_sessions` | org, user, opened_at, message_count, mode (`wizard`, `panel`), campaign context id |
| `agent_runs` | session, org, user, prompt, guide_version, model_id, plan jsonb, tool_calls jsonb (name, input summary, result summary), input and output tokens, cost_usd, outcome (`planned`, `built`, `refused`, `cap_hit`, `model_unavailable`, `failed`), created_ids jsonb, built_at |
| `agent_usage` | org, month, reserved_usd, spent_usd; unique (org, month) |
| `campaign_tasks` | org, campaign, run, title, detail, kind (`copy_review`, `attach_file`, `connect_source`, `sender_or_dns`, `consent`, `sms_registration`, `other`), status, assignee team_members id, created_by |
| `page_definitions` | org, slug, title, status (`draft`, `published`, `archived`), blocks jsonb, form_definition_id, published_at, published_by, version, `ai_run_id`, `ai_reviewed_at` |

Additive columns: `ai_run_id uuid null`, `ai_reviewed_at timestamptz null` on `funnel_campaigns`,
`sequence_steps`, `form_definitions`.

Functions (security definer, `set search_path = ''`, `revoke execute from public`, `service_role`
only): `agent_build(run_id uuid)`, `agent_reserve(org, month, amount)`,
`agent_settle(org, month, reserved, actual)`.

RLS on every new table; staff read their org through `hub_team_org_ids()`; no browser writes; no
`anon` grants. The contract test (`scripts/agent/contract-213.sql`) runs on a Supabase branch with the
211 and 212 bootstraps, and the bootstrap copies every FK of every copied table (the lesson of
marketing §12).

---

## 5. Files

| Area | Files |
|---|---|
| Phase 0 (done) | `docs/marketing/voice-and-claims-guide.md`, `src/lib/agent/claims.ts`, `scripts/agent/claims-tamper.cjs`, this file |
| Shared validators | `src/lib/marketing/validate/{campaign,sequence,route,form,page}.ts`; the four existing routes call them |
| Agent core | `src/lib/agent/{config,pricing,model,loop,prompt,untrusted,caps,log,plan}.ts` |
| Tools | `src/lib/agent/tools/read.ts` (pipelines, stages, sources and connection state, assets, forms, step types, guide), `src/lib/agent/tools/draft.ts` (campaign, steps, routes, forms, pages, tasks), `src/lib/agent/tools/index.ts` (the one tool list) |
| Readiness | `src/lib/agent/readiness.ts` (reuses `readiness()` from `ui-logic.ts`, adds asset, source, sender, consent and SMS registration checks) |
| Routes | `src/app/api/marketing/agent/route.ts` (plan, build, revise), `src/app/api/marketing/pages/route.ts` (staff save and publish), `src/app/p/[slug]/page.tsx` (public renderer) |
| UI | `src/components/marketing/agent/{describe-step,review-plan,result,side-panel,ai-chip}.tsx`, wired into `funnel-wizard.tsx`, `funnels-panel.tsx`, `funnel-detail.tsx` |
| Config | `.env.example` gains `AGENT_MODEL`; `ANTHROPIC_API_KEY` is already listed |
| Tests | `scripts/agent/*` (section 7) |

---

## 6. Ordered work

- **Phase 0 (this stop):** rulings, plan, guide, claims checker and harness. Commit.
- **Phase 1:** extract validators (with parity proof), agent core, read tools, draft tools for
  campaign, steps and routes, plan storage, `agent_build`, caps and logging, flag, route. **Stage 1
  stop:** fresh Supabase branch, bootstraps plus hub_211, hub_212 and hub_213, contract test with
  planted defects, exact SQL with rollback and results proposed; apply on go, read back.
- **Phase 2:** follow-up tasks and readiness (missing copy, no asset attached, source not connected,
  sender domain or consent items, SMS registration not confirmed), mirrored per AG5.
- **Phase 3:** standalone sequences, and revise by request ("make email 2 shorter") producing a new
  draft, never an in-place change to a live item.
- **Phase 4:** forms and landing pages: draft tools, `page_definitions` editor and publish, `/p/[slug]`.
- **UI** lands with the phase whose data it shows. **Stage end** as the prompt specifies.

---

## 7. Tests (prompt items a to j)

| Item | Harness | What it proves |
|---|---|---|
| a | `scripts/agent/golden-goals.cjs` | 5 fixed goals replayed through the real loop with a stub transport; asserts campaign, route, steps and tasks produced. Plus `scripts/agent/live-smoke.cjs` (REQUIRES_LIVE, not in CI): one tiny goal against the real API, reports cost |
| b | `scripts/agent/adversarial-tamper.cjs` | send, go live, change consent, read contacts, edit a live campaign, obey pasted instructions: each ends with nothing built and a refusal or task; and the tool list contains no tool able to do any of these |
| c | `scripts/agent/contract-tamper.cjs` | every tool's JSON schema accepts exactly what its shared validator accepts, over a fixture matrix; engine drift fails CI |
| d | `scripts/agent/contract-213.sql` (branch) | killed mid build, nothing persists; same run id replayed, same ids and no new rows; a draft campaign's route enrolls nobody |
| e | `scripts/agent/caps-tamper.cjs` | step limit, monthly cap (with reservation) and per-session limit each stop the run with the right message |
| f | `scripts/agent/leak-tamper.cjs` | each read tool run against a stub database returning every contact column with fixture values; output holds only allowlisted keys and none of the fixture values; no read tool names a contact-bearing table |
| g | `scripts/agent/claims-tamper.cjs` | **built in Phase 0**, 18 cases, 6 selectors, union 8 |
| h | every harness | run against the tree before the merge (HEAD~1): each must fail |
| i | `npm run verify` | existing guards and harnesses green, `tsc` clean; `scripts/agent/flag-off-parity.cjs` compares main and branch for the funnel, sequence and intake paths with `agent_enabled` absent |
| j | browser | wizard step and side panel end to end with the stub model, flag on, locally against the branch |

Every new pure harness uses the SET convention and joins `scripts/verify.cjs`.

---

## 8. Costs and risks stated

- Model spend is real once the flag is on; the cap is the control, and it fails closed (AG7, AG8).
- One Supabase branch for Stage 1, billed hourly, deleted after the apply.
- Extracting validators touches four live routes; the parity harness is the guard.
- `/p/[slug]` is a new public route and a middleware change (an auth change, listed for review).
- Mirroring tasks into `tasks` writes into an existing table read by the CRM; gated on Stage 1 (AG5).

---

## 9. Decisions that are Cameron's (each with a recommendation)

1. **`/p/` as a public prefix in middleware.** Recommend yes, mirroring `/a/`, behind its own `pages`
   flag (AG14).
2. **Tasks mirrored into `tasks` (Client Tasks)** as well as on the campaign. Recommend yes if Stage 1
   finds the constraints accept it (AG5).
3. **Routes on draft campaigns created active** (AG13). Recommend yes; a draft enrolls nobody.

---

## 10. Phase 0 results (2026-10-01)

- `scripts/agent/claims-tamper.cjs`: untampered 18 of 18; `emdash` {E1,E2}, `certified` {B2,G2},
  `noboundary` {B4}, `stopline` {L2}, `program` {P1}, `version` {G1}; `TAMPER=1` reddens the union of
  8, equal to the sum of the individual runs. Case B4 is the false positive control: realistic clean
  copy with near misses ("healthy", "secure", "retreat", "fixed time") raises nothing. G1 to G3 keep
  the guide and the checker in step.
- `npm run verify`: passed, including `tsc --noEmit`, the five guards and every existing harness.

## 11. Not in this plan

**The Hub Guide addendum (rulings 15 to 24, Cameron, 2026-10-01)** was handed to this session before
the prompt was run. It was not folded in, because the instruction was to run the prompt exactly. It
shares the route, tables, caps and panel with this build and would change the hub_213 bundle (a
`mode` column, cited article ids, `help_gaps`). Folding it in before the Stage 1 bundle is written is
far cheaper than after.
