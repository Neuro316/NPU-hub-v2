# NPU Hub — Role Decoupling Design

**Design only. 2026-08-02. No code changed, no migration written, nothing applied.**
All SQL below is **OUTPUT ONLY** and marked unapplied.

Connector verified before querying: project `htfrfaxlcuyawtlztxxm`,
`transaction_read_only = on`, `current_user = supabase_read_only_user`, not superuser.
`pg_catalog` used throughout.

**Scope discipline (per Finding 9 of `HUB_403_INVESTIGATION.md`).** Every claim below
names the column queried and the application that owns the rows. The database serves
three applications: `npu-hub-v2` (Hub), `npu-platform-v2` (platform), `neuroreport-app`
(NR). Staying inside this repo is not sufficient to stay inside Hub scope.

> **Scan correction made during this work.** An `ILIKE '%team_members%'` policy scan
> returned `nr_team_members` — a **different table** (14 columns) owned by
> neuroreport-app, not `team_members` (10 columns). Those hits were discarded. Only
> **one** policy in the database genuinely references `team_members`:
> `pipeline_resources_org_access`.

---

## 1. LEAD: the overlap, and the lockout risk in both directions

**There is no single existing table that can become the Hub's staff list without
locking out a superadmin.** That is the finding that sizes this project.

Every account passing any Hub staff gate today. `profiles.role` is the shared column;
`team_profiles` and `team_members` rows are per-org, so a person may appear with
different roles in different orgs.

| Account | `profiles.role` | `team_profiles` (org `0000…01` / `b9fd…29`) | active `team_members` | `org_members` orgs |
|---|---|---|---|---|
| `cameron@neuroprogeny.com` | superadmin | **super_admin** / team_member | **yes** (admin) | both |
| `shane@neuroprogeny.com` (`ec05f3ea`) | superadmin | **super_admin** / team_member | **yes** (admin) | both |
| `paul@neuroprogeny.com` | superadmin | **super_admin** / team_member | **no** | both |
| `cameron.allen@neuroprogeny.com` | superadmin | **none** | **yes** (admin) | `0000…01` |
| `doug@neuroprogeny.com` | admin | team_member | no | `0000…01` |
| `ella@sensoriumneuro.com` | admin | team_member | no | both |
| `cameron.s.allen+facilitator1@gmail.com` | facilitator | none | no | both |
| `npu-notifications@neuroprogeny.com` | facilitator | none | no | none |
| `admin@neuroprogeny.com` | admin | none | no | none |

### If the Hub read `team_members` alone

`team_members` holds **4 rows total** (3 admin in `0000…01`, 1 admin in `b9fd…29`).

- **LOCKED OUT: `paul@` — a superadmin.** Also `doug@` and `ella@` (both admins),
  plus the three non-staff accounts.
- Retained: `cameron@`, `cameron.allen@`, `shane@`.

### If the Hub read `team_profiles` alone

- **LOCKED OUT: `cameron.allen@` — a superadmin**, who has no `team_profiles` row at all.
- Retained: `cameron@`, `shane@`, `paul@`, `doug@`, `ella@`.
- Correctly dropped: `admin@`, `facilitator1@`, `npu-notifications@`.

### Consequence

`team_members` is **not** a staff list — it is a CRM assignment roster. It carries
`auto_assign_weight` and is read for round-robin assignment, and exactly one policy in
the entire database references it. **Rule it out as the authority substrate.**

`team_profiles` **is already the Hub's de facto staff list** (§2), and misses exactly
**one** person. That single gap is a provisioning step, not a redesign — which is what
makes this a small change rather than a large one.

**Cutover therefore requires provisioning `cameron.allen@` a `team_profiles` row
BEFORE any phase ships.** That is the whole lockout risk, and it is one row.

---

## 2. What already exists

### `team_profiles` — Hub-owned, already the authority substrate

Columns: `id, org_id, user_id, display_name, email, role (default 'team_member'),
job_title, avatar_url, slack_user_id, slack_display_name, phone, status (default
'active'), permissions jsonb, created_at, updated_at`.

Rows: org `0000…01` — 4 `super_admin`, 3 `team_member`, 2 `admin`; org `b9fd…29` —
5 `team_member`.

It already governs **~20 Hub-module tables** through RLS, all of which Hub code uses:
`meetings`, `rocks`, `rock_dependencies`, `tutorials`, `audit_log`, `change_history`,
`usage_events`, `usage_daily_stats`, `ai_conversations`, `ai_recommendations`,
`api_health_log`, `campaign_automations`, `automation_queue`, `automation_enrollments`,
`resource_locks`, `company_library`, `help_requests`, `meeting_attendees`,
`meeting_rock_reviews`. The recurring predicate is
`role = ANY (ARRAY['super_admin','admin'])`.

It is also the **middleware** gate — `supabase-middleware.ts:44-53` reads
`team_profiles.status` and redirects to `/pending`.

And it is the **client RBAC** source — `use-permissions.tsx:52-56` reads
`team_profiles` by `(org_id, user_id)` and derives `role` + `permissions`.

**Write paths (Hub):** `workspace-context.tsx:89` auto-inserts on page load;
`use-team-data.ts:89` deletes. No other writer in `src/`.

### `team_members` — CRM assignment roster, not authority

Columns: `id, org_id, user_id, display_name, email, role (default 'member'), is_active,
auto_assign_weight, created_at, updated_at`. 4 rows. Referenced by one policy
(`pipeline_resources`) and read by Hub for assignment (`sms/send:79`, `merge:103`,
`voice/answered:58`, `backup`). **Not a staff list.**

### Vocabulary collision, worth recording

Four different role vocabularies exist in this database:

| Column | Values | Owner |
|---|---|---|
| `profiles.role` | `superadmin`, `admin`, `facilitator`, `participant` | shared |
| `team_profiles.role` | `super_admin`, `admin`, `team_member` | Hub |
| `team_members.role` | `admin`, `member` | Hub (assignment) |
| `org_members.role` | `owner`, `admin`, `member`, `participant` | shared |

Note `superadmin` vs `super_admin`. The Hub already reads both spellings in different
layers, and they are not interchangeable.

---

## 3. Current state — every Hub authorization decision

My earlier "five routes" figure was **incomplete**. The full set:

### Server-side, reading `profiles.role` (the coupling to remove) — 9 routes

| File:line | Constant | Grants |
|---|---|---|
| `comms/caller-lookup/route.ts:29,31` | `STAFF_ROLES` | caller identity lookup |
| `comms/conversation/archive/route.ts:53,55` | `STAFF_ROLES` | archive/unarchive threads |
| `contacts/duplicates/route.ts:152,154` | `STAFF_ROLES` | dedupe read + dismiss |
| `crm/stage-emails/route.ts:46,48` | `STAFF_ROLES` | stage email send |
| `voice/receiver-token/route.ts:40,42` | `STAFF_ROLES` | Twilio voice receiver token |
| `comms/greeting/route.ts:58,63` | `ADMIN_ROLES` | greeting upload/delete |
| `contacts/merge/route.ts:79,82` | `ADMIN_ROLES` | contact merge |
| `settings/read/route.ts:40` | `ADMIN_ROLES` | read org settings incl. credentials |
| `settings/route.ts:53` | `ADMIN_ROLES` | write org settings |

`STAFF_ROLES = {admin, superadmin, facilitator}` is redeclared **inline in five files**;
`ADMIN_ROLES = {admin, superadmin}` is imported from `org-settings-keys.ts:33`.

Two additionally hard-code the role inline rather than using a constant:
`comms/recording/[id]/route.ts:36-46` and `voice/answered/route.ts:46-48`.

### Middleware
`supabase-middleware.ts:44-53` — reads **`team_profiles.status`**, not `profiles.role`.
Already decoupled.

### Client RBAC
`use-permissions.tsx:52-64` — reads **`team_profiles`**. Already decoupled.

