# CURRENT

Running state of in-flight Hub work. Newest first.

---

## 2026-09-16 — Multi-line Conversations (branch `feat/multi-line-conversations`)

**Status: code written on the branch, NOT committed. Migrations 207 and 208 APPLIED
2026-09-16 via apply_migration (versions 20260916104713, 20260916104738).** Design:
`docs/HUB_Multi_Line_Conversations_Design.md`. Snapshot check for the Neuro Progeny TwiML:
`npm run check:twiml`.

Post-apply distribution: NP 15 × `+18284155050`, 1 × `+18289009821`, Sensorium 2 NULL.
208 changed the 1 NP `branding` row. The 9821 entry's nickname in `crm_twilio.numbers` was
renamed `Campaign` → `WNW Office` with a targeted `jsonb_set` (this is what the dropdown
shows). Still to do in the Twilio console after deploy: point the 9821 voice webhook at
`/api/twilio/inbound-call`, then set forward number, 15 s ring timeout and greeting text
under CRM Settings > Twilio > Line options.

Design D1 (is `+18289009821` in the NP Messaging Service sender pool?) is **closed as
self-correcting, no console dependency**: `sendOrgSms` sends a pinned From together with the
service SID and falls back to From-only on Twilio 21712. Keep as shipped.

### Follow-ups from multi-line

1. **`inbound-call` lacks Twilio signature validation** — security, next session.
   `inbound-sms` and `message-status` validate and reject before any write; the voice
   webhook does not.
2. **`call-status` attributes by "latest ringing row"** (`.in('status', ['ringing',
   'in-progress']).order(started_at).limit(1)`) rather than by CallSid. Two overlapping
   calls mis-attribute. It also matches `'in-progress'`, which the CHECK spells
   `'in_progress'`.
3. **`voice/answered` writes `status='answered'`**, which the live `call_logs` CHECK does
   not allow. Read 2026-09-16 via `pg_constraint`: `ringing, in_progress, completed, missed,
   voicemail, failed`. The update fails silently on every answered call. `ring-complete` now
   closes the row as `'completed'` from a live status, so answered calls no longer sit at
   `ringing`; the "who answered" mark still needs a valid status (or a column of its own).
4. **`sequences/process-step` and `sms/process-scheduled` are not line-aware.** Both use the
   global `sendSms` with the env Messaging Service, so the sender is whatever the pool picks.
   They should pin `from` to the NP line explicitly.

---

## 2026-09-03 — Accounting CRM enrol: fixed and deployed, repair held

**Status: shipped, and CONFIRMED WORKING by the operator (Ella, 2026-09-03).
Migration 206 is committed but deliberately NOT applied — it awaits approval.**

**Next work is in the platform repo, not here.**

| | |
|---|---|
| Deployed SHA | `970ca1365df90246c6c74fee6d466932b41908ce` |
| Alias | https://hub.neuroprogeny.com |
| Deployment | `dpl_5dBMySqZVbnrLwMpXnc3h33sehbu` · Ready |
| Commits | `06c89ed` routes · `970ca13` session hardening · `78aa95a` migration 206 (unapplied) |

### The bug

Adding a client in Accounting failed with:

```
CRM enroll failed: new row violates row-level security policy for table "contacts"
```

**Nobody's authority was wrong.** Phase 0 of `docs/HUB_ROLE_DECOUPLING.md` set
`ella@sensoriumneuro.com` to `team_profiles.role = 'super_admin'` in Sensorium on
2026-08-02. That grant exists and is correct. `contacts_org_rls` gates on
`get_my_role()`, which reads **`profiles.role`** — a platform-wide column that knows
nothing about a per-org Hub grant. Her `profiles.role` is `participant` and has been
since 2026-03-30 (`updated_at` still equals `created_at`; nothing demoted her).

Enrolment worked until 2026-07-28 only because a superadmin was doing the data entry.
`acct_audit_log` shows her taking over 2026-08-08. **The date points at a personnel
change, not a commit.**

