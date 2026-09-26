# Findings — revenue dashboard specs vs. the codebase

> **Provenance, added 2026-09-26 when this file was first committed.** Written 2026-08-14 on
> `feature/revenue-dashboard`. It audits the code only: the three specs it was meant to check
> (`npu_stripe_revenue_spec.md`, `claude_code_brief_revenue_dashboard.md`,
> `np_monthly_revenue_panel.md`) were absent when it ran, as the note below records. It has not
> been re-verified since 2026-08-14; the code, schema and row counts it cites are as of that date.

Audited 2026-08-14 against `NPU-hub-v2@feature/revenue-dashboard` (1d23165),
`npu-platform-v2@7452d05`, and live Supabase `htfrfaxlcuyawtlztxxm`.

> **The three specs under `docs/revenue/` were not present when this audit ran.** The directory is
> empty and untracked; nothing matching `npu_stripe_revenue_spec.md`,
> `claude_code_brief_revenue_dashboard.md` or `np_monthly_revenue_panel.md` exists anywhere under
> `C:\Users\Camer`, and `git log --all -- "docs/revenue/*"` returns nothing on any branch. Their prose
> could not be checked line by line. Everything below is derived from the code and the live schema,
> and is strong enough to bear on the specs regardless of their exact wording.

**Method:** repo greps across `NPU-hub-v2`, `npu-platform-v2` and `neuroreport-app`, plus read-only
`SELECT`s against Supabase (`pg_policies`, `information_schema.columns`, `pg_constraint`,
`pg_trigger`, `pg_matviews`, row counts). No writes, no migrations, no code changes.

---

## 0. The finding that outranks the other eight

**The Stripe webhook's revenue writes cannot succeed. Every `payments` and `revenue_records` insert
it attempts violates a live constraint, and the errors are never checked.**

`npu-platform-v2/src/app/api/stripe/webhook/route.ts:228` inserts into `payments`:

| Live constraint | Webhook writes | Result |
|---|---|---|
| `organization_id uuid NOT NULL` → `organizations(id)` | column omitted entirely | NOT NULL violation |
| `payments_status_check`: `succeeded\|pending\|failed\|refunded\|disputed` | `'completed'` | CHECK violation |
| `payments_payment_type_check`: `course_enrollment\|equipment_deposit\|equipment_refund\|subscription\|refund\|dispute\|other` | `'one_time'` / `'installment'` | CHECK violation |
| `stripe_payment_id text UNIQUE NOT NULL` | `''` when both `payment_intent` and `subscription` are null | duplicate key on the 2nd such event |

`route.ts:241` inserts into `revenue_records`, whose live columns `organization_id`, `cohort_id` and
`participant_id` are **all NOT NULL**. The insert omits `organization_id` outright and passes
`cohort_id: targetCohortId`, which is `null` for any non-cohort paywall.

Both failures repeat in the `invoice.paid` handler (`route.ts:433` and `:445`).

Neither call destructures `error`. The handler proceeds to log
`'[stripe-webhook] ✅ Onboarding complete'` and returns HTTP 200.

**Confirmed against the data.** All 4 live `payments` rows read:

```
status='succeeded'  payment_type='course_enrollment'  paid_at=NULL
organization_id='00000000-0000-0000-0000-000000000001'
```

Those are values this webhook's code cannot produce — it hardcodes `'completed'` and
`'one_time'|'installment'`. **No row in `payments` was written by the Stripe webhook.** The same
reasoning applies to `revenue_records`. The 4-row / 6-row state already verified is not a
duplication bug in a working pipeline; it is residue from something else, sitting next to a pipe that
has never delivered.

Any spec that treats `payments` or `revenue_records` as the Stripe revenue feed is specifying a
dashboard over a dead channel. That has to be fixed before the dashboard question is meaningful.

Adjacent, same root cause: `src/app/api/stripe/refund/route.ts` reads
`payment.stripe_payment_intent_id` and `payment.amount`, and writes `refund_amount`, `refund_reason`,
`refunded_at`, `updated_at` — **none of those columns exist** on live `payments`. It also gates on
`payment.status !== 'completed'`, a value the CHECK constraint forbids, so it returns 400
unconditionally. The route is entirely non-functional.

