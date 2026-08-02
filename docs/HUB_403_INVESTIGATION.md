# NPU Hub — 403 / 400 Investigation

**Rev 2, 2026-08-02.** Supersedes Rev 1 of the same date.
Full audit record: `H:\My Drive\NPAudits\gate-hub-sms-403-diagnosis.txt`.

Deployment under test: `dpl_9PTGLn6TdF9jWQ2K8Kx1EGshD9Hm`, commit `85b609c`,
deployed 2026-07-26 14:13:56 UTC. Local HEAD equals the deployed commit.

Read-only throughout, `pg_catalog` rather than `information_schema`. Probes whose
passing state is "nothing found" carry a positive control, named inline. No schema
change, migration or commit was executed.

---

## Verdicts

| # | Finding | Verdict | State |
|---|---------|---------|-------|
| 1 | `/api/sms/send` 403s invisible in conversations UI | **PRE-EXISTING** | Confirmed |
| 2a | `org_members.org_id` → manufactured 403 | **PRE-EXISTING** | Confirmed |
| 2b | `org_members.org_id` → invite acceptance 500 | **PRE-EXISTING** | Confirmed |
| 3 | Outbound status callback not completing | **UNDETERMINED** | Open |
| 4 | `crm_twilio_numbers` has no `authenticated` grant | PRE-EXISTING | Latent |
| 5 | Three PostgREST 400s from missing FK relationships | **PRE-EXISTING** | Confirmed |
| 6 | `response_time_log`: four wrong columns, silent return | **PRE-EXISTING** | Confirmed |
| 7 | Merge lost email consent on six contacts | **REGRESSION** | Confirmed |
| 8 | DNC population is software-set; bulk action destroys its own audit row | **PRE-EXISTING** | Confirmed |

Findings 1, 2, 5 and 6 were all wrong on the day they were written (2026-02-15 to
2026-03-16). **Finding 7 is the only confirmed regression**, and it is merge-system
data damage, not r04 fallout.

---

## Corrections to Rev 1

1. The "Tasks / Calls / Relationships load skipped" warnings do **not** come from
   `/crm/conversations`. They come from `contact-detail.tsx`, mounted only on
   `/crm/contacts:726` and `/crm/pipelines:1009`.
2. `response_time_log.contact_id` was wrongly filed as out-of-scope. It is Hub CRM
   code (`recordResponseTime`, called from `/api/sms/send:82`). Now Finding 6.
3. "Worked, then broke" overstated a two-sample base. See Finding 3.

---

## Finding 1 — consent 403 invisible in the UI — PRE-EXISTING

Outbound SMS volume, last 12 weeks: **zero for ten consecutive weeks**
(2026-05-11 → 2026-07-13), then 9 in the week of 07-20 and 2 in the week of 07-27.
No collapse — volume *rose*. A consent change cannot have broken a flow nobody was
using.

`sms_consent`, `email_consent` and `do_not_contact` are all `boolean NOT NULL
DEFAULT false` (control: `id` → `gen_random_uuid()`, `created_at` → `now()`). The
213 unreachable contacts reflect **an absent affirmative signal, not 213 opt-outs**.
Both consented contacts sampled have `sms_consent_at` NULL — consent with no
provenance.

**No consent history exists anywhere.** Scanning all tables/views/matviews for
`%consent%` or `%do_not_contact%` returns only `contacts`, `contact_consents`
(holds only `consent_id`), `identity_graph`, `nr_quiz_results`, `program_reviews`.
Control held. The requested "last 30 consent changes" **cannot be produced** — no
such record is kept.

The UI defect stands: `conversations/page.tsx:216` checks `data.success` and never
`res.ok`, so a 403 renders as nothing at all. The 403 itself is correct and must
not be relaxed.

## Finding 2 — `org_members.org_id` — PRE-EXISTING

Columns: `id, user_id, organization_id, role, created_at, status`. Unique index on
`(user_id, organization_id)`. All three SECURITY DEFINER helpers (`user_org_ids()`,
`get_user_org_ids()`, `get_user_org_id_safe()`) read `organization_id` correctly —
**the RLS org-scoping guard is not implicated.**

- **2a** `cross-org-contacts/route.ts:16,39` (`bf5e391`, 2026-02-24) — drops the
  42703 error and manufactures a 403. Fails for everyone, superadmins included.