> Note: §1 of `HUB_ROLE_DECOUPLING.md` lists her `profiles.role` as `admin`. That cell
> is wrong against the live database. There are also two Ella accounts —
> `ella@sensoriumneuro.com` (SNW `super_admin`, NP `team_member`) and
> `ella@neuroprogeny.com` (NP `admin`, SNW `team_member`) — the ambiguity §12.4 flagged.

### What shipped

Both accounting write paths now run server-side under the service role:

- `POST /api/accounting/clients` — create client, enrol NP contact
- `POST /api/accounting/payments` — record payment, first-payment stage move
- `src/lib/accounting-auth.ts` — the authorisation boundary

The service role bypasses RLS, so **the check in that file IS the boundary**:

1. Authenticate from the cookie session.
2. Resolve `location_id` → acting org (`acct_locations.org_id`). Opaque id in, org out.
3. Clinic must agree with the location's org, else refuse.
4. **Active `team_profiles` row in the acting org.**
5. Target org derived from `acct_clinics.is_neuro_progeny` — never from the body.
6. **Active `team_profiles` row in the target org**, checked *before* any write.

Any role (`super_admin | admin | team_member`), not admin-only: creating a client is
ordinary module work, and §12.4 held Ella at NP `team_member` on purpose. **No `org_id`
is ever read from the request body.** The 403s name which side and which org.

### Three defects, one pass

1. **The RLS refusal** — the reported one.
2. **`page.tsx:1651`** wrote `enrolled_contact_id` with no `.select()` and no error
   check. A zero-row UPDATE returns no error, so links were lost silently. The line is
   gone; the link is written and row-counted server-side.
3. **The stage move** checked `error`, but an UPDATE refused by RLS matches zero rows
   and returns no error — so `alert('CRM move-to-Paid failed')` could **never** fire for
   a permission problem. Silent for as long as this has been broken.

Plus, found while verifying: **`NP_STAGE_PAID` was `'Paid'`, which is not a stage in
`pipeline-1771530511407`** (stage 2 is `'Paid/ payment plan'`). Every successful move
wrote an off-pipeline value. It succeeded exactly once — Dyann Meyers, 2026-07-28.

And in `970ca13`: middleware 307s unauthenticated API calls to `/login`, `fetch` follows
it and returns login HTML with status 200 — so `r.ok` was true and an expired session
read as a successful write. Both call sites now reject any non-JSON response.

### Deliberate exception, recorded

**Reading `team_profiles` in these routes is NOT the start of Phase 1.** There is no
version of this route that fixes the bug and reads `profiles.role`, and these are *new*
routes rather than conversions — nothing is migrated, nobody loses an existing path. The
nine routes in §3 of the decoupling doc still read `profiles.role` and are untouched.

**(c) / Phase 3 remains the right long-term answer**: rewrite `contacts_org_rls` and its
siblings (`call_logs`, `conversations`, `crm_messages`, `crm_twilio_numbers`,
`identity_graph`) onto `team_profiles`. It **requires platform coordination** —
`contacts` is read by the platform and `crm_messages_org_via_conversation` is
platform-owned — and **must not be started as a side effect of an accounting bug.**

**Option (a), setting `profiles.role = 'admin'`, was refused.** 77 policies across 59
tables admit `'admin'`, and **41 of them never check org at all** — `profiles` UPDATE,
entitlements, promo codes, HRV sessions, participant clinical data. That is platform-wide
admin, not "admin of her org". `profiles_update_admin`'s WITH CHECK is unread and may be
self-elevating.

### AWAITING APPROVAL — migration 206

`supabase/migrations/206_repair_accounting_crm_links.sql` — **committed (`78aa95a`) and
UNAPPLIED.** Committing it does not run it: per CLAUDE.md all schema and data changes are
applied by hand in the Supabase SQL Editor. It was untracked until now, which is how work
gets lost and makes a pending migration invisible to anyone reading the repo.