> **Latent defect, relevant to sequencing.** `use-permissions.tsx:76,82` returns
> `true` from `canView`/`canEdit` when `member` is null. **No `team_profiles` row means
> full UI access, not none.** Combined with §5's circular-RLS problem, a Hub-only user
> who cannot *read* their own row would be indistinguishable from an org owner. This
> must be inverted to fail-closed in the same phase that makes `team_profiles`
> authoritative, or the decoupling weakens access control instead of tightening it.

### RLS on Hub-owned tables referencing `profiles.role`
Via `get_my_role()` / `has_role()` — `contacts_org_rls` is the confirmed instance, and
the pattern `has_role(auth.uid(),'superadmin') OR (get_my_role() = ANY(...))` recurs on
the CRM comms tables (`crm_messages`, `crm_twilio_numbers`). These are **Phase 3** and
are the expensive part.

---

## 4 & 8. The reverse coupling — what a Hub grant reaches in the platform

**Answering from the database side only; the platform repo was not read.**

`org_members` is the shared authority substrate: **57 tables** carry a policy
referencing it, spanning all three applications — Hub CRM (`contacts`, `campaigns`,
`podcasts`, `projects`, `kanban_tasks`, `journey_*`, `media_*`, `task_*`), platform
(`enrollments`, `payments`, `revenue_records`, `facilitator_payouts`,
`facilitator_rate_configs`, `payout_line_items`, `course_modules`, `quiz_responses`),
and NR (`nr_report_revisions`).

**Does a Hub-set row confer platform access today? Currently no — but only by accident.**

The Hub has exactly one code path that writes `org_members`:
`invite/[token]/accept/route.ts:99`. It is **broken** (Finding 2b — writes `org_id`,
a column that does not exist) and **unreachable** (no Hub code creates a `hub_invites`
row). So the Hub cannot presently mint platform authority. **If Finding 2b is fixed
without addressing this, that path opens.** This is the single most important
consequence of the decoupling work, and it argues for fixing P2b *after* the model is
settled, not before.

**The live coupling runs the other way, and it is automatic.**
`workspace-context.tsx:89` inserts a `team_profiles` row with `role='team_member'`,
`status='active'` for any authenticated user holding an `org_members` row, **on page
load**. Since `team_profiles` governs ~20 Hub tables and the middleware gate, a
platform-side `org_members` grant becomes Hub access the first time that person opens
the Hub. **This is the mechanism the brief describes, and it is one `if` statement.**

### Closing it — no platform change required

Removing the auto-insert at `workspace-context.tsx:89` closes the forward path
**entirely, in Hub code, with no platform-side change**. That is Phase 2 below.

Closing the reverse path (Hub → platform) needs nothing today, because the only writer
is already broken. To keep it closed permanently the Hub must never write `org_members`;
that is a code convention, enforceable by a review rule rather than a migration.

**Where a platform change WOULD be required, stated plainly:** making Hub-owned CRM
tables stop trusting `org_members` means rewriting `contacts_org_rls` and its siblings.
Those policies are on tables the platform also reads, and at least one
(`crm_messages_org_via_conversation`) is **platform-owned** per migration 202's notes.
**Phase 3 cannot be completed from the Hub side alone.** Phases 1 and 2 can, and they
deliver the behaviour the brief asks for. Phase 3 is optional hardening and should be
scoped as a joint change.

---

## 5. Grant model (item 7)

**Default is separation. Two independent grants, two tables, no shared record.**

| Authority | Record | Granted by | Revoked by |
|---|---|---|---|
| **Hub** | `team_profiles` row `(org_id, user_id, role, status='active')` | Hub admin via a Hub team screen | delete the row, or `status='revoked'` |
| **Platform** | `org_members` row `(organization_id, user_id, role)` | platform admin | delete the row |

`profiles.role` **keeps its platform meaning and is never modified by the Hub.**

### Concrete rows

**Platform-only** (a facilitator; no Hub access):
```
profiles      : id=<u>, role='facilitator'
org_members   : user_id=<u>, organization_id=<org>, role='member'
team_profiles : (no row)                                  <-- no Hub authority
```

**Hub-only** (CRM operator; no platform access):
```
profiles      : id=<u>, role='participant'                <-- untouched, platform's
org_members   : (no row)                                  <-- no platform authority
team_profiles : user_id=<u>, org_id=<org>, role='team_member', status='active'
```

**Dual** — two deliberate records, separately revocable:
```
profiles      : id=<u>, role='superadmin'                 <-- platform's own value
org_members   : user_id=<u>, organization_id=<org>, role='admin'    <-- platform grant
team_profiles : user_id=<u>, org_id=<org>, role='super_admin', status='active'  <-- Hub grant
```

Revoking platform authority deletes the `org_members` row and leaves `team_profiles`
untouched; revoking Hub authority does the reverse. **No value in either row implies
the other.**

### Auditability
Neither table has a history record today. `team_profiles` has `updated_at` but no
audit trail; `org_members` has only `created_at`. If grants must be auditable — and
the brief says separately auditable — a `hub_authority_events` append-only ledger is
required. **Not designed here; flagged as a dependency.** Findings 1 and 8 already
established that this codebase loses exactly this kind of provenance.

### The circular-RLS blocker

Both policies on `team_profiles` require `org_members` membership:
`org_access` reads `org_members` directly, and `Users access own org team profiles`
uses `user_org_ids()`, which is `SELECT organization_id FROM org_members`.

**A Hub-only person could not read their own `team_profiles` row.** Server routes use
the service-role client and are unaffected, but `use-permissions.tsx` uses the browser
client — and its fail-open default would then grant that user full UI access.

**This must be fixed in Phase 1**, not deferred. Output-only, **NOT APPLIED**:

```sql
-- Lets a user see their OWN team_profiles row without an org_members row.
-- Additive: existing org-scoped policies remain, so nobody loses visibility.
create policy team_profiles_self_read
  on public.team_profiles
  for select
  to authenticated
  using (user_id = auth.uid());
```

---

## 6. Migration path

Each phase is independently deployable and independently revertible.

### Phase 0 — Provisioning (REQUIRED FIRST, no code)
Create the one missing Hub grant. Without this, Phase 1 locks out a superadmin.

```sql
-- OUTPUT ONLY — NOT APPLIED. Verify the row does not already exist first.
insert into public.team_profiles (org_id, user_id, display_name, email, role, status)
select '00000000-0000-0000-0000-000000000001', p.id,
       coalesce(p.full_name, split_part(p.email,'@',1)), p.email, 'super_admin', 'active'
from public.profiles p
where p.email = 'cameron.allen@neuroprogeny.com'
  and not exists (select 1 from public.team_profiles tp
                   where tp.user_id = p.id
                     and tp.org_id = '00000000-0000-0000-0000-000000000001');
-- Expect exactly 1 row. If 0, the row already exists — confirm before proceeding.
```
**Stop here and nothing changes.** Purely additive.

### Phase 1 — Hub server routes read `team_profiles`
Replace `profiles.role` with `team_profiles.role` in the 9 routes of §3, plus the two
inline gates. Introduce one shared helper rather than five inline `STAFF_ROLES`
redeclarations. Map `super_admin|admin` → admin authority, `team_member` → staff.
Ship the `team_profiles_self_read` policy above and **invert the `use-permissions`
fail-open default** in the same phase.

*Stop here:* the Hub no longer reads `profiles.role`. A platform facilitator with no
`team_profiles` row loses Hub access — **the brief's primary goal, achieved.** The
auto-provision at `workspace-context.tsx:89` still silently re-grants it on page load,
so the win is incomplete until Phase 2.

### Phase 2 — Remove the auto-provision
Delete the `team_profiles` auto-insert at `workspace-context.tsx:89`. Hub authority
becomes grantable only by deliberate act.

*Stop here:* full separation for all Hub application logic. **This is the recommended
stopping point.** Phase 3 is hardening, not correctness.

