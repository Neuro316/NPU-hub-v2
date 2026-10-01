# Hub Campaign Builder Agent and Hub Guide: rulings and plan

**Branch:** `feat/campaign-builder-agent` (NPU-hub-v2 only), cut from `main` at `d49d00e`
**Status:** Stage 0 APPROVED 2026-10-01 with three answers and the Guide addendum (section 1a).
Phase 0 committed (`c6bebec`, `df21a12`). Next: the Stage 1 migration stop.
**Written:** 2026-10-01
**Queue ref:** this file is the record for the Hub (the Hub has no Addendum C). At stage end a one
line pointer goes into `docs/NPU_Future_Features_Queue_v4.md` addenda and an entry into `CURRENT.md`.
**Prompt:** `docs/plans/hub-agent-build-prompt.md` (updated 2026-10-01 with rulings 15 to 24,
Phase 1.5, test group k and review pack item 8).
**Parallel work:** a click-to-call session works in the separate worktree `NPU-hub-v2-call`
(`feat/click-to-call`). This build takes `hub_213`; that session takes the next free number after it.

---

## 0. Standing rules carried from the marketing build

Rulings 2, 4 and 13 to 18 of `docs/plans/hub-marketing-build-rulings.md` apply unchanged: additive
migrations in the 200+ band after taking the max of both repos, a single write door through Postgres
functions, `withStaff` on every service-role route, every env var in `.env.example`, no em dashes in
anything written, RLS with explicit `WITH CHECK`, `pg_catalog` not `information_schema`, never
`supabase db push`, branch test before live, and live writes only on Cameron's approval of the exact
SQL.

## 1. Rulings (Cameron, 2026-10-01, filed, not relitigated)

### Builder

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

### Hub Guide

15. **A second mode (guide or builder) of the same side panel and route**, not a separate system. It
    answers "how do I use or do X" and walks the person through the tools. **Guide mode is read only**:
    no draft tools, nothing it can change. Asked to build or change something, it explains how, then
    offers a hand-off to builder mode. **The hand-off rechecks superadmin on the server**; hiding the
    button is not enough.
16. **Help corpus** in `docs/help/*.md`, one article per task or screen, each with an id, the route it
    applies to, a short summary, numbered steps, common mistakes and related ids. The first full set,
    from the real screens and the prototype: Campaigns hub and funnels, funnel wizard, sequences and
    steps, forms, University asset delivery, pipelines and stages, contact drawer (timeline, consent,
    campaigns), consent and unsubscribe, Campaign Sending settings (sender, quiet hours, frequency
    cap), dry run versus live and the test contact allowlist, how to test a funnel end to end, reading
    the send log, and the Guide itself. Follows the voice and claims guide. Cameron reviews after.
17. **Grounded answers only.** It answers from retrieved articles and cites their ids. Retrieval is a
    plain keyword and tag search over the corpus, server side, as a read tool; no vector database. If
    no article fits it says so plainly, gives its best general pointer labelled as not from the help
    set, and logs the question to `help_gaps` (question text only, no contact data, user id,
    timestamp, route).
18. **Walkthroughs are structured.** A validated list of steps, each with an article id, a plain
    sentence, an optional route and an optional help target id. Key controls on the screens in scope
    get `data-help-id` attributes. A step whose route or target is missing from a registry (generated
    from nav-config and the `data-help-id` attributes) is rejected and retried, never shown. The panel
    shows a stepper with "Take me there" (navigates) and "Show me" (highlights the control). It never
    clicks, types or submits for the person.
19. **Context without data.** The panel sends only the current route and the screen's help id. No
    page contents, contact names, form values or message text, ever. The same contact-data leak test
    as the builder.
20. **Access:** a separate flag `help_bot_enabled`, default off. Role setting default superadmin only;
    widening to all staff is one setting, not a code change. Same `withStaff`, org derivation and
    per-user rate limit as the builder.
21. **Cost:** a separate monthly cap for Guide (default USD 10) and a separate model setting
    `AGENT_HELP_MODEL`, default `claude-haiku-4-5-20251001`. The builder keeps `AGENT_MODEL`. Both in
    `.env.example`. Answers are short, token capped, and use prompt caching for the corpus where the
    API allows it.