---

## 1. Who owns the Stripe webhook and checkout session creation

**Neither is in this repo.** `NPU-hub-v2` has no Stripe route handler at all. `src/app/api/webhooks/`
contains only `dispatch/route.ts` and `read-ai/route.ts`. Nothing under `src/` imports the `stripe`
package (see §7).

Both live in **npu-platform-v2**. Note the path: the git repo root is *nested one level down* at
`C:\Users\Camer\npu-platform-v2\npu-platform-v2-main\` (remote `github.com/Neuro316/npu-platform-v2`).
`C:\Users\Camer\npu-platform-v2-fresh\` is a stale partial copy containing only `checkout-session`,
and is not a git repo — don't edit it by mistake.

| Concern | Path (relative to `npu-platform-v2-main/`) | Lines |
|---|---|---|
| **Stripe webhook** | `src/app/api/stripe/webhook/route.ts` | 596 |
| **Checkout session creation (live)** | `src/app/api/stripe/create-checkout/route.ts` | 259 |
| Legacy checkout creation | `src/app/api/stripe/checkout/route.ts` (`@ts-nocheck`) | 66 |
| Session read-back on success page | `src/app/api/checkout-session/route.ts` | 21 |
| Refund | `src/app/api/stripe/refund/route.ts` (`@ts-nocheck`) | 42 |

The webhook handles `checkout.session.completed`, `invoice.paid` and
`customer.subscription.deleted`; it is signature-verified with `STRIPE_WEBHOOK_SECRET` and delegates
enrollment to `src/lib/onboarding-pipeline.ts`.

The legacy `stripe/checkout/route.ts` writes a *third, different* column set to `payments`
(`organization_id`, `user_id`, `amount`, `stripe_checkout_session_id`) — `user_id`, `amount` and
`stripe_checkout_session_id` do not exist on the live table. It is `@ts-nocheck`, so nothing catches
this at build time.

**Consequence for the specs:** a revenue dashboard in the Hub cannot fix the ingestion problem. Any
correction to how Stripe revenue is recorded is an **npu-platform-v2 change**, in a separate repo
with a separate deploy. A Hub-only PR cannot land it.

## 2. Where the revenue dashboard should live

**There are already two finance dashboards in the Hub**, both registered in
`src/lib/nav-config.ts:83-91` under the `FINANCE` group:

| Nav label | Route | File | Data family |
|---|---|---|---|
| AI CFO | `/finance` | `src/app/(dashboard)/finance/page.tsx` (2088 ln) | `fin_*` |
| NP Financial | `/financial/np` | `src/app/(dashboard)/financial/np/page.tsx` (740 ln) | `payments`, `payouts`, `expenses`, affiliates |

Plus `/ehr/accounting` (`src/app/(dashboard)/ehr/accounting/page.tsx`, 1808 ln) over the `acct_*`
family — **not** in `nav-config.ts`, reached through the EHR section.

**Recommendation: extend `/finance`.** It is the only one of the three that resolves org scoping
correctly, and it already owns the `fin_*` family the monthly panel is about.

### How org scoping resolves today

`WorkspaceContext` (`src/lib/workspace-context.tsx`) exposes `currentOrg`, persisted to
`localStorage` under `npu_hub_current_org`. Three different patterns consume it:

- **`/finance` — correct.** `currentOrg.id` → `?org_id=` query param → `/api/finance/*` route →
  `createAdminSupabase()` (service role) → `.eq('org_id', orgId)`. Server-side filter on a
  service-role client. See `src/app/api/finance/income/route.ts:20`.
- **`/ehr/accounting` — correct for reads.** Browser anon client; every `acct_*` query carries
  `.eq('org_id', orgId)` (page.tsx:1629-1635).
- **`/financial/np` — broken.** `page.tsx:88-92` queries `payments`, `enrollments`, `cohorts`,
  `profiles` and `payout_line_items` with **no org filter at all**:

  ```ts
  supabase.from('payments').select('*').eq('status', 'completed').order('paid_at', ...)
  ```

  `totalRevenue` (`page.tsx:105`) then sums `amount_cents` across every row returned. The only thing
  keeping this org-correct is `payments` RLS — the page uses the anon browser client, so
  `payments_select` restricts rows to the admin's `org_members` orgs. Correctness lives entirely in
  the policy, not in the query. Move this page behind a service-role API route and the isolation
  disappears silently.

  Secondary: it filters `status = 'completed'`, which the live CHECK constraint forbids, so this
  query **matches zero rows today** regardless of org.

Minor: nav items in `nav-config.ts` carry `moduleKey`, but `sidebar.tsx:79,81` gate on
`item.requireModule`, a property these items don't have. Module gating for the finance items is
inert; only `canView(moduleKey)` and `hiddenModules` (sidebar.tsx:178) apply.

## 3. Migration 205, and the numbering scheme

**205 is `supabase/migrations/205_acct_audit_log.sql`. It is not the `fin_*` family.**

It creates:

- table `public.acct_audit_log` (append-only; deliberately no FKs — the file documents why: an FK on
  `record_id` would be violated by the very DELETE this table exists to capture);
- 3 indexes (`org_id,changed_at desc` / `table_name,changed_at desc` / `record_id`);
- `public.fn_acct_audit()` — `SECURITY DEFINER`, `search_path` pinned to `public, pg_temp`;
- explicit `REVOKE ALL` from `public` / `anon` / `authenticated`, then `GRANT SELECT` to
  `authenticated` only — no INSERT/UPDATE/DELETE grant to any role, so rows can be neither forged nor
  altered through the API;
- RLS enabled plus one SELECT-only policy `acct_audit_log_read_org`, scoped via `team_profiles`;
- three `AFTER UPDATE OR DELETE` triggers on `acct_payments`, `acct_services`, `acct_clients`
  (deliberately not on INSERT).

**"Actor capture"** = the `actor_id` / `actor_email` / `actor_role` columns, populated by the trigger
function from `auth.uid()`, `current_setting('request.jwt.claims')->>'email'` and `auth.role()`. A
NULL `actor_id` is legitimate and interpretable: service-role API routes and direct SQL carry no user
JWT, which is why `actor_role` is stored alongside. Verified live: `acct_audit_log` exists, RLS on,
exactly 1 policy, `trg_acct_payments_audit` present.

**The `fin_*` family has no migration file in this repo at all.** `fin_income` / `fin_expenses` exist
live (with triggers — see §8) but were created out-of-band. Do not expect to find their DDL in the
tree.

### Numbering scheme — and why `115` in the spec is wrong

- Legacy Hub band: `067`–`082` (no `083` in the tree).
- Hub 200+ band: `202_crm_messages_recovered_at.sql`, `205_acct_audit_log.sql`. `203` is written but
  unapplied; `204` was cancelled (commit 6398208) and deliberately not reused.
- `npu-platform-v2` sequence: `001`–`008`.
- **Next free Hub number: `206`.**

`115` is wrong on two counts. It is below the 200 floor that `CLAUDE.md` mandates for Hub migrations,
and it sits inside the band the platform sequence grows into — the exact collision `CLAUDE.md`
records from 2026-07-24, where two `084_*` files both applied cleanly.

**And the collision will not error.** `supabase_migrations.schema_migrations` keys on a timestamp
`version`, not the filename prefix, so a duplicate number applies silently. Separately, 205 was
applied via `execute_sql` rather than `apply_migration` and therefore has **no ledger row by
design** — the file is the record. Don't infer "unapplied" from ledger absence in this repo.

## 4. `revenue_records` — every call site

**Zero call sites in `NPU-hub-v2`.** The only occurrence is prose: `docs/HUB_ROLE_DECOUPLING.md:177`.

All seven references are in `npu-platform-v2`:

| # | Location | Kind |
|---|---|---|
| 1 | `supabase/migrations/001_foundation_schema.sql:785` | `CREATE TABLE` |
| 2 | `supabase/migrations/001_foundation_schema.sql:960` | `LEFT JOIN` inside `CREATE MATERIALIZED VIEW icp_outcome_analysis` |
| 3 | `supabase/migrations/001_foundation_schema.sql:1233` | `ENABLE ROW LEVEL SECURITY` |
| 4 | `supabase/migrations/001_foundation_schema.sql:1458` | `CREATE POLICY revenue_select` |
| 5 | **`src/app/api/stripe/webhook/route.ts:241`** | `INSERT` (`checkout.session.completed`) |
| 6 | **`src/app/api/stripe/webhook/route.ts:445`** | `INSERT` (`invoice.paid`) |
| 7 | `src/app/dashboard/paywalls/page.tsx:1595` | UI string only — a pipeline-explainer label, no query |

Only **#5 and #6** are executable data access, and both are dead per §0.

**What this means for the spec's rename-plus-view plan:**

- A rename is a **cross-repo change**. Both writers are in npu-platform-v2. A Hub migration that
  renames the table breaks the platform's webhook the moment it applies, and the Hub PR cannot ship
  the corresponding platform fix.
- If the replacement view is meant to be written through, it needs an `INSTEAD OF INSERT` trigger or
  must qualify as auto-updatable. A view over a join or with aggregates is not insertable, and both
  webhook inserts would then start failing with a *different* error than they fail with today.
- `icp_outcome_analysis` (#2) is declared in the migration file but **does not exist in the live
  database** (`pg_matviews` → no match). `001_foundation_schema.sql` was not applied in full. Treat
  that file as an unreliable description of production; the live catalog is the source of truth.
- Live `revenue_records` carries a policy `revenue_records_update_admin` that appears in **no
  migration file in either repo** — further drift in the same direction.

## 5. RLS — `WITH CHECK` explicit vs. absent

Queried live from `pg_policies`. For a `FOR ALL` policy, an absent `WITH CHECK` means Postgres falls
back to the `USING` expression as the write check — absent is not the same as "no check", but it is
also not an explicit declaration.

| Table | RLS | Policy | Cmd | `USING` | `WITH CHECK` |
|---|---|---|---|---|---|
| `payments` | on | `payments_select` | SELECT | present | **absent** (N/A for SELECT) |
| `payments` | on | `payments_select_participant` | SELECT | present | **absent** (N/A for SELECT) |
| `payments` | on | `payments_update_admin` | UPDATE | present | **explicitly declared**, identical to `USING` |
| `revenue_records` | on | `revenue_select` | SELECT | present | **absent** (N/A for SELECT) |
| `revenue_records` | on | `revenue_records_update_admin` | UPDATE | present | **explicitly declared**, identical to `USING` |
| `acct_payments` | on | `acct_payments_auth` | **ALL** | `auth.uid() IS NOT NULL` | **absent** |
| `fin_income` | on | *(none — zero policies)* | — | — | — |
| `fin_expenses` | on | *(none — zero policies)* | — | — | — |

Three things the specs need to account for:

1. **`fin_income` and `fin_expenses` have RLS enabled and zero policies.** That is deny-all for
   `anon` and `authenticated`. They are reachable *only* through `service_role`, which bypasses RLS —
   which is exactly what `/api/finance/*` uses (`createAdminSupabase()`). The `WITH CHECK` question
   is moot: there are no policies to declare it on. **Any spec proposing a client-side query against
   `fin_income` will read zero rows**, with no error.

2. **`acct_payments` has no org predicate anywhere in its RLS.** The single policy is
   `FOR ALL ... USING (auth.uid() IS NOT NULL)` with no `WITH CHECK`, so the `USING` expression
   governs writes too. Net effect: **any authenticated user can SELECT, INSERT, UPDATE or DELETE any
   `acct_payments` row in any org.** Org isolation on the $128,166 of accounting data is enforced
   only by the client-side `.eq('org_id', orgId)` in the page component. This is the single largest
   security gap found.

3. **Neither `payments` nor `revenue_records` has an INSERT or DELETE policy.** Non-service-role
   writes are refused outright, independent of the constraint violations in §0.

## 6. Could Neuro Progeny revenue land in `acct_payments` under the Sensorium org_id?

**Yes — three distinct ways, and one of them is the current intended design.**

**(a) `org_id` is the workspace selector, not a derived value.** The only `acct_payments` INSERT in
either repo is `src/app/(dashboard)/ehr/accounting/page.tsx:1706`:

```ts
await supabase.from('acct_payments').insert({ org_id: orgId, service_id: sid, client_id: cid, ...pmt })
```

`orgId = currentOrg?.id` (page.tsx:1624) — the sidebar workspace selection, restored from
`localStorage`. It is not derived from the client, the service, or the clinic. Whichever org is
selected is stamped on the payment, and per §5 RLS does not constrain it. A user with Sensorium
selected while entering NP data writes NP revenue under `b9fd8b2e`, and the reverse.

**(b) NP revenue is *already* inside the Sensorium `acct_*` data, by design.** This is the finding
most likely to invalidate the specs. `acct_clinics.is_neuro_progeny` (page.tsx:10) flags NP clinics;
`isNPClient()` (page.tsx:1644) resolves client → location → clinic; NP clients get a **different
split formula** — `config.np_splits.qeeg_snw_pct`, default 23% (page.tsx:106-110, 272, 400, 1198,
1504). `addClient` even auto-creates a CRM contact in the NP pipeline when the clinic is flagged
(page.tsx:1657-1659).

So `acct_payments` under org `b9fd8b2e` is a **mixture of Sensorium and Neuro Progeny revenue**,
separated only by a boolean on the clinic two joins away. The verified fact "acct_* is 100% org
b9fd8b2e (Sensorium)" is true about the `org_id` column and misleading about the money. **Any spec
that treats `acct_*` as "Sensorium revenue" and `fin_*` as "Neuro Progeny revenue" is wrong, and a
dashboard built on that split will either double-count NP or attribute NP revenue to Sensorium.**

**(c) `NP_ORG_ID` means two different orgs in the same codebase.**

| File | Value |
|---|---|
| `NPU-hub-v2/src/app/(dashboard)/ehr/accounting/page.tsx:57` | `00000000-0000-0000-0000-000000000001` |
| `NPU-hub-v2/src/app/api/integrations/neuroreport/sync/route.ts:22` | `00000000-0000-0000-0000-000000000001` |
| `npu-platform-v2/src/lib/onboarding-pipeline.ts:31` | `process.env.NP_ORG_ID \|\| 'b9fd8b2e-ded6-468b-ab1e-10b50ca40629'` |

The third one's fallback **is the Sensorium org id, under the name `NP_ORG_ID`**. The platform's
Stripe webhook imports it and uses it for `identity_graph` (`route.ts:521,549`),
`unified_funnel_events` (`:577`) and the churn `contacts` update (`:495`). If `NP_ORG_ID` is unset in
the platform's Vercel environment, every NP enrollment's attribution is written under Sensorium.
Worth checking the deployed env var before anything else — this one is a live data-integrity
question, not a code-shape question.

**(d) Same file, adjacent:** `deleteClient` (page.tsx:1734) runs
`.from('acct_payments').delete().eq('client_id', clientId)` with **no `org_id` filter**. Combined
with the permissive RLS in §5, a `client_id` match deletes across orgs. It does now at least leave an
audit trail, via the 205 triggers.

## 7. Stripe SDK and charting library

| | NPU-hub-v2 | npu-platform-v2 |
|---|---|---|
| `stripe` | `^17.5.0` — **declared, never imported** | `^20.3.1` — in use |
| `recharts` | `^2.13.0` — **declared, never imported** | `^3.8.1` |
| pinned API version | — | `'2026-01-28.clover'` |

Both dependencies are three and two majors apart respectively, and both are dead weight in the Hub:

- Nothing under `NPU-hub-v2/src/` does `import ... from 'stripe'`.
- Nothing under `NPU-hub-v2/src/` imports `recharts`, `chart.js`, `d3`, `victory` or `nivo`. **There
  is no charting library actually in use in the Hub.** If a spec assumes Recharts is established
  here, it is assuming a `package.json` line, not a practice. Adding the first real chart is a new
  pattern decision (and `recharts` 2 → 3 is a breaking major if you want parity with the platform).
- `src/lib/stripe-auto-tagger.ts` exists in **both** repos and is dead in both: the only reference to
  `applyStripeAutoTags` anywhere is inside its own JSDoc example at line 249. Its header claims
  "Called from the Stripe webhook after checkout.session.completed" — the webhook does not import it.

Per `CLAUDE.md`, adding any npm package needs approval.

## 8. `fin_income` — importer, manual entry, and `np_payment_id`

**Manual entry: yes.** `/finance` → `src/app/api/finance/income/route.ts`, full CRUD
(GET/POST/PUT/DELETE), service-role, org-filtered. `company` is derived server-side from the org slug
(`resolveCompany`, `:7-11`).

**Importer: no — but the UI already calls one that doesn't exist.**
`src/app/(dashboard)/finance/page.tsx:278` POSTs to `/api/finance/np-sync`, and `:986` documents its
payload as `{ org_id, month? }`. **The route does not exist.** `src/app/api/finance/np-sync/` is
absent; `src/app/api/finance/` contains only `ai`, `clients`, `expenses`, `income`, `products`,
`settings`. The "Sync from NP Platform" button 404s.

**`np_payment_id`:** `text`, nullable, no default, **no foreign key**. It is populated only if a
caller passes it in the POST body (`route.ts:30` destructure, `:47` insert). Nothing in either repo
ever does.

Live data confirms all of it:

```
fin_income: 2 rows | source: 'manual' only | np_platform rows: 0 | np_payment_id non-null: 0
```

The route already carries guards refusing edit (`:62`) and delete (`:79`) of `source='np_platform'`
rows — protecting a class of row that has never existed. The `np_platform` source is a
designed-but-unbuilt path, and `np_payment_id` is the join key it was meant to use. **If a spec
describes the NP-platform sync as existing, it is describing an intention.**

One thing that *does* work and shouldn't be re-specified: `period_month` is set automatically by
trigger `fin_income_period` → `fin_set_period_month()` (`BEFORE INSERT OR UPDATE`), even though the
POST body never sets it. `fin_expenses` has the matching `fin_expenses_period`. Both also have
`*_updated_at` triggers. No application code needs to compute the period.

---

## Summary of what the specs will need to change

1. **`payments` / `revenue_records` are not a working Stripe feed** — every webhook write to them
   violates a live constraint and fails silently. Fix ingestion before specifying a dashboard on it.
   That fix is an **npu-platform-v2** change.
2. **`acct_*` is not "Sensorium revenue"** — it contains Neuro Progeny revenue on a separate split
   formula, flagged by `acct_clinics.is_neuro_progeny`. The clean org split the specs assume is not
   real.
3. **Migration `115` is wrong** — use `206`. It is below the 200 floor, inside the platform's growth
   band, and a collision would apply silently rather than error.
4. **Renaming `revenue_records` is a cross-repo change**, and if the replacement is a non-updatable
   view it changes how the two webhook inserts fail rather than fixing them.
5. **`fin_income` / `fin_expenses` have zero RLS policies** — service-role access only. Client-side
   queries return empty, silently.
6. **`acct_payments` RLS has no org predicate at all** — any authenticated user can write any org's
   rows.
7. **No charting library is actually in use in the Hub**, and the `np-sync` importer the UI calls does
   not exist.

## Open items

- **The three spec documents themselves.** If they exist elsewhere (another machine, a Claude chat,
  Drive), the line-by-line pass against their prose is still outstanding.
- **`NP_ORG_ID` in the platform's Vercel environment.** Whether it is set decides if §6(c) is a
  latent bug or live data corruption. Not readable from here.