**Counts re-measured from live data at commit time**, not quoted from the investigation —
the routes have been in use and rows moved. NP accounting clients went **18 → 15** as the
operator deleted the duplicate and test rows. NP clients with payments: **13**.

| | Repair | Re-verified |
|---|---|---|
| **S1** | Relink **Adam Hill**, **Dylan Constance** | still unlinked, exactly **1** non-merged NP name match each |
| **S2** | Null **Mary-Lynn Manley**, **Elizabeth Nelson** | still dangling, **0** name matches — targets absent, not merged |
| **S3** | **Dyann Meyers** `'Paid'` → `'Paid/ payment plan'` | still the only contact on that stage |

All four targets unchanged. **Stage-move failures needing repair: 0** — nine NP clients
sit at *later* stages, which is legitimate forward progress and must not be rewound. The
silent defect was real; it left no repairable damage.

**Not repaired, needs a person:** one row — **`Megan Pomphrey`** (2026-09-03, no contact,
0 name matches). The other three are already gone; the operator deleted the duplicate
retry, the incomplete `Megan` and the test row `jhtf`, as recommended. Re-saving it in the
UI now works and enrols through the route.

### Filed — schema backlog

- **`acct_clinics.crm_org_id uuid references organizations(id)`** — the durable
  replacement for the server-side NP constant in `src/lib/accounting-auth.ts`. Needed
  because all three clinics carry **Sensorium** in `acct_clinics.org_id`, *including the
  Neuro Progeny one*, so that column names the **owning** org and can never name the enrol
  target. Until it exists the target is `is_neuro_progeny` mapped to a constant.
- **`acct_clients.enrolled_contact_id` is `text` with no FK** to `contacts.id` (`uuid`).
  Nothing stops a link outliving the row it points at — that is exactly what produced S2's
  two dangling rows. Typing it as `uuid` with a nullable FK (`on delete set null`) makes
  that class of damage impossible to recur. Requires validating every existing value casts
  cleanly first.

### Filed — craft, generalises beyond this repo

- **A route that redirects unauthenticated defeats `r.ok`.** Middleware 307s to `/login`,
  `fetch` follows it (default `redirect: 'follow'`) and returns login HTML with **status
  200** — so `r.ok` is `true`, `r.json()` throws into any `.catch(() => ({}))`, and an
  expired session reads as a successful write. **Any caller that checks only `r.ok` has
  this defect.** It surfaces only when a session expires, so it survives testing. Check
  the response is actually JSON, or use `r.redirected`. A route returning 401 directly
  does not have this problem — the redirect creates it.
- **An RLS-filtered `UPDATE`/`DELETE` returns `error: null`.** `USING` filters rows out of
  scope rather than rejecting the statement, so zero rows match and no error is raised.
  Only `WITH CHECK` on an `INSERT` raises. Verify RLS-governed writes by **row count**
  (`.select()` then check `length`), never by `error` alone.

### Provisioning, not code

- **`cameron.s.allen+sensoriumwalk@gmail.com` and `admin@neuroprogeny.com` have no
  `team_profiles` row in either org.** They will see the Add Client button and get a named
  403 from the routes, because the UI fails **open** — middleware only redirects on
  `status='pending'` (`supabase-middleware.ts:44-53`), and `use-permissions.tsx:76,82`
  returns `true` when the row is missing. **If either is a real operator, that is one
  `team_profiles` row to provision — not a code change.** Inverting the fail-open default
  is a mandatory companion to Phase 1, per §13.3 of the decoupling doc.
- **`acct_*` tables have no org scoping** (`acct_clients_auth` checks neither org nor
  role), so any authenticated user can write any org's accounting rows via PostgREST.
  Pre-existing; `HUB_403_INVESTIGATION.md` Finding 11. These routes tighten the UI path
  only — the direct path is untouched.
- **ESLint is not configured** in this repo; `npm run lint` prompts to create a config.
  `npx tsc --noEmit` is the working signal and is clean.