- **2b** `invite/[token]/accept/route.ts:99-100` (`0f1d4d8`, 2026-03-16) — both the
  payload key and `onConflict` name a non-existent column; returns 500 at `:105`,
  before the invite is marked used at `:123`.

Read-only confirmation for 2b, as requested: `hub_invites` shows **3 invites, 0 ever
marked used, all expired**, spanning 2026-03-16 → 2026-07-04. Mechanism proven by
schema + code; data corroborating but not conclusive at n=3.

## Finding 3 — status callback — UNDETERMINED, open

Only **two** outbound sends exist after the route was created: 07-27 (delivered) and
08-02 (still queued). **n=2 is not enough to establish a regression.**

- **Exactly one outbound message in the system's entire history has ever recorded a
  delivery outcome.** 10 of 11 remain `queued`.
- `crm_messages` has **no** `updated_at`/`delivered_at`/`status_updated_at`, so *when*
  any status changed cannot be determined at all.
- **Ruled out:** `NEXT_PUBLIC_APP_URL` drift — `NEXT_PUBLIC_*` is inlined by Next.js
  at build time and no rebuild has occurred, so both sends used a byte-identical URL,
  compared against the same inlined value.
- **Ruled out:** the write path. The only trigger, `trg_increment_text_counter`, is
  `AFTER INSERT` and cannot affect the callback's UPDATE; no constraint can reject a
  mapped status. Combined with grants/RLS/BYPASSRLS from Rev 1, the fault is
  **upstream of the database**.

## Findings 4–7

- **4** `crm_twilio_numbers` — only table in its family with no `authenticated`
  grant, carrying a policy that can never fire. Latent; activation conditions and
  failure mode in the audit record.
- **5** Three PGRST200 relationship errors (not 42703 — all columns exist):
  `tasks`→`contacts` and `call_logs`→`contacts` have **no FK at all**;
  `contact_relationships` FKs are named `_from_fk`/`_to_fk`, but the client requests
  `_from_contact_id_fkey`/`_to_contact_id_fkey`. Ledger scan (control: `crm_messages`
  → 5 hits) shows **zero** migrations ever touched either FK name.
- **6** `recordResponseTime` references four non-existent columns; error dropped,
  `if (!pending) return` exits silently. **0 rows against 9 inbound messages** — the
  metric has never recorded anything. Not a rename fix; the table lacks the columns.
- **7** 36 contacts merged in 2026-07; **six lost email consent** (survivor `false`,
  merged-away row `true`). SMS consent was not lost. Pre-fix damage from the defect
  `b38ce55` addresses, never repaired.

---

## The pattern — nine instances

Commit `85b609c` named three. Six more found here: `sms/send:94` warn-only catch;
`conversations:216` `data.success` without `res.ok`; `cross-org-contacts:16,39`
dropped error; `panel.tsx:35` silent `!res.ok`; ten `.catch(warn)` handlers in
`contact-detail.tsx:434-452`; `recordResponseTime` silent return. In every case a
failure and an empty result are indistinguishable to the caller.

---

## Proposals

Exact SQL and exact diffs are in the audit record under **PROPOSALS** (P1, P2a, P2b,
P4, P5, P6, P7). All SQL is output-only per the SQL rule.

### Status — the queue is PAUSED, not abandoned