22. **Logging** reuses `agent_sessions` and `agent_runs` with a `mode` column and the cited article
    ids. `help_gaps` goes in the same single migration bundle.
23. **Keeping help true:** CI fails the build if (a) a screen in the registry within scope has no help
    article and is not on an explicit exempt list (seeded in this build with the out-of-scope
    screens), (b) an article references a route or help id that does not exist, (c) an article holds an
    em dash or a banned claim phrase. Each with the HEAD~1 discrimination check.
24. **Phase 1.5**, right after the agent core, because it shares the route, tables, caps and panel.
    The articles are written before the UI so the corpus drives the screens.

## 1a. Stage 0 approval answers (Cameron, 2026-10-01)

1. **`/p/` prefix: yes**, behind its own `pages` switch (AG14).
2. **Follow-up tasks are copied into Client Tasks: yes, one way**, labelled as from the Campaign
   Builder with a link to the campaign, attached to no contact, assigned to the superadmin who ran the
   agent. **Creating one notifies no one except the assignee, proven by a test** (AG5, AG20, AG21).
3. **Entry routes are created INACTIVE.** When a person activates the campaign through the existing
   activation action, the campaign's agent-created routes switch on in the same transaction (reusing
   the existing action if it already does this). Contract tests: a draft campaign with inactive
   routes raises no entry events and enrolls nobody; activation turns the routes on atomically (AG13,
   AG19).
4. **The Guide addendum is included**, as rulings 15 to 24 and Phase 1.5, folded into the single
   Stage 1 migration, number `hub_213`.

---

## 2. What the repo and the live database hold (measured 2026-10-01)