*Breaks if you stop before this:* an `org_members` grant still mints Hub access on
first login.

### Phase 3 — Hub table RLS stops trusting `org_members` (JOINT, optional)
Rewrite `contacts_org_rls` and the CRM comms policies to key on `team_profiles`.
**Requires platform coordination** — these tables are read by the platform and at least
one policy is platform-owned. Do not attempt from the Hub alone.

*Breaks if you stop before this:* an `org_members` holder can still reach CRM **data**
through direct PostgREST calls, even though the Hub UI and API refuse them. Defence in
depth is reduced; application-level separation is intact.

### Ruled in / out
- **Adding a Hub-owned role column: RULED OUT.** `team_profiles.role` already exists,
  already carries the right vocabulary, and already governs ~20 tables. A new column
  would be a fourth vocabulary.
- **`team_members` as the substrate: RULED OUT** — §1, locks out three people.
- **Backfill vs fresh: BACKFILL**, and it is one row (Phase 0). Everyone else already
  has an active `team_profiles` row.
- **Platform-side change required? NO** for Phases 0–2. **YES** for Phase 3.

---

## 7. Lockout guard (item 6)

**Cameron and Shane must never lose access. `ec05f3ea` must not be modified.**

- Both hold `team_profiles.role = 'super_admin'`, `status = 'active'` in org `0000…01`
  **today**. Every phase reads that column. **Neither is touched by any phase**, and no
  proposed statement writes to `ec05f3ea` — Phase 0 inserts one row for a different
  user, filtered by email.
- **Pre-flight gate, must return ≥2 including both, before each phase:**
```sql
-- OUTPUT ONLY — NOT APPLIED. Run before and after every phase.
select tp.user_id, p.email, tp.org_id, tp.role, tp.status
from public.team_profiles tp join public.profiles p on p.id = tp.user_id
where tp.role in ('super_admin','admin') and tp.status = 'active'
order by tp.role, p.email;
```
- **Recovery if a phase locks everyone out.** Every phase is a Vercel deploy;
  `vercel rollback` restores the prior bundle in seconds and needs no database access.
  The one non-code artefact is the additive `team_profiles_self_read` policy, revertible
  with `drop policy`. **Phase 0 is additive and never needs reverting.** Because
  service-role API routes bypass RLS, a superadmin locked out of the UI still reaches
  data through the Supabase dashboard, which uses neither path.
- **Do not combine phases in one deploy.** The rollback granularity is the guard.

---

## 8. Dual authority today — SUPERSEDED by §11 and §12. Retained for reasoning only.

| Person | Recommendation | Basis |
|---|---|---|
| `cameron@` | **Dual** | Dual by definition, per the brief. |
| `shane@` (`ec05f3ea`) | **Dual** | *Evidence, not assumption:* holds Hub `team_profiles.super_admin` in `0000…01`, and is `invited_by` on **2 of the 3** `hub_invites` rows — both `role='participant'` for org `b9fd…29`. Issuing participant invitations is platform-side onboarding activity, and doing it for the other org indicates authority beyond the Hub. Both sides evidenced. |
| `paul@` | **Hub-only**, pending confirmation | Active `team_profiles.super_admin`, `org_members` in both orgs — but no `team_members` row and no platform-side activity visible in anything I queried. `org_members` alone is weak evidence: it is the shared substrate and says little about intent. Grant Hub; confirm platform separately. |
| `cameron.allen@` | **Your call — likely dual** | Superadmin with an active `team_members` admin row but **no `team_profiles`**. Appears to be a second Cameron account. Phase 0 grants Hub authority; whether platform authority is intended is a question I cannot answer from the data. |
| `doug@` | **Hub-only** | `team_profiles.team_member` active, `org_members` in `0000…01` only. Profile is CRM operator. |
| `ella@sensoriumneuro.com` | **Hub-only** | `team_profiles.team_member` active. Holds `org_members` in both orgs, but no platform-side signal. SNW domain suggests CRM/EHR work. |
| `cameron.s.allen+facilitator1@gmail.com` | **Platform-only** | Plus-addressed test account named for the role. No Hub record. |
| `npu-notifications@` | **Neither** | Service account, sentinel id `facade00-…-0001`. Should hold no interactive authority on either side. |
| `admin@` | **Neither** | Never provisioned: no `team_profiles`, no `team_members`, no `org_members`. |

---

## 9. The orphan case — SUPERSEDED by §11 and §12. All orphans resolved or listed outstanding in §12.5.

Accounts passing a Hub gate **only** via `profiles.role`, holding no Hub-side record.
Under the target model each becomes platform-only and loses Hub access.

| Account | `profiles.role` | Outcome correct? | Action before cutover |
|---|---|---|---|
| `admin@neuroprogeny.com` | admin | **Correct — let it lapse.** Unprovisioned generic login. | none |
| `npu-notifications@neuroprogeny.com` | facilitator | **Correct — let it lapse.** Service account; it never needed Hub UI access. | none |
| `cameron.s.allen+facilitator1@gmail.com` | facilitator | **Correct — let it lapse.** Test account. | none |
| `cameron.allen@neuroprogeny.com` | superadmin | **INCORRECT — needs a grant.** A real superadmin with `team_members` but no `team_profiles`. | **Phase 0 insert. Blocking.** |

**Cutover needs a provisioning step, and it is exactly one row.** `doug@`, `ella@` and
`paul@` are *not* orphans — all three hold active `team_profiles` rows and carry
through untouched.

---

## 10. Open questions

1. **`cameron.allen@`** — intended platform authority? Determines its `org_members` row.
2. **`paul@`** — platform authority, or Hub-only? §8 recommends Hub-only on thin evidence.
3. **Audit ledger** — the brief requires separately auditable grants. Neither table
   records history. Is a `hub_authority_events` ledger in scope, or deferred?
4. **Phase 3** — worth opening a joint change with `npu-platform-v2`, or is
   application-level separation (Phases 0–2) sufficient?
5. **P2b sequencing** — fixing invite acceptance re-opens the Hub's only path to
   writing `org_members`, i.e. minting platform authority. Recommend it stays paused
   until the grant model is settled.

---

# 11. Phase 0 — Resolved grants (supersedes §8 and §9)

**2026-08-02. Cameron has ruled. Nothing below is applied — all SQL is OUTPUT ONLY,
to be run manually in the Supabase SQL Editor.**

Org ids are never collapsed. `team_profiles` is per-org:
**NP** = `00000000-0000-0000-0000-000000000001`, **SNW** = `b9fd8b2e-ded6-468b-ab1e-10b50ca40629`.

## 11.1 Current state vs target

| Person | Org | Current `team_profiles` | Target | Verdict |
|---|---|---|---|---|
| `cameron@` (`22456608`) | NP | `super_admin` active | `super_admin` | **no-change** |
| `cameron@` | SNW | `team_member` active | *unspecified* | no-change |
| `cameron.allen@` (`7bfcb19f`) | NP | **none** | `super_admin` | **new-row** |
| `shane@` (`ec05f3ea`) | NP | `super_admin` active | `super_admin` | **no-change — ROW NOT TOUCHED** |
| `shane@` | SNW | `team_member` active | *unspecified* | no-change |
| `paul@` (`5512c7b9`) | NP | `super_admin` active | `super_admin` | **no-change** |
| `paul@` | SNW | `team_member` active | *unspecified* | no-change |
| `ella@sensoriumneuro.com` (`c809b007`) | SNW | `team_member` active | `super_admin` | **elevation** |
| `ella@sensoriumneuro.com` | NP | `team_member` active | *"SNW ONLY"* | **QUESTION — see 11.4** |
| `ella@neuroprogeny.com` (`ced3f075`) | NP | **none** | `team_member` | **new-row** |
| `ella@neuroprogeny.com` | SNW | `team_member` active | *unspecified* | **QUESTION — see 11.4** |