**P1 is implemented and committed** (Finding 1's UI defect), together with the
`openThread` unread-badge error check flagged alongside it.

**P2a, P2b, P4, P5, P6 and P7 remain open and are deferred by decision, not by
oversight.** They were paused on 2026-08-02 because the messaging path is the current
priority and the remainder is cleanup. Nothing about them has been withdrawn or
invalidated; the diffs and SQL in the audit record stand as written. Two carry
consequences worth restating while they wait:

- **P2b** — the typo is real and the route 500s, but see Finding 9: this is **not** how
  Hub staff are provisioned, and no Hub code even creates the invites it consumes.
  Urgency **downgraded**; it is not blocking Hub onboarding.
- **P7 / Finding 8** — `bulk-action:127` still destroys its own audit row on every bulk
  DNC. Any bulk action taken before that is fixed adds further unattributable rows.

Two need a decision before any diff is written:
- **P6** — delete the dead response-time call, or build the feature properly.
- **P7** — consent restoration for six contacts. Explicitly **not** proposed as
  routine remediation; it is a consent decision requiring human sign-off. Independent
  of that: **do not hard-delete merged-away contact rows** — with no consent history
  table, they are the only surviving evidence.

## Open items

**O1** Vercel Observability log, 2026-08-02 14:12–14:15 UTC, filter `[message-status]`
(`vercel logs` only tails; it cannot replay). **O2** Whether any dashboard presents
`response_time_log`'s empty result as a real measurement. **O3** Whether the three
unused invites were attempted or never clicked. **O4** `crm_messages` has no
`updated_at`; until it does, callback timing is unreconstructable. **O5** The two
phone-holding live DNC contacts (Finding 8) need a Twilio-side check before any repair.

---

# Finding 8 — the DNC population is software-set — PRE-EXISTING

**Question asked:** were the contacts with `do_not_contact = true` set by real opt-outs,
or by software? **Answer: by software. Not one is a verified opt-out.**

## Two corrections to this record

The figure of **61** in Finding 1 was wrong in two ways.

1. It counted only *active* contacts. The true DNC population is **96 rows**.
2. Re-running the identical Rev 2 query now returns **60**, not 61. One row moved
   between sessions. With no history table, **I cannot say which row or why** — which
   is this finding's thesis demonstrated on itself.

## The three writers of `do_not_contact = true`

Exhaustive search of `src/`. There are exactly three, and no others:

| Path | File | Fires |
|---|---|---|
| STOP handler *(the legitimate one)* | `twilio/inbound-sms/route.ts:62-63` | inbound message matches a stop keyword |
| Bulk `add_to_dnc` | `contacts/bulk-action/route.ts:122` | operator bulk action |
| **Merge soft-delete** | `contacts/merge/route.ts:215-217` | **every merge, on the loser, by design** |

The import path **cannot** set it: `do_not_contact` is absent from `CRM_FIELDS`
(`crm/import/page.tsx:25`), so no CSV column can map to it. There is no contacts
import API route at all — only `equipment/import`.

## The count, split three ways

### (1) Genuine opt-outs — do not touch: **0 contacts**

- The only documented genuine STOP in the system is the single `do_not_contact_list`
  row (2026-05-09, recovered 2026-07-26). It explicitly records that **no contact row
  exists for that number**. It is not one of the 96.
- **Zero of the 96 have any inbound message.** The STOP handler cannot fire without one.
- `crm_activity_log` is **completely empty — 0 rows, no event types** (control: total
  count reported). The STOP handler's own logging has never written anything.
- **58 of the 60 live DNC contacts have no phone number at all.** An SMS opt-out was
  physically impossible for them.
- `email_unsubscribed_at` is null for all 96.

**Residual uncertainty is confined to 2 contacts** that hold a phone. Inbound messages
were demonstrably lost during the 2026-07-24 `demo.twilio.com` incident, so absence of
an inbound record is not absolute proof for those two. Check them against Twilio before
touching them.

### (2) Software-set, mechanism certain — but **not** repair candidates: **36 contacts**

All 36 merged-away rows are DNC, set by `merge/route.ts:215-217` as part of the
soft-delete tombstone. This is **correct by design** — a merged-away row should not be
contactable. Do not "repair" these.

Applying the Finding 7 method to `do_not_contact` (restrictive direction):
`survivor_true_loser_false = 0`. **No survivor was made DNC by a merge.** Confirmed by
code as well as data — the merge only ever writes the loser. Finding 7's mirror does
not exist.

### (3) Unattributable: **60 contacts** (the live population)

55 arrived via import batch, 3 without one, 2 hold a phone. The mechanism is narrowed
to bulk `add_to_dnc` or the manual toggle (`contact-detail.tsx:1909`) — **but neither
leaves any evidence**, for the reason below. No per-contact attribution is possible.

## Why no evidence exists — the 10th instance of the pattern

`bulk-action/route.ts:124-127` upserts the audit row with
`{ onConflict: 'org_id,phone' }`. **No unique index on `(org_id, phone)` exists.**
`do_not_contact_list` carries only `do_not_contact_list_pkey` on `(id)` plus two
**non-unique partial** indexes (`idx_dnc_phone`, `idx_dnc_email`).

So that upsert raises **42P10 — "no unique or exclusion constraint matching the ON
CONFLICT specification"** on every call. And:

```js
const { error: updateErr } = await supabase.from('contacts').update({ do_not_contact: true, ... })
if (!updateErr) {
  await supabase.from('do_not_contact_list').upsert({ ... })   // <-- error DISCARDED
  affected++;                                                  // <-- still counts as success
}
```

Line 122's error is checked. **Line 124's is not.** The flag is written, the audit row
never is, and the UI reports success. The bulk DNC action destroys its own provenance
by construction, every time it runs.

This is the **tenth** instance of the pattern, and the most consequential: the other
nine hide failures, this one erases the evidence needed to undo a compliance decision.

## (f) No history table — stated plainly

Confirmed again for `do_not_contact` specifically. There is no audit or history relation
recording changes to it. `do_not_contact_list` is the nearest thing and holds **one row**,
which is not about any of these contacts. `crm_activity_log` is empty. **No change to
`do_not_contact` on any of the 96 can be dated, attributed, or ordered.** Nothing below
infers intent from data that cannot be dated.

## Repair — OUTPUT ONLY, NOT APPLIED

Scope deliberately excludes all 36 merge tombstones and both phone-holding contacts.
That leaves the **58 live, no-phone contacts** for which an SMS opt-out was impossible.

**Pre-check — run first and read the output:**

```sql
select count(*) as will_be_cleared
from public.contacts
where do_not_contact = true
  and merged_into_id is null
  and (phone is null or phone = '');
-- expect exactly 58. If it is not 58, STOP: the population has shifted since
-- 2026-08-02 and this finding must be re-derived before anything is written.
```

**Repair, only if the pre-check returns 58:**

```sql
update public.contacts
   set do_not_contact = false,
       updated_at     = now()
 where do_not_contact = true
   and merged_into_id is null
   and (phone is null or phone = '')
   and id in (
     -- paste the explicitly reviewed ids; do NOT run this open-ended
   );
```

### What would make this repair unsafe

1. **Running it without the `id in (...)` restriction.** The predicate alone will sweep
   any row that later matches, including future ones.
2. **Running it before the consent audit table from P7 exists.** This repair reverses a
   compliance decision. Doing that with no record is how the current unattributable
   state was created — it would be the same mistake in the opposite direction.
3. **Including either phone-holding contact.** Their inbound history could have been
   lost in the 2026-07-24 incident. Clear them individually against Twilio's own logs.
4. **Running it while `bulk-action:127` is still broken.** Any subsequent bulk DNC will
   again write the flag with no audit row, and the population becomes unattributable
   again immediately. **Fix the upsert first.**
5. **Assuming DNC was wrong.** Nothing here shows these contacts *should* be contactable —
   only that no opt-out evidence exists. A scraped-list contact who was never asked is
   not the same as one who consented. Finding 1 applies: absent consent is not consent.

### Minimum code fix so this cannot recur

`bulk-action:124-127` needs both an error check and a valid conflict target. The
conflict target requires a unique index that does not currently exist — a schema change
needing approval, and note that `phone` is null for 90 of 96 rows, so a unique index on
`(org_id, phone)` would not constrain them anyway. **Proposed as a decision, not a diff.**

---

# Finding 9 — Hub vs platform role scope; Finding (e) WITHDRAWN

A prior session reported that "one admin and one facilitator" lacked `org_members`
rows and were therefore silently unable to edit contacts, framed as "works for
Cameron, fails for Shane." **That finding was wrong and is withdrawn.** The
correction matters more than the fix, because the error was a scope breach that
happened *without leaving the repo* — `org_members` is a shared table serving both
`npu-hub-v2` and `npu-platform-v2` in database `htfrfaxlcuyawtlztxxm`.

**The specific mistake:** the query grouped **`profiles.role`** but the conclusion was
stated as if it described `org_members`. Those are two different vocabularies:

| Column | Values present |
|---|---|
| `org_members.role` | `participant` (10), `member` (5), `admin` (4), `owner` (2) |
| `profiles.role` | `participant` (24), `superadmin` (4), `admin` (3), `facilitator` (2) |

`member` and `owner` appear nowhere in Hub role logic.

## 1. The Hub's role set, from Hub code

`STAFF_ROLES = new Set(['admin','superadmin','facilitator'])` — defined identically in
five Hub routes: `comms/caller-lookup:14`, `comms/conversation/archive:23`,
`contacts/duplicates:28`, `crm/stage-emails:42`, `voice/receiver-token:23`.
`ADMIN_ROLES = new Set(['admin','superadmin'])` — `src/lib/org-settings-keys.ts:33`.

It is resolved from **`profiles.role`**, not `org_members.role` —
`comms/conversation/archive/route.ts:52-55` reads
`profiles.select('role').eq('id', user.id)` then tests `STAFF_ROLES.has(role)`.

**On the premise that facilitator is not a Hub role: Hub code does not support that.**
`facilitator` is in `STAFF_ROLES` in all five routes above and is listed in the Hub's
own `CLAUDE.md`. The Hub grants facilitators staff access deliberately. What the Hub
never reads is `org_members.role` as an authorisation input — it uses `org_members`
only to test membership *existence* (`.select('id')`).

## 2. Finding (e) re-run, Hub-relevant accounts only — ZERO affected

The two accounts previously flagged:

| Account | `profiles.role` | org_members | team_members | What it is |
|---|---|---|---|---|
| `npu-notifications@neuroprogeny.com` | facilitator | no | no | **service account** — id `facade00-0000-0000-0000-000000000001`, a sentinel UUID. Not a person. |
| `admin@neuroprogeny.com` | admin | no | no | generic account, never provisioned, no Hub staff record |

Neither is a human Hub staff member. For both, being unable to edit CRM contacts is
**correct behaviour, not a defect.**

Every actual Hub staff account passes:

- `cameron@`, `cameron.allen@`, `shane@`, `paul@` — all **superadmin**, which
  short-circuits the policy. **Shane, the named example, was never at risk**: he holds
  both an `org_members` row and an active `team_members` row. The framing was backwards.
- `doug@` (admin), `ella@` (admin), `cameron.s.allen+facilitator1@` (facilitator, a test
  account) — all hold `org_members` rows for org `…0001`, which owns **317 of 318**
  contacts.

**Zero genuinely Hub-relevant accounts are affected. Finding (e) is withdrawn.**

Residual, trivial and arguably correct: `doug@` is not a member of org
`b9fd8b2e…`, which owns exactly **1** contact, so he would be refused on that one row.
That is the policy working as designed.

## 3. The mechanism survives, independent of the withdrawn examples

`contacts_org_rls` governs `contacts`, a Hub CRM table, so the analysis is Hub-scoped
regardless. The chain is unchanged and real:

> `profiles.role` ∈ {admin, facilitator} **and** an `org_members` row for the contact's
> org — else the UPDATE matches zero rows → `.select().single()` raises PGRST116 →
> `updateContact` throws → previously an unhandled rejection in an `async` onClick,
> indistinguishable from success.

What changed is only that **nothing is currently tripping it.** The defect it would
expose is latent, not live, and the contact-detail fix closes it either way.

**Error wording corrected accordingly.** PGRST116 means "zero rows matched" and does
*not* by itself prove a permission denial — a removed, archived or merged-away row
produces it too. The message no longer asserts "you do not have permission."

## 4. P2b re-assessed on Hub grounds — urgency DOWNGRADED

The typo at `invite/[token]/accept/route.ts:99-100` is real and the route is Hub code.
But it is **not the Hub staff provisioning path**:

- **No Hub code creates a `hub_invites` row.** `hub_invites` is referenced in exactly two
  files, both read-only consumers: `invite/[token]/route.ts:14` and
  `accept/route.ts:25,123`. There is no insert anywhere in `src/`. All three existing
  rows were created outside the application.
- **Accepting an invite does not make anyone Hub staff.** It writes `org_members` and
  `team_profiles` only. It never sets `profiles.role` and never creates a
  `team_members` row — and `profiles.role` is precisely what every Hub `STAFF_ROLES`
  gate reads. An accepted invite therefore grants org membership, not Hub staff access.
- The three invites are `participant`/`participant`/`admin`; two target org
  `b9fd8b2e…`, not the Hub's main org.

**Conclusion: P2b does not block Hub onboarding and must not be promoted on that basis.**
It remains a genuine bug worth fixing when the queue resumes — a 500 on a live route —
but the "blocks all onboarding" claim in earlier revisions was wrong and is retracted.

## Lesson for the scope gate

The repo boundary was never crossed, so the gate never fired. `org_members`,
`profiles`, `contacts` and `conversations` all live in one shared database serving
three applications. **Staying inside `npu-hub-v2` is not sufficient to stay inside Hub
scope.** Any finding drawn from a shared table must state which application owns the
rows it reasons about, and must name the column it actually queried.