| Fact | Measured how | Consequence |
|---|---|---|
| hub_212 merged to `main` (`69b92af`), applied live (ledger `20261001114831`) | `git log`, ledger | precondition of the prompt met |
| `agent_sessions`, `agent_runs`, `agent_usage`, `page_definitions`, `campaign_tasks`, `help_gaps` | `pg_class`, none exist | free names |
| Hub max migration **hub_212**; platform max in the ledger **pf_207** (pf_200 to pf_207 sit in the 200 band) | ledger | this build's file is **`hub_213_campaign_builder_agent.sql`** (re-checked immediately before writing) |
| Existing task tables: `kanban_tasks` (342 rows, `column_id` NOT NULL, a board column) and `tasks` (7 rows, all `source = 'manual'`), read by the Client Tasks screen (`/api/tasks`, `crm-client.ts`) | `pg_attribute`, count, grep | Client Tasks is `tasks` (AG5) |
| `tasks`: `assigned_to` references `team_members(id)`; `status` in todo, in_progress, done, cancelled; `priority` in low, medium, high, urgent; `contact_id` nullable; `created_by` has no FK; one policy `tasks_org_policy` on `user_org_ids()` | `pg_constraint`, `pg_policy` | the copy uses the runner's `team_members.id` (AG16) |
| **Inserting into `tasks` fires two triggers.** `trg_task_timeline` writes a `contact_timeline` row only when `contact_id` is set. **`trg_sync_task_to_kanban` copies every new Client Task onto the org's Project Board** (`kanban_tasks`, first "To Do" column, unassigned), unless the transaction-local setting `app.is_syncing` is `'true'` | `pg_trigger`, `pg_get_functiondef` | AG21 |
| **The existing activation action does not touch routes.** A campaign is activated by `POST /api/marketing/campaigns` with `status: 'active'` (the wizard's "Save, set Active and test drive", `funnel-wizard.tsx:75`); that route updates `funnel_campaigns` only. No trigger exists on `funnel_campaigns` or `campaign_routes` | read, `pg_trigger` | AG19: a trigger makes the existing action switch agent routes on, in the same statement |
| `campaign_routes` columns: id, org_id, source_key, campaign_id, active, priority, created_at | `pg_attribute` | additive columns for AG19 |
| Validators are **inline in the routes**: campaigns (status, org ownership of every id, entry stage in entry pipeline), sequences (channel, subject, SMS length, asset in org, at most 30 steps), routes (source key shape), forms (slug, `definitionProblems` on publish) | read | extracted to shared modules (AG3) |
| The routes write **one row at a time**; the sequences route can answer "Earlier steps were saved" | read | the agent builds through one function instead (AG4) |
| Flags: `org_settings` key `hub_marketing_flags`, `FLAG_KEYS` in `src/lib/marketing/flags.ts`, only `'on'` turns one on | read | `agent_enabled`, `help_bot_enabled` and `pages` join that list |
| Anthropic calls: 19 routes use `fetch` to the Messages API; `@anthropic-ai/sdk` ^0.80 is installed and unused by them; models hardcoded in those routes | grep | the agent uses `fetch` with an injectable transport (AG6); model ids from config only |
| `src/lib/nav-config.ts` lists the sidebar routes; CRM screens (`/crm/contacts`, `/crm/pipelines`, `/crm/settings`, ...) are route folders under `src/app/(dashboard)/crm`, reached through the CRM layout, not nav-config; no `data-help-id` exists yet; the Campaigns page has no deep link to one funnel | read, grep | AG24, and the campaign link of AG20 |
| An older `/api/ai/help-bot` route exists with hardcoded platform knowledge | read | untouched; the Guide is new and separate |

---

## 3. Assumptions (safer reading where the rulings are silent), dated 2026-10-01

- **AG1. The builder flag is `agent_enabled` in `hub_marketing_flags`**, parsed like every other flag
  (only the string `'on'`), set through the existing superadmin-only flags route. Missing row or read
  error means off.
- **AG2. "Superadmin" means `profiles.role = 'superadmin'`** (`ctx.isSuperadmin`), the same check the
  live-send switch uses, and the caller must also be active staff in the org (`withStaff`,
  `requireOrg`).
- **AG3. Shared validators** move to `src/lib/marketing/validate/` as pure functions over the input
  plus org-scoped reference sets read beforehand. The four routes call them and keep their exact
  responses; a before and after parity harness proves that.
- **AG4. Plan, then build.** The tool loop never writes drafts. Draft tools validate and append to an
  in-memory plan stored on the `agent_runs` row. The review screen shows that plan. "Build" calls
  `public.agent_build(run_id)` once, which re-checks org ownership of every referenced id and writes
  the campaign (status forced to `draft`, `live_enabled` forced false), its sequence and steps, its
  routes (inactive), forms, pages, campaign tasks and their Client Task copies in one transaction. A
  second call with the same run id returns the ids it created the first time. No model call happens at
  build time.
- **AG5. Tasks.** `campaign_tasks` is the record, shown on the campaign. Each is copied once into
  `tasks` (Client Tasks), and `campaign_tasks.client_task_id` keeps the copy's id. One way: nothing
  in either table is synced back. `kanban_tasks` is not written by the agent (AG21).
- **AG6. The model is called with `fetch`**, like the existing routes, through a small client whose
  transport is injected, so the golden tests replay recorded tool calls with no network. Request
  timeout 60 seconds; on timeout or a 5xx the run ends `model_unavailable` with nothing built.
- **AG7. Cost** is computed from the returned `usage` and a price table keyed by model id in
  `src/lib/agent/pricing.ts`, filled from the current Claude API price list in Phase 1. A model id
  with no price refuses to run, because a cap that cannot be priced cannot be enforced.
- **AG8. Caps** live in `org_settings` key `hub_agent_policy`: `monthly_cap_usd` (default 25),
  `help_monthly_cap_usd` (default 10), `session_messages` (default 40), `run_tool_calls` (default 12),
  `help_roles` (default `["superadmin"]`). Before each model call the server reserves the worst case
  for that call in `agent_usage` for the org, calendar month (UTC) and mode, and settles to the real
  cost afterwards, in one statement each, so concurrent runs cannot both slip under the cap.
- **AG9. Rate limit:** at most 10 runs per user per 10 minutes per mode, counted from `agent_runs`, so
  it holds across serverless instances.
- **AG10. Read tools select named columns only** from an allowlist, never `*`, and never touch
  `contacts`, `consent_events`, `suppressions`, `message_sends`, `send_log`, `campaign_enrollments`,
  `form_submissions`, `campaign_test_contacts`, `tasks` or `kanban_tasks`. Existing sequence and form
  text the model may revise is passed as untrusted data (ruling 6); it is staff-written copy.
- **AG11. Untrusted text** is wrapped in `<untrusted_input source="...">` blocks, and the system
  prompt says anything inside them is data to read, never an instruction.
- **AG12. "Live"** means a campaign whose status is `active` or `paused` or whose `live_enabled` is
  true, a published form, or a published page. Edit requests on a live item produce a draft copy and a
  task, never an in-place change.
- **AG13. Agent routes are created inactive** (answer 3), with `activate_with_campaign = true`.
  `raise_entry_event` and `route_and_enroll` only act on active routes, and `enroll` only on active
  campaigns, so a draft with inactive routes raises and enrolls nothing. Contract-tested.
- **AG14. Pages get their own flag, `pages`, default off.** `/p/` joins middleware's public paths as a
  prefix, like `/a/` (answer 1).
- **AG15. "AI draft, needs review"** is two additive nullable columns, `ai_run_id` and
  `ai_reviewed_at`, on `funnel_campaigns`, `sequence_steps`, `form_definitions` and
  `page_definitions`. The chip shows while `ai_run_id` is set and `ai_reviewed_at` is null. A save
  through the existing screen or an explicit Approve sets `ai_reviewed_at`.
- **AG16. Task assignee** is the runner's `team_members.id` in that org, resolved by membership
  (`src/lib/marketing/team-member.ts`, the FK lesson of marketing section 12), or null when there is
  none, which the result screen then says.
- **AG17. Claims check thresholds:** text messages at most 320 characters including the opt out line
  and a 60 character merge allowance; subjects at most 70 characters. They decide "needs review", not
  whether a save is allowed.
- **AG18. Model output is English.** The system prompt says so; no language detection is built.
- **AG19. Route activation is a trigger on `funnel_campaigns`** (answer 3; the existing action does not
  already do it, section 2). `AFTER UPDATE OF status`, when `status` becomes `active` from anything
  else, it sets `active = true` and clears `activate_with_campaign` on that campaign's routes that
  carry the flag. Because it runs inside the existing action's own UPDATE statement, the campaign and
  its routes switch together or not at all, and the route code is unchanged. **One shot:** clearing
  the flag means a route a person later switches off stays off through pause and resume. It acts only
  on rows created by the agent, so every existing campaign behaves exactly as before.
- **AG20. The Client Task copy:** `source = 'campaign_builder'`, `source_id = <campaign id>`, title
  prefixed "Campaign Builder: ", `status = 'todo'`, `priority = 'medium'`, `contact_id` null,
  `assigned_to` from AG16, `created_by` the runner, and a description ending with a link to the
  campaign, `/campaigns?tab=funnels&funnel=<id>`. That deep link is added to the Campaigns page in
  Phase 2 (it does not exist today).
- **AG21. Creating the copy notifies nobody.** The ruling allows the assignee and requires no one else;
  this build notifies nobody, and the assignee sees it in Client Tasks. In the database,
  `trg_task_timeline` does nothing for a task with no contact. `trg_sync_task_to_kanban` would add a
  card for every new Client Task to the team's Project Board; `agent_build` sets that trigger's own
  guard (`set_config('app.is_syncing','true', true)`, transaction local) around its insert and clears
  it after, because the answer was one copy into Client Tasks and a board card is a second, team-wide
  one. The application path calls no notifier (no Slack, SMS outbox or email). Proven by the contract
  test (no new `kanban_tasks`, `contact_timeline`, `hub_sms_outbox` or `notifications`-like rows) and
  by a pure check that the agent's code imports no notifier. Listed as a decision in case Cameron wants
  the board card.
- **AG22. Guide flag and roles.** `help_bot_enabled` joins `hub_marketing_flags`. Who may use the Guide
  is `hub_agent_policy.help_roles`, a list from `superadmin`, `admin`, `team_member`; default
  `["superadmin"]`. Widening to all staff is that one setting.
- **AG23. The Guide's cap** is a separate `agent_usage` row per org, month and mode `guide`, against
  `help_monthly_cap_usd`.
- **AG24. The registry** is generated by `scripts/agent/build-help-registry.cjs` into
  `src/lib/agent/help-registry.json` from three sources: nav-config hrefs, the route folders under
  `src/app/(dashboard)` (so `/crm/...` screens count), and every `data-help-id` attribute in `src`.
  CI regenerates it and fails when the committed file is stale, so the registry cannot drift from
  the code.
- **AG25. `help_gaps` holds** org, user, route, help id, the question and the time. Before storage,
  email addresses and phone numbers in the question are replaced by `[email]` and `[phone]`. Names
  cannot be detected reliably; that limit is stated rather than hidden. The question is also what the
  model received, so the same scrub runs before the model call.
- **AG26. Guide answers** end with a single `answer` tool call carrying `{ text, cited, steps,
  handoff }`. Cited ids must be ids the search tool returned in that run; steps are validated against
  the registry (ruling 18). An invalid answer is sent back with the reason, at most twice; after that
  the panel says it could not answer and a `help_gaps` row is written. `max_tokens` 600.
- **AG27. Prompt caching:** the Guide's fixed system prompt plus the article index (id, title, route,
  summary of every article) is sent as one cached block; full articles come from the search tool.
  The run logs the API's cache read and cache write token counts, so whether caching actually happened
  is measured, not assumed (a block below the model's minimum cacheable length is silently not cached).
- **AG28. Hand-off:** the Guide sets `handoff: true`; the panel shows "Build this with the Campaign
  Builder" only to a superadmin, and the route re-checks superadmin and `agent_enabled` on the
  builder call regardless of what the panel showed.

---

## 4. Migration bundle outline (`hub_213_campaign_builder_agent.sql`, one file, one apply)

Rollback block written first, in the file. One bundle covers all phases, so there is one Stage 1 stop.

| Table | Purpose |
|---|---|
| `agent_sessions` | org, user, **mode** (`builder`, `guide`), surface (`wizard`, `panel`), campaign context id, message_count, opened_at |
| `agent_runs` | session, org, user, **mode**, prompt, route and help id (guide), guide_version, model_id, plan jsonb, tool_calls jsonb (name, input summary, result summary), **cited_article_ids text[]**, input, output, cache read and cache write tokens, cost_usd, outcome (`planned`, `built`, `answered`, `no_answer`, `refused`, `cap_hit`, `model_unavailable`, `failed`), created_ids jsonb, built_at |
| `agent_usage` | org, month, **mode**, reserved_usd, spent_usd; unique (org, month, mode) |
| `campaign_tasks` | org, campaign, run, title, detail, kind (`copy_review`, `attach_file`, `connect_source`, `sender_or_dns`, `consent`, `sms_registration`, `other`), status, assignee team_members id, **client_task_id** (the `tasks` copy), created_by |
| `page_definitions` | org, slug, title, status (`draft`, `published`, `archived`), blocks jsonb, form_definition_id, published_at, published_by, version, `ai_run_id`, `ai_reviewed_at` |
| `help_gaps` | org, user, route, help_id, question (scrubbed, AG25), run id, created_at |

Additive columns: `ai_run_id uuid null`, `ai_reviewed_at timestamptz null` on `funnel_campaigns`,
`sequence_steps`, `form_definitions`; `ai_run_id uuid null` and
`activate_with_campaign boolean not null default false` on `campaign_routes`.

Trigger: `funnel_campaigns_activate_agent_routes` (AG19).

Functions (security definer, `set search_path = ''`, `revoke execute from public`, `service_role`
only): `agent_build(run_id uuid)`, `agent_reserve(org, month, mode, amount)`,
`agent_settle(org, month, mode, reserved, actual)`, and the trigger function.

RLS on every new table; staff read their org through `hub_team_org_ids()`; no browser writes; no
`anon` grants. The contract test `scripts/agent/contract-213.sql` runs on a fresh Supabase branch with
the 211 and 212 bootstraps plus a 213 bootstrap that copies `tasks`, `kanban_tasks`, `kanban_columns`,
`team_members`, `contact_timeline` and their triggers, and **every FK of every copied table** (the
lesson of marketing section 12).

---

## 5. Files

| Area | Files |
|---|---|
| Phase 0 (done) | `docs/marketing/voice-and-claims-guide.md`, `src/lib/agent/claims.ts`, `scripts/agent/claims-tamper.cjs`, this file |
| Migration | `supabase/migrations/hub_213_campaign_builder_agent.sql`, `supabase/branch-bootstrap/hub_213_dependencies.sql`, `scripts/agent/contract-213.sql` |
| Shared validators | `src/lib/marketing/validate/{campaign,sequence,route,form,page}.ts`; the four existing routes call them |
| Agent core | `src/lib/agent/{config,pricing,model,loop,prompt,untrusted,caps,log,plan}.ts` |
| Builder tools | `src/lib/agent/tools/read.ts`, `src/lib/agent/tools/draft.ts`, `src/lib/agent/tools/index.ts` (the one builder tool list) |
| Guide | `docs/help/*.md`, `docs/help/EXEMPT.md`, `src/lib/agent/help/{corpus,search,walkthrough,scrub}.ts`, `src/lib/agent/tools/guide.ts` (the one guide tool list: `search_help`, `answer`), `src/lib/agent/help-registry.json`, `scripts/agent/build-help-registry.cjs` |
| Readiness | `src/lib/agent/readiness.ts` (reuses `readiness()` from `ui-logic.ts`, adds asset, source, sender, consent and SMS registration checks) |
| Routes | `src/app/api/marketing/agent/route.ts` (builder plan, build, revise; guide ask), `src/app/api/marketing/pages/route.ts`, `src/app/p/[slug]/page.tsx` |
| UI | `src/components/marketing/agent/{describe-step,review-plan,result,side-panel,guide-stepper,ai-chip,help-highlight}.tsx`; `data-help-id` on the in-scope screens; wired into `funnel-wizard.tsx`, `funnels-panel.tsx`, `funnel-detail.tsx`, and the Campaigns page deep link |
| Config | `.env.example` gains `AGENT_MODEL` and `AGENT_HELP_MODEL`; `ANTHROPIC_API_KEY` is already listed |
| Tests | `scripts/agent/*` (section 7) |

---

## 6. Ordered work

- **Phase 0 (done):** rulings, plan, guide, claims checker and harness.
- **Phase 1:** migration first. **Stage 1 stop:** fresh Supabase branch, bootstraps plus hub_211,
  hub_212 and hub_213, contract test with planted defects, exact SQL with rollback and results
  proposed; apply on go, read back. Then validators (with parity proof), agent core, read tools,
  draft tools for campaign, steps and routes, plan storage, caps and logging, flag, route.
- **Phase 1.5 (Guide):** help corpus first, then the registry and `data-help-id` attributes, the
  search tool, walkthrough validation, guide mode in the route, `help_gaps`, flag, roles, cap, the
  stepper UI, and the three CI checks.
- **Phase 2:** follow-up tasks and Client Task copies, readiness (missing copy, no asset attached,
  source not connected, sender domain or consent items, SMS registration not confirmed), the funnel
  deep link.
- **Phase 3:** standalone sequences, and revise by request producing a new draft, never an in-place
  change to a live item.
- **Phase 4:** forms and landing pages: draft tools, `page_definitions` editor and publish, `/p/[slug]`.
- **UI** lands with the phase whose data it shows. **Stage end** as the prompt specifies.

---

## 7. Tests (prompt items a to k, plus the approval answers)

| Item | Harness | What it proves |
|---|---|---|
| a | `scripts/agent/golden-goals.cjs` | 5 fixed goals replayed through the real loop with a stub transport; campaign, inactive routes, steps and tasks produced. Plus `scripts/agent/live-smoke.cjs` (REQUIRES_LIVE, not in CI): one tiny goal against the real API, reports cost |
| b | `scripts/agent/adversarial-tamper.cjs` | send, go live, change consent, read contacts, edit a live campaign, obey pasted instructions: nothing built, a refusal or task; and no tool able to do any of these exists |
| c | `scripts/agent/contract-tamper.cjs` | every tool's JSON schema accepts exactly what its shared validator accepts; drift fails CI |
| d | `scripts/agent/contract-213.sql` (branch) | killed mid build, nothing persists; same run id replayed, same ids and no new rows |
| e | `scripts/agent/caps-tamper.cjs` | step limit, monthly cap with reservation, per-session limit, and the Guide's separate cap |
| f | `scripts/agent/leak-tamper.cjs` | read tools against a stub returning every contact column with fixture values: only allowlisted keys, none of the values, no contact-bearing table named |
| g | `scripts/agent/claims-tamper.cjs` | **built in Phase 0**, 19 cases, 6 selectors, union 8 |
| h | every harness | run against the tree before the merge (HEAD~1): each must fail |
| i | `npm run verify`, `scripts/agent/flag-off-parity.cjs` | guards and harnesses green, `tsc` clean; funnel, sequence and intake paths identical on main and branch with the flags absent |
| j | browser | builder wizard step and side panel end to end with the stub model, flag on, locally against the branch |
| k | `scripts/agent/guide-tamper.cjs`, `scripts/agent/help-ci.cjs` | golden questions cite the right article and their steps validate; an unanswerable question logs a `help_gaps` row and invents no steps; adversarial prompts end with nothing done; a fake route or help id is rejected; Show me highlights only an existing target; guide mode exposes no tool writing outside `agent_sessions`, `agent_runs`, `help_gaps`; a non-superadmin hand-off is refused server side; the panel's context holds only route and help id; and the three CI checks of ruling 23 |
| answer 2 | `contract-213.sql` + `scripts/agent/task-notify-tamper.cjs` | the Client Task copy exists with the label, link, no contact and the runner as assignee; no `kanban_tasks`, `contact_timeline`, `hub_sms_outbox` or other notification row appears; the agent's task code imports no notifier |
| answer 3 | `contract-213.sql` | a draft campaign with inactive agent routes raises no `entry_events` and enrolls nobody, even when its source fires; activating it through the same UPDATE the existing route issues turns exactly its flagged routes on; a forced failure in that statement leaves the campaign and routes both unchanged; pause and resume do not re-enable a route a person switched off |

Every new pure harness uses the SET convention and joins `scripts/verify.cjs`.

---

## 8. Costs and risks stated

- Model spend is real once a flag is on; the caps fail closed (AG7, AG8, AG23).
- One Supabase branch for Stage 1, billed hourly, deleted after the apply.
- Extracting validators touches four live routes; the parity harness is the guard.
- `/p/[slug]` is a new public route and a middleware change (an auth change, listed for review).
- The activation trigger is new code on `funnel_campaigns`; it acts only on agent-created routes.
- Writing into `tasks` uses another trigger's guard setting (AG21); if that trigger is ever rewritten,
  the contract test is what notices.

---

## 9. Decisions that are Cameron's

Answered 2026-10-01 (section 1a). Open:

1. **Project Board card for Campaign Builder tasks** (AG21). Recommend no, as built.

---

## 10. Phase 0 results (2026-10-01)

- `scripts/agent/claims-tamper.cjs`: untampered 19 of 19; `emdash` {E1,E2}, `certified` {B2,G2},
  `noboundary` {B4}, `stopline` {L2}, `program` {P1}, `version` {G1}; `TAMPER=1` reddens the union of
  8, equal to the sum of the individual runs. Case B4 is the false positive control: realistic clean
  copy with near misses ("healthy", "secure", "retreat", "fixed time") raises nothing. G1 to G4 keep
  the guide and the checker in step and keep em dashes out of both.
- `npm run verify`: passed, including `tsc --noEmit`, the five guards and every existing harness.
- Found while writing: the file tool turned the unicode escape for an em dash in `claims.ts` into the literal
  character. The line now builds the character with `String.fromCharCode`, and G4 fails if one returns.

---

## 11. Stage 1: rulings on the two findings, and branch results (2026-10-01)

### Cameron's rulings on the Stage 0 findings

1. **Skip the Project Board.** Agent tasks land in Client Tasks only (AG21 stands; section 9 item 1
   is closed).
2. **The route-activation trigger is acceptable if it fires only on draft to active, touches only
   routes carrying the AI-draft marker, and never re-enables a route someone switched off.** The
   file was changed to match: the trigger tests `old.status = 'draft'` (it previously also fired on
   paused to active) and `ai_run_id is not null`, and a second trigger,
   `campaign_routes_disarm_on_change`, clears `activate_with_campaign` whenever a route's on or off
   value changes, whoever changes it. A test case was added for each of the three conditions.

- **AG29. Draft, paused, active never activates agent routes.** Only the literal draft to active
  transition does. A campaign paused before its first activation keeps its armed routes off, and a
  person switches them on by hand. This is the ruling read literally; it is the safer direction.

### Branch `hub-agent-213` (ref `ambfcvyefxensyeyohvc`), fresh, 0 tables at start

Loaded with `apply_migration` in the ruled order, so the branch ledger holds exactly what ran. Each
stored statement hashed (sha256) equal to the local file with its final newline:

| file | sha256 |
|---|---|
| `branch-bootstrap/hub_211_dependencies.sql` | `2c4c0482...59fc` |
| `migrations/hub_211_marketing_engine.sql` | `e5a61a82...13e6` (the hash recorded for the live apply) |
| `branch-bootstrap/hub_212_dependencies.sql` | `7ee1f210...d605` |
| `migrations/hub_212_entry_events.sql` | `0630d111...fe56` (the revised file applied live) |
| `branch-bootstrap/hub_213_dependencies.sql` | `30c791dc...1b75` |
| `migrations/hub_213_campaign_builder_agent.sql` | `5557b95f...7092` |

`scripts/agent/contract-213.sql`: 32 cases. `none` green. Every planted defect reddened exactly its
declared set: `liveforce` {B_DRAFT_ONLY}, `activeroutes` {A_DRAFT_NO_EVENT, B_ROUTES_INACTIVE},
`noidem` {B_REPLAY_SAME}, `crossorg` {B_CROSS_ORG}, `noflag` {B_FLAG_OFF}, `kanban` {T_NO_BOARD_CARD},
`notrigger` {A_ACTIVATE_ON, A_ACTIVE_RAISES, A_MARKER_ONLY}, `anytransition`
{A_DRAFT_ONLY_TRANSITION}, `nomarker` {A_MARKER_ONLY}, `noclear` {A_SWITCHED_OFF_IN_DRAFT},
`swallow` {A_ATOMIC}, `nocap` {U_CAP_REFUSES}.

**A test defect the first run found, fixed before proposing.** `activeroutes` also reddened
`A_ATOMIC`. The migration was right; the assertion was not: it checked that routes were "off" after a
failed activation, where the property is "unchanged". Under that defect the routes were on before the
activation began. The case now compares route state before and after; the declaration was not
widened to fit the run. The second run is the one reported above.

**The controls that make the zeros mean something:** `A_ACTIVE_RAISES` (once the campaign is active,
the same source DOES raise an event, with the engine on throughout) for `A_DRAFT_NO_EVENT`;
`C_BOARD_TRIGGER_LIVE` (an ordinary Client Task DOES get a Project Board card on the branch) for
`T_NO_BOARD_CARD`; `R_IDENTITY` (`current_user = authenticated`, `auth.uid()` the fixture user) for
the RLS cases.

**pg_catalog posture:** 6 new tables, RLS on 6, `anon` 0 grants, `authenticated` SELECT on
`campaign_tasks` and `page_definitions` only, one staff-read policy each; `agent_runs`, `agent_sessions`,
`agent_usage` and `help_gaps` refuse `authenticated` with 42501 (probed). 5 functions, all security
definer, `search_path=""`, executable by `service_role` only. 2 triggers. 8 new columns, all nullable
or defaulted (`activate_with_campaign` defaults to false).

**Rollback, run once:** left 0 of the 6 tables, 0 of the 5 functions, 0 of the 2 triggers, 0 of the
8 columns, 0 ledger rows; the controls stayed: 6 of 6 kept tables, 4 of 4 kept functions, 2 of 2 kept
triggers.

**Live pre-flight (read only, 2026-10-01):** 0 collisions for the tables, functions, triggers and
columns (controls in the same query found 4 of 4 and 2 of 2 known objects); no ledger row for any 213;
live holds 4 `funnel_campaigns`, 1 `campaign_routes` row, no triggers on either table, no
`hub_agent_policy` row, and `agent_enabled` absent for Neuro Progeny (off).

**Finding, not fixed:** the platform's `pf_` sequence has reached `pf_212` inside the 200 band, so its
next file is likely `pf_213`, the same number as this file with a different prefix. The ledger keys on
timestamps and the names differ, so nothing collides; it is the ambiguity the band rule was meant to
prevent, and it is the platform's to resolve.