## 11.2 Item 1 — `ella@neuroprogeny.com` resolved

**The account EXISTS.** It did not appear in the earlier overlap table because that
table was filtered to `profiles.role in ('superadmin','admin','facilitator')`, and this
account's `profiles.role` is **`participant`** — a filter artefact, not an absence.

| | `ella@neuroprogeny.com` | `ella@sensoriumneuro.com` |
|---|---|---|
| `auth.users.id` | `ced3f075-1ec0-4854-9758-5a2e719b2ad3` | `c809b007-66dd-41df-9629-89eb5444d44a` |
| `auth.users.created_at` | 2026-03-11 14:51:52Z | 2026-03-30 12:31:25Z |
| `auth.users.last_sign_in_at` | 2026-04-07 20:00:26Z | 2026-06-27 14:35:59Z |
| `profiles.role` (platform's column) | **`participant`** | **`admin`** |
| `team_profiles` | `team_member` active, **SNW only** | `team_member` active, **both orgs** |

**Same person, two addresses.** Both `team_profiles.display_name` values are exactly
`Ella Brown`. No raw `auth` insert is needed — the account already exists, so no signup
path has to be invoked.

Note the target inverts current reality: the `@neuroprogeny.com` address currently has
Hub presence **only in SNW**, and the `@sensoriumneuro.com` address has presence in
**both**. Worth confirming the addresses were not transposed in the ruling.

## 11.3 The unlinked-row discovery (not previously known)

**4 of 14 `team_profiles` rows have `user_id = NULL`.** They are inert — `use-permissions`
filters `.eq('user_id', uid)`, which never matches NULL — but they encode grants that
were *intended* and never took effect:

| email (as stored) | display_name | role | status | org | matching account |
|---|---|---|---|---|---|
| `Ella@neuroprogeny.com` | Ella Brown | **`super_admin`** | active | NP | `ced3f075` exists |
| `Doug@neuroprogeny.com` | Doug Blessington | **`admin`** | active | NP | `a139491d` exists |
| `Leigh@neuroprogeny.com` | Leigh Blessington | `admin` | invited | NP | none |
| `wes@neuroprogeny.com` | Wes | `team_member` | inactive | NP | none |

**Root cause, and it closes the loop with §4.** The `/team` screen
(`team/page.tsx:29-35`) calls `addMember` with `display_name`, `email`, `role`,
`status:'invited'` — and **never sets `user_id`**, because the person has no account
yet. When they later sign in, `workspace-context.tsx:89` creates a **second** row —
linked, but hard-coded `role:'team_member'`. The intended grant is orphaned and the
person silently lands one privilege level lower.

That is exactly what happened to Doug (unlinked `admin` + linked `team_member`) and to
Ella (unlinked `super_admin` + linked `team_member` in the other org).

**These rows become live if `user_id` is ever backfilled.** They must be resolved
deliberately, not left. `Leigh@` and `wes@` have no account at all and are decisions in
their own right.

## 11.4 QUESTIONS — ALL FOUR ANSWERED. See §12 for the rulings and resulting SQL.

1. **`ella@sensoriumneuro.com`'s NP row.** "Sensorium org ONLY" implies deleting her
   existing NP `team_member` row. Deleting is a **revocation** of access she has today.
   Delete it, or leave it and treat "ONLY" as scoping the *super_admin* grant?
2. **`ella@neuroprogeny.com`'s SNW row.** The ruling grants her NP `team_member` but is
   silent on the SNW `team_member` row she already holds. Keep or remove?
3. **The unlinked `Ella@neuroprogeny.com` `super_admin` NP row.** It conflicts with the
   ruling (`team_member` for that address). Delete it, or was super_admin the intent?
4. **`Doug@`, `Leigh@`, `wes@` unlinked rows.** Out of scope for this grant set, but
   `Doug@`'s inert `admin` grant contradicts his live `team_member` row.

**No SQL below touches anything covered by these four questions.**

## 11.5 OUTPUT-ONLY SQL — NOT APPLIED

### Pre-flight gate — run BEFORE and AFTER the whole set

```sql
select tp.user_id, p.email, tp.org_id, tp.role, tp.status
from public.team_profiles tp join public.profiles p on p.id = tp.user_id
where tp.role in ('super_admin','admin') and tp.status = 'active'
order by tp.role, p.email;
-- BEFORE: expect cameron@, paul@, shane@ as super_admin in NP.
-- AFTER : the same three, PLUS cameron.allen@ (NP) and ella@sensoriumneuro.com (SNW).
-- If cameron@ or shane@ is ever absent, STOP and roll back.
```

### Grant 1 — `cameron.allen@` to `super_admin`, NP. New row.

```sql
-- BEFORE (expect 0 rows)
select * from public.team_profiles
where user_id='7bfcb19f-c7fe-4b4d-a208-212eb45df95f'
  and org_id='00000000-0000-0000-0000-000000000001';

insert into public.team_profiles (org_id, user_id, display_name, email, role, status)
select '00000000-0000-0000-0000-000000000001',
       '7bfcb19f-c7fe-4b4d-a208-212eb45df95f',
       'Cameron Allen', 'cameron.allen@neuroprogeny.com', 'super_admin', 'active'
where not exists (
  select 1 from public.team_profiles
   where user_id='7bfcb19f-c7fe-4b4d-a208-212eb45df95f'
     and org_id='00000000-0000-0000-0000-000000000001');

-- AFTER (expect exactly 1 row, role super_admin, status active)
select * from public.team_profiles
where user_id='7bfcb19f-c7fe-4b4d-a208-212eb45df95f'
  and org_id='00000000-0000-0000-0000-000000000001';
```

### Grant 2 — `ella@sensoriumneuro.com` to `super_admin`, SNW. Elevation.

```sql
-- BEFORE (expect 1 row, role team_member)
select id, role, status from public.team_profiles
where user_id='c809b007-66dd-41df-9629-89eb5444d44a'
  and org_id='b9fd8b2e-ded6-468b-ab1e-10b50ca40629';

update public.team_profiles
   set role='super_admin', updated_at=now()
 where user_id='c809b007-66dd-41df-9629-89eb5444d44a'
   and org_id='b9fd8b2e-ded6-468b-ab1e-10b50ca40629'
   and role='team_member';   -- guard: no-op if already elevated

-- AFTER (expect 1 row, role super_admin)
select id, role, status from public.team_profiles
where user_id='c809b007-66dd-41df-9629-89eb5444d44a'
  and org_id='b9fd8b2e-ded6-468b-ab1e-10b50ca40629';
```

### Grant 3 — `ella@neuroprogeny.com` to `team_member`, NP. New row.

```sql
-- BEFORE (expect 0 rows)
select * from public.team_profiles
where user_id='ced3f075-1ec0-4854-9758-5a2e719b2ad3'
  and org_id='00000000-0000-0000-0000-000000000001';

insert into public.team_profiles (org_id, user_id, display_name, email, role, status)
select '00000000-0000-0000-0000-000000000001',
       'ced3f075-1ec0-4854-9758-5a2e719b2ad3',
       'Ella Brown', 'ella@neuroprogeny.com', 'team_member', 'active'
where not exists (
  select 1 from public.team_profiles
   where user_id='ced3f075-1ec0-4854-9758-5a2e719b2ad3'
     and org_id='00000000-0000-0000-0000-000000000001');

-- AFTER (expect exactly 1 row, role team_member)
select * from public.team_profiles
where user_id='ced3f075-1ec0-4854-9758-5a2e719b2ad3'
  and org_id='00000000-0000-0000-0000-000000000001';
```

**No statement references `ec05f3ea`.** `cameron@`, `shane@` and `paul@` require no
change; their rows already match target.

## 11.6 Item 2 — the two Cameron accounts, for the record

| | `cameron@neuroprogeny.com` | `cameron.allen@neuroprogeny.com` |
|---|---|---|
| id | `22456608-5f7d-495e-af02-7037fea125cc` | `7bfcb19f-c7fe-4b4d-a208-212eb45df95f` |
| auth created | 2026-02-08 03:00:59Z | 2026-02-14 11:36:53Z |
| last sign-in | **2026-08-02 00:18:50Z (current)** | 2026-07-02 11:24:11Z (a month stale) |
| `profiles.role` | superadmin | superadmin |
| `org_members` / `team_members` / `team_profiles` | 2 / 1 / 2 | 1 / 1 / **0** |

Hub rows naming each as actor (only non-zero shown):

| Column | `cameron@` | `cameron.allen@` |
|---|---|---|
| `contact_relationships.created_by` | **199** | 0 |
| `kanban_tasks.owner_id` | **111** | 0 |
| `crm_messages.sent_by` | **11** | 0 |
| `projects.owner_id` | **9** | 0 |
| `hub_invites.invited_by` | 0 | **1** |

**The ambiguity is real but heavily one-sided.** `cameron@` is the working identity and
owns essentially all Hub authorship; `cameron.allen@` has a footprint of exactly one row
(the `admin@` invite of 2026-07-04). Any future consolidation would need to re-point
those five columns — recorded here so it is not rediscovered as a mystery. **Not
consolidating now.**

## 11.7 Item 5 — untouched accounts

| Account | Effect of this grant set | Loses anything it should keep? |
|---|---|---|
| `doug@` | None. Keeps NP `team_member` active. | **No.** His inert unlinked `admin` row is untouched — see 11.4 Q4. |
| `cameron.s.allen+facilitator1@` | None. No `team_profiles` row before or after. | **No.** Test account; platform-only. |
| `npu-notifications@` | None. No `team_profiles` row. | **No.** Service account (`facade00-…-0001`); holds no interactive authority by design. |
| `admin@` | None. No `team_profiles` row. | **No.** Never provisioned; correct to lapse. |

None of the four is referenced by any statement in 11.5.

## 11.8 Item 6 — CORRECTION: the Phase 2 gap is not what the brief assumed

**The premise "nothing else inserts" is false.** `use-team-data.ts` has three write
paths, not one:

| Function | Line | Operation |
|---|---|---|
| `addMember` | `use-team-data.ts:73` | **INSERT** into `team_profiles` |
| `updateMember` | `use-team-data.ts:82` | **UPDATE** (role changes) |
| `deleteMember` | `use-team-data.ts:89` | DELETE |

**A Hub team-grant screen already exists** at `/team`
(`src/app/(dashboard)/team/page.tsx`), wired to all three. It is already gated on
`team_profiles`, not `profiles.role` — `use-team-data.ts:114-115` derives
`isSuperAdmin`/`isAdmin` from the caller's own `team_profiles.role`. It even carries
privilege-escalation protection: `team/page.tsx:28` clamps a non-super_admin's grant
via `maxRole`, so an `admin` cannot mint a `super_admin`.

**So Phase 2 does not need a new screen.** The real gap is narrower and is the same
defect as 11.3:

> `addMember` creates the row with `status:'invited'` and **no `user_id`**. Nothing ever
> links it when the person signs up. `workspace-context.tsx:89` instead mints a *second*
> row at `role:'team_member'`.

**Phase 2 therefore becomes:** delete the auto-provision at `workspace-context.tsx:89`,
and replace it with a **link** step — on first sign-in, match an unlinked `team_profiles`
row by `lower(email)` within the org and set `user_id`, granting nothing new. If no
invited row exists, the user gets **no** Hub authority, which is the intended default.

That is a smaller change than the design originally implied, and it fixes the orphan-row
bug at the same time. **Design only — not built, not scoped for this session.**

The `/team` screen writes `team_profiles` **only**. It never writes `org_members`, so it
cannot mint platform authority. The separation property of §5 holds.

---

# 12. Phase 0b — Rulings applied (supersedes §8, §9 and §11.4)

> ## STATUS: **APPLIED 2026-08-02**
>
> Statements 1–6 of §12.7 were run manually in the Supabase SQL Editor, verified
> individually, and the post-flight gate returned exactly the **7** rows predicted.
> Independently re-verified from this session: one `team_profiles` row per person per
> org for `ced3f075` and `a139491d`; Doug's orphan `ca861a0a` no longer exists;
> `ec05f3ea` untouched and still `super_admin`/`active`.
>
> **Statements 7 and 8 (§12.9.2 — `Leigh@`, `wes@`) are NOT applied.**

**2026-08-02. All four §11.4 questions answered by Cameron.**

NP = `00000000-0000-0000-0000-000000000001` · SNW = `b9fd8b2e-ded6-468b-ab1e-10b50ca40629`

## 12.1 The constraint that governs all of this

```
team_profiles_org_id_email_key  UNIQUE (org_id, email)     <-- uniqueness is on EMAIL
team_profiles_pkey              UNIQUE (id)
idx_team_profiles_user          NON-unique (user_id)       <-- NOT unique
```

**There is no uniqueness on `(org_id, user_id)`.** Nothing prevents one person holding
several rows in one org. And because btree is **case-sensitive**, `Doug@…` and `doug@…`
are distinct keys — which is exactly how the duplicate NP rows were created in the first
place. This single fact drives items 6, 7 and 8.

## 12.2 RAISED BEFORE THE SQL: should Ella's and Doug's orphans be handled alike?

The brief flags the asymmetry deliberately and asks for disagreement up front.

**On principle: yes, both must end identically — exactly ONE row per (person, org).**
Leaving two rows for one person in one org is not cosmetic; see 12.3.

**On method: the asymmetry is justified, because their starting states differ.**

- **Ella's orphan is her ONLY NP row.** Her linked row is in SNW. So the orphan can be
  *linked* — it becomes her live NP row. Nothing is deleted, ruling 4 is honoured
  literally, and the result is one row.
- **Doug already has a live NP row.** His orphan is therefore pure redundancy carrying
  no information his live row will not have after elevation. Deleting it is the only way
  to reach one row.

So the difference is in the starting data, not in the principle. **Both end at one row
per person per org.** I am not harmonising the methods, and I am not silently doing so.

## 12.3 Item 6 — the duplicate risk, answered

**Question: if Ella's orphan is aligned rather than deleted, what does the Phase 2 link
step do — merge, duplicate, or fail?**

**It DUPLICATES. It cannot fail, and it cannot merge.** With no unique constraint on
`(org_id, user_id)`, setting `user_id` on the orphan simply produces a second NP row for
`ced3f075`, alongside the row a literal reading of ruling 2 would insert.

**The consequence is worse than untidiness.** `use-permissions.tsx:51-56` reads:

```js
.eq('org_id', currentOrg.id).eq('user_id', user.id).maybeSingle()
.then(({ data }) => { setMember(data); setLoading(false) })
```

`.maybeSingle()` **errors when two rows match**, and the `.then` destructures only
`data` — so `member` becomes `null`. And `canView`/`canEdit` (`:76,82`) **return `true`
when `member` is null**. Two rows would therefore give Ella *more* access than either
row grants, not less. A duplicate here fails **open**.

### Recommended prevention — one statement instead of two

**Link the orphan and set its role, rather than inserting a separate row.** The orphan
row `91d23bc7` becomes Ella's live NP row:

- ruling 2 satisfied — she is NP `admin` on a linked row;
- ruling 4 satisfied — the orphan is aligned to `admin` and **not deleted**;
- exactly one NP row, so no duplicate and no fail-open.

The email is lowercased in the same statement so the case-sensitive unique index cannot
admit a future twin. Verified free: no NP row currently holds `ella@neuroprogeny.com`
(hers is in SNW; the NP one is `Ella@…` with a capital E).

**The literal two-row alternative** — insert a fresh NP row *and* align the orphan — is
available, but it produces exactly the duplicate above and I do not recommend it. Say so
and I will write it instead.

## 12.4 Item 1 — `ella@sensoriumneuro.com`'s NP role: recommend `team_member` (no change)

Ruling: keeps NP access, below `super_admin`. Her current NP role is already
`team_member`. **Recommend leaving it**, on three grounds:

1. **`admin` is the grant-making level.** `use-team-data.ts:114-115` derives `isAdmin`
   from `super_admin` *or* `admin`, and `/team` lets an `isAdmin` user create and modify
   `team_profiles` rows. Making her NP `admin` would let her grant Hub authority in NP —
   the very authority the ruling scopes to SNW.
2. It is the minimum change that satisfies "keeps her access": no revocation, no elevation.
3. `team_member` still carries full module access unless `permissions` narrows it.

**Flagging an ambiguity these rulings create.** Ella Brown is one person with two
accounts, and under these rulings she holds **two different NP privilege levels
simultaneously**: `admin` via `ella@neuroprogeny.com` and `team_member` via
`ella@sensoriumneuro.com`. Whichever account she signs in with determines her NP
authority. This is the same class of audit ambiguity recorded for the two Cameron
accounts in §11.6. Not resolving it here — recording it so it is not rediscovered.

## 12.5 Item 7 — all four `user_id IS NULL` rows

**Status 2026-08-02: Ella's and Doug's orphans are RESOLVED (applied). `Leigh@` and
`wes@` remain OUTSTANDING — ruled for deletion, SQL in §12.9.2, not yet run.**

| Row | email | role | status | Resolved by these rulings? |
|---|---|---|---|---|
| `91d23bc7` | `Ella@neuroprogeny.com` | super_admin → **admin** | active | **YES** — ruling 4, linked to `ced3f075` (12.3) |
| `ca861a0a` | `Doug@neuroprogeny.com` | admin | active | **YES** — ruling 3, **delete** (12.2) |
| `d7985bfc` | `Leigh@neuroprogeny.com` | admin | **invited** | **YES — ruled DELETE, see §12.9** |
| `79b1aa04` | `wes@neuroprogeny.com` | team_member | **inactive** | **YES — ruled DELETE, see §12.9** |

**`Leigh@neuroprogeny.com`** — `admin`, status `invited`, **no account exists** in
`auth.users` or `profiles`. This is an open invitation from 2026-04-13 that was never
taken up. It is inert today, but it is a **pre-authorised `admin` grant**: if Leigh ever
signs up and the Phase 2 link step runs, she becomes a Hub admin with no further
approval. *Recommendation: decide whether that invitation still stands. If not, delete
it. Not acting.*

**`wes@neuroprogeny.com`** — `team_member`, status **`inactive`**, no account, created
2026-02-10 (the oldest row in the table). Inert on two counts. *Recommendation: delete
as a dead row. Not acting.*

Neither is touched by any statement below.

## 12.6 Item 8 — sequencing: INDEPENDENT of Phase 2

**These orphan resolutions can be run now.** They are pure data statements against
`team_profiles`; they depend on no code change, and Phase 1 and Phase 2 are untouched.

Running them now **reduces** Phase 2 risk rather than depending on it: after this set,
the only unlinked rows remaining are `Leigh@` and `wes@`, so the link step has almost
nothing to act on and cannot resurrect a stale grant for Ella or Doug.

One ordering note within the set: **Grant 3 (Ella) must run before any Phase 2 link
step**, or that step would link the orphan itself at `super_admin` — the level ruling 4
explicitly downgrades. Since Phase 2 is not being run, that is satisfied by default.

## 12.7 OUTPUT-ONLY SQL — NOT APPLIED

### Pre-flight gate — run BEFORE and AFTER the whole set

```sql
select tp.user_id, p.email, tp.org_id, tp.role, tp.status
from public.team_profiles tp join public.profiles p on p.id = tp.user_id
where tp.role in ('super_admin','admin') and tp.status = 'active'
order by tp.role, p.email;
-- BEFORE: 3 rows — cameron@, paul@, shane@, all super_admin in NP.
-- AFTER : 7 rows — those 3, plus   [this gate JOINS profiles, so it counts only
--          LINKED rows; unlinked user_id IS NULL rows never appear in it]
--         cameron.allen@ super_admin NP, ella@sensoriumneuro.com super_admin SNW,
--         ella@neuroprogeny.com admin NP, doug@neuroprogeny.com admin NP.
-- If cameron@ or shane@ is ever missing, STOP and roll back.
```

### Statement 1 — `cameron.allen@` → `super_admin`, NP (new row)

```sql
select * from public.team_profiles          -- BEFORE: expect 0 rows
where user_id='7bfcb19f-c7fe-4b4d-a208-212eb45df95f'
  and org_id='00000000-0000-0000-0000-000000000001';

insert into public.team_profiles (org_id, user_id, display_name, email, role, status)
select '00000000-0000-0000-0000-000000000001',
       '7bfcb19f-c7fe-4b4d-a208-212eb45df95f',
       'Cameron Allen', 'cameron.allen@neuroprogeny.com', 'super_admin', 'active'
where not exists (
  select 1 from public.team_profiles
   where user_id='7bfcb19f-c7fe-4b4d-a208-212eb45df95f'
     and org_id='00000000-0000-0000-0000-000000000001');

select * from public.team_profiles          -- AFTER: expect 1 row, super_admin/active
where user_id='7bfcb19f-c7fe-4b4d-a208-212eb45df95f'
  and org_id='00000000-0000-0000-0000-000000000001';
```

### Statement 2 — `ella@sensoriumneuro.com` → `super_admin`, SNW (elevation)

```sql
select id, email, role, status from public.team_profiles   -- BEFORE: team_member
where id='a32f998f-2791-446c-b94c-c0ab2c21ff0e';

update public.team_profiles
   set role='super_admin', updated_at=now()
 where id='a32f998f-2791-446c-b94c-c0ab2c21ff0e'
   and role='team_member';                  -- guard: no-op if already elevated

select id, email, role, status from public.team_profiles   -- AFTER: super_admin
where id='a32f998f-2791-446c-b94c-c0ab2c21ff0e';
```

### Statement 3 — `ella@sensoriumneuro.com` NP row: **NO CHANGE**

```sql
-- Per ruling 1 she KEEPS NP access below super_admin, and team_member already is that.
-- Verification only. Expect: team_member / active. NO UPDATE IS ISSUED.
select id, email, role, status from public.team_profiles
where id='f429a463-530d-4d77-b010-0bdf767b6959';
```

### Statement 4 — `Ella@neuroprogeny.com` orphan → linked, `admin`, NP

Satisfies ruling 2 **and** ruling 4 in one row. Nothing is deleted; nothing duplicates.

```sql
select id, user_id, email, role, status from public.team_profiles   -- BEFORE:
where id='91d23bc7-61f1-4787-b023-46bc1015ba6b';                    -- NULL / super_admin

-- Collision check: must return 0 rows before proceeding.
select id, user_id, email from public.team_profiles
where org_id='00000000-0000-0000-0000-000000000001'
  and lower(email)='ella@neuroprogeny.com'
  and id <> '91d23bc7-61f1-4787-b023-46bc1015ba6b';

update public.team_profiles
   set user_id = 'ced3f075-1ec0-4854-9758-5a2e719b2ad3',
       role    = 'admin',
       email   = 'ella@neuroprogeny.com',   -- lowercased: the unique index is on
       updated_at = now()                   -- (org_id, email) and IS case-sensitive
 where id='91d23bc7-61f1-4787-b023-46bc1015ba6b'
   and user_id is null;                     -- guard: only act while still unlinked

select id, user_id, email, role, status from public.team_profiles   -- AFTER:
where id='91d23bc7-61f1-4787-b023-46bc1015ba6b';                    -- ced3f075 / admin

-- Confirm exactly ONE NP row for her account (expect 1):
select count(*) from public.team_profiles
where user_id='ced3f075-1ec0-4854-9758-5a2e719b2ad3'
  and org_id='00000000-0000-0000-0000-000000000001';
```

### Statement 5 — `doug@` live row → `admin`, NP (elevation)

```sql
select id, user_id, email, role from public.team_profiles   -- BEFORE: team_member
where id='aa4ee304-3013-4bfc-9b21-4e58b7da6e10';

update public.team_profiles
   set role='admin', updated_at=now()
 where id='aa4ee304-3013-4bfc-9b21-4e58b7da6e10'
   and role='team_member';                  -- guard

select id, user_id, email, role from public.team_profiles   -- AFTER: admin
where id='aa4ee304-3013-4bfc-9b21-4e58b7da6e10';
```

### Statement 6 — `Doug@neuroprogeny.com` orphan → DELETE

Run **after** Statement 5, so his authority is never momentarily absent.

```sql
select id, user_id, email, role, status from public.team_profiles   -- BEFORE:
where id='ca861a0a-8d6c-408d-86f7-dc11409d681c';                    -- NULL / admin

delete from public.team_profiles
 where id='ca861a0a-8d6c-408d-86f7-dc11409d681c'
   and user_id is null;                     -- guard: never delete a linked row

select id from public.team_profiles         -- AFTER: expect 0 rows
where id='ca861a0a-8d6c-408d-86f7-dc11409d681c';

-- Confirm exactly ONE NP row for Doug's account (expect 1):
select count(*) from public.team_profiles
where user_id='a139491d-fb5a-4b93-8708-35a5c4fd117c'
  and org_id='00000000-0000-0000-0000-000000000001';
```

### Not issued
`cameron@`, `shane@` (`ec05f3ea`) and `paul@` already match target — **no statement
touches them**. `Leigh@` and `wes@` are outstanding — **no statement touches them**.

## 12.8 FINAL TARGET TABLE — complete end state, both orgs

**Row count, in two stages.** Phase 0b (S1–S6, **applied**): 14 → **14** (one inserted by S1, one deleted by S6). Statements 7–8 (**not applied**): 14 → **12**. See §12.9.3 for the full arithmetic and for why the pre-flight gate reads 7 rather than either figure.

| email | user_id | org | role | status | change |
|---|---|---|---|---|---|
| `cameron@neuroprogeny.com` | `22456608` | NP | `super_admin` | active | — |
| `cameron@neuroprogeny.com` | `22456608` | SNW | `team_member` | active | — |
| `cameron.allen@neuroprogeny.com` | `7bfcb19f` | NP | `super_admin` | active | **NEW (S1)** |
| `shane@neuroprogeny.com` | `ec05f3ea` | NP | `super_admin` | active | — *not touched* |
| `shane@neuroprogeny.com` | `ec05f3ea` | SNW | `team_member` | active | — *not touched* |
| `paul@neuroprogeny.com` | `5512c7b9` | NP | `super_admin` | active | — |
| `paul@neuroprogeny.com` | `5512c7b9` | SNW | `team_member` | active | — |
| `ella@neuroprogeny.com` | `ced3f075` | NP | **`admin`** | active | **LINKED + downgraded from `super_admin` (S4)** |
| `ella@neuroprogeny.com` | `ced3f075` | SNW | `team_member` | active | — |
| `ella@sensoriumneuro.com` | `c809b007` | NP | `team_member` | active | — *ruling 1: kept* |
| `ella@sensoriumneuro.com` | `c809b007` | SNW | **`super_admin`** | active | **ELEVATED (S2)** |
| `doug@neuroprogeny.com` | `a139491d` | NP | **`admin`** | active | **ELEVATED (S5)** |
| ~~`Doug@neuroprogeny.com`~~ | ~~NULL~~ | ~~NP~~ | ~~admin~~ | ~~active~~ | **DELETED (S6)** |
| ~~`Leigh@neuroprogeny.com`~~ | ~~NULL~~ | ~~NP~~ | ~~`admin`~~ | ~~invited~~ | **DELETED (S7, §12.9)** |
| ~~`wes@neuroprogeny.com`~~ | ~~NULL~~ | ~~NP~~ | ~~`team_member`~~ | ~~inactive~~ | **DELETED (S8, §12.9)** |

**Resulting Hub authority (linked rows only):**
`super_admin` — `cameron@` (NP), `cameron.allen@` (NP), `shane@` (NP), `paul@` (NP),
`ella@sensoriumneuro.com` (SNW).
`admin` — `ella@neuroprogeny.com` (NP), `doug@` (NP).
Everyone else `team_member`.

**After this set, exactly one `team_profiles` row exists per (person, org)** for every
account that has one — the property that keeps `use-permissions`' `.maybeSingle()` from
failing open.

---

# 12.9 Outstanding orphans resolved — `Leigh@` and `wes@` DELETE

**2026-08-02. Ruled by Cameron. OUTPUT ONLY — nothing applied.**

## 12.9.1 Referential safety check — clean, with a working positive control

**Foreign keys pointing at `team_profiles.id`: NONE.**

The control is emphatic rather than incidental: the same query, run against
`team_profiles`' sibling `team_members`, returns **17** inbound FKs
(`contacts.assigned_to`, `contact_notes.author_id`, `conversations.assigned_to`,
`tasks.assigned_to`, `do_not_contact_list.added_by`, `activity_log.actor_id`,
`response_time_log.team_member_id`, and ten others). So the query matches inbound FKs
correctly, and the empty result for `team_profiles` is a **real absence**, not a
mis-written probe.

**Consequence:** deleting a `team_profiles` row cannot be blocked by a constraint and
cannot cascade into another table.

**Soft (unconstrained) references — checked, also clean.** `team_profiles.id` values are
embedded in `org_settings.setting_value` JSONB: the `crm_pipelines` blob for org NP
carries `team_id` keys and **does** contain `b3010056` (cameron@'s NP row id). That is
the positive control for the soft-reference probe, and it passed. Against the same
blobs:

| id | `crm_pipelines` | `stage_email_script` |
|---|---|---|
| `d7985bfc` (Leigh) | not present | not present |
| `79b1aa04` (wes) | not present | not present |
| `b3010056` (control) | **present** | not present |

**Scope limit, stated rather than glossed:** `public` contains **357** `json`/`jsonb`
columns. A full sweep of all of them was not run. The two checked are the only ones any
Hub code path resolves a `team_profiles.id` from (`stage-emails/route.ts:158` reads
`em.team_id` out of `org_settings.setting_value` where `setting_key='stage_email_script'`;
`crm_pipelines` is the pipeline card config). Combined with zero FKs, residual risk is
low but not formally zero.

**Neither row is referenced. Both deletes are safe to proceed.**

## 12.9.2 OUTPUT-ONLY SQL — NOT APPLIED

Both statements carry a `user_id IS NULL` guard, so a **linked** row can never be caught
by mistake even if an id were mistyped.

### Statement 7 — `Leigh@neuroprogeny.com` → DELETE

```sql
select id, user_id, email, display_name, role, status, created_at   -- BEFORE:
from public.team_profiles                                           -- NULL / admin /
where id='d7985bfc-edb7-4214-bd4d-e93c9c5f182b';                    -- invited

delete from public.team_profiles
 where id='d7985bfc-edb7-4214-bd4d-e93c9c5f182b'
   and user_id is null;          -- GUARD: refuses to touch a linked row

select id from public.team_profiles                                 -- AFTER: 0 rows
where id='d7985bfc-edb7-4214-bd4d-e93c9c5f182b';
```

### Statement 8 — `wes@neuroprogeny.com` → DELETE

```sql
select id, user_id, email, display_name, role, status, created_at   -- BEFORE:
from public.team_profiles                                           -- NULL /
where id='79b1aa04-a1e2-4040-a5f4-757b3491104b';                    -- team_member /
                                                                    -- inactive
delete from public.team_profiles
 where id='79b1aa04-a1e2-4040-a5f4-757b3491104b'
   and user_id is null;          -- GUARD

select id from public.team_profiles                                 -- AFTER: 0 rows
where id='79b1aa04-a1e2-4040-a5f4-757b3491104b';
```

### Whole-set closing check

```sql
-- Expect 0. Only Leigh and wes remain unlinked before this pair runs, and
-- Statements 4 and 6 resolve Ella's and Doug's.
select count(*) as unlinked_rows_remaining
from public.team_profiles where user_id is null;

-- Expect 12.
select count(*) as total_team_profiles_rows from public.team_profiles;
```

## 12.9.3 Reconciling the two counts — 7 vs 12 is NOT a contradiction

The document states two different totals for the same end state. **Both are correct;
they count different populations.** Recorded explicitly so this is not read later as an
inconsistency:

| Figure | Where | Counts | Value after the set |
|---|---|---|---|
| **7** | §12.7 pre-flight gate | Rows **joined to `profiles`** and filtered to `role in ('super_admin','admin')` **and** `status='active'` | **7** |
| **12** | §12.8 final target table | **Every** row in `team_profiles`, any role, any status, linked or not | **12** |

The gate is `... from team_profiles tp join public.profiles p on p.id = tp.user_id ...`.
An **inner join on `user_id`** silently drops every `user_id IS NULL` row, and the
`role`/`status` filter drops every `team_member` row. So the gate was never a row count —
it is an **elevated-and-linked** count, which is exactly what it should be for a lockout
guard.

**This also means deleting `Leigh@` and `wes@` does not change the gate.** Both are
unlinked, so neither was ever counted by it. The gate reads **3 before → 7 after**
regardless of Statements 7 and 8.

### Row arithmetic

```
14  starting point
+1  S1  insert  cameron.allen@            -> 15   APPLIED
-1  S6  delete  Doug@  (unlinked orphan)  -> 14   APPLIED   <-- current state
-1  S7  delete  Leigh@ (unlinked orphan)  -> 13   not applied
-1  S8  delete  wes@   (unlinked orphan)  -> 12   not applied
```

S2, S4 and S5 are updates and do not change the count.

**Verified current state (2026-08-02, after Phase 0b): 14 rows, 2 of them unlinked**
(`Leigh@`, `wes@`). **After S7 and S8: 12 rows, 0 unlinked.**

## 12.9.4 Unrelated discovery — `do_not_contact_list.added_by` is FK'd to `team_members`

Surfaced by the FK control above, and it bears on the **already-committed** Finding 8 fix
(`4b2e3f4`). Reporting rather than acting.

```
do_not_contact_list_added_by_fkey  FOREIGN KEY (added_by) REFERENCES team_members(id)
```

But `bulk-action/route.ts:126` writes `added_by: user.id` — an **`auth.users` id**, not a
`team_members.id`. Measured:

- `team_members` rows: **4**
- `team_members.id` values that are also an `auth.users` id: **0**
- rows where `team_members.id = team_members.user_id`: **0**
- `do_not_contact_list` rows with a non-null `added_by`: **0**

So `added_by: user.id` can **never** satisfy that foreign key. Every bulk `add_to_dnc`
audit insert will raise **23503 foreign key violation**.

**What this means for `4b2e3f4`.** That commit replaced a silent `upsert` (failing 42P10)
with a checked `insert`. The fix does what it claimed — the failure is now **caught,
counted in `dncAuditFailures`, and reported to the operator instead of being swallowed**.
But the audit row still will not be written; only the error code changes, 42P10 → 23503.

**The remaining fix** is to resolve the acting user's `team_members.id` before the insert
and write that (or `null` when the actor has no `team_members` row), rather than
`user.id`. **Not proposed as a diff here** — it is Finding 8 work, and the queue is
paused. Recorded so it is not mistaken for a regression later.

---

# 13. Phase 0 COMPLETE — Phase 1 unblocked

**2026-08-02.**

## 13.1 What was applied

Statements 1–6 of §12.7, run manually in the Supabase SQL Editor. Independently
re-verified read-only from a later session — the figures below are measured, not
reported:

| Check | Expected | Measured |
|---|---|---|
| Pre-flight gate (linked, elevated, active) | 7 | **7** |
| `ced3f075` rows in NP | 1 | **1** |
| `a139491d` rows in NP | 1 | **1** |
| Doug's orphan `ca861a0a` | 0 | **0** |
| `ec05f3ea` NP row | `super_admin`/`active`, untouched | **`super_admin`/`active`** |
| Total `team_profiles` rows | 14 | **14** |
| Unlinked (`user_id IS NULL`) rows | 2 | **2** (`Leigh@`, `wes@`) |

### Resulting Hub authority

| Role | Account | Org |
|---|---|---|
| `super_admin` | `cameron@neuroprogeny.com` | NP |
| `super_admin` | `cameron.allen@neuroprogeny.com` | NP |
| `super_admin` | `paul@neuroprogeny.com` | NP |
| `super_admin` | `shane@neuroprogeny.com` | NP |
| `super_admin` | `ella@sensoriumneuro.com` | SNW |
| `admin` | `ella@neuroprogeny.com` | NP |
| `admin` | `doug@neuroprogeny.com` | NP |

Everyone else holds `team_member` or no row.

## 13.2 The lockout risk is closed

§1 identified the blocking risk: **no existing table could become the Hub's staff list
without locking out a superadmin.** `team_members` would have excluded `paul@`, `doug@`
and `ella@`; `team_profiles` would have excluded `cameron.allen@`.

**That gap is now closed.** Every account intended to hold Hub authority has a linked,
active `team_profiles` row at the correct level in the correct org. Phase 1 — switching
the nine server routes in §3 from `profiles.role` to `team_profiles` — **can no longer
lock anyone out**, because the substrate it will read is complete.

**Phase 1 is unblocked.** It is not started, and nothing in this document authorises it.

## 13.3 Still outstanding

- **`Leigh@` (`d7985bfc`) and `wes@` (`79b1aa04`)** — ruled for deletion, SQL in
  §12.9.2, **not applied**. Both are unlinked, so neither affects the pre-flight gate
  and neither blocks Phase 1. Referential safety re-verified 2026-08-02: **zero**
  inbound FKs on `team_profiles.id` (control: **17** on `team_members`).
- **Phase 1 carries two mandatory companions** (§5, §3): the additive
  `team_profiles_self_read` policy, because both existing policies on `team_profiles`
  require an `org_members` row and a Hub-only person could not otherwise read their own
  row; and **inverting the fail-open default** at `use-permissions.tsx:76,82`, where a
  missing row currently grants full access rather than none. Shipping Phase 1 without
  both would weaken access control, not tighten it.
- **`do_not_contact_list.added_by`** (§12.9.4) — FK'd to `team_members(id)` while
  `bulk-action:126` writes an `auth.users` id. Finding 8 work, queue paused.

## 13.4 Reading the counts — three different numbers, all correct

Recorded once, plainly, because three figures appear in this document for the same state:

| Figure | Source | Counts | Value now |
|---|---|---|---|
| **7** | §12.7 pre-flight gate | Linked rows **only** (inner join to `profiles`), `role in (super_admin, admin)`, `status='active'` | 7 |
| **14** | §12.8 final target table | **Every** row: any role, any status, linked or not | 14 |
| **12** | §12.9.2 closing check | Every row **after** S7 and S8 delete the two unlinked orphans | pending |

The gate's `join public.profiles p on p.id = tp.user_id` is an **inner** join, so it
silently drops every `user_id IS NULL` row; its `role`/`status` filter then drops every
`team_member`. It was never a row count — it is an **elevated-and-linked** count, which
is exactly what a lockout guard should measure.

**Consequence worth stating:** deleting `Leigh@` and `wes@` will move 14 → 12 but will
**not** change the gate, which stays at 7. Neither row was ever counted by it.
