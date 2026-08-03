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
| 3 | Outbound status callback not completing | **UNDETERMINED** | **Open — narrowed 2026-08-02** |
| 4 | `crm_twilio_numbers` has no `authenticated` grant | PRE-EXISTING | Latent |
| 5 | Three PostgREST 400s from missing FK relationships | **PRE-EXISTING** | Confirmed |
| 6 | `response_time_log`: four wrong columns, silent return | **PRE-EXISTING** | Confirmed |
| 7 | Merge lost email consent on six contacts | **REGRESSION** | Confirmed |
| 8 | DNC population is software-set; bulk action destroys its own audit row | **PRE-EXISTING** | Confirmed |
| 8b | `do_not_contact_list` cannot record the actor or the contact | **PRE-EXISTING** | Confirmed |
| 10 | Call transcripts captured + displayed; gap is calls stuck at `ringing` | **NOT A DEFECT (pending)** | See Finding 10 |
| 11 | Accounting RLS: no org scoping, no role check on `acct_*` | **SECURITY — DEFERRED** | Confirmed |
| 12 | Deleted `acct_payments` row leaves no record it existed | **SECURITY — DEFERRED** | Confirmed |

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

---

# Finding 8b — `do_not_contact_list` is structurally unable to record a suppression

**2026-08-02. The schema is wrong, not the code.** SQL below is OUTPUT ONLY and
**NOT APPLIED**.

Finding 8 established that bulk DNC destroyed its own audit row via a 42P10 from a
non-existent `onConflict` target, and commit `4b2e3f4` made that failure visible. It did
not make the write succeed. Two further defects, both structural, are why.

## Defect 1 — `added_by` cannot record most actors

```
do_not_contact_list_added_by_fkey  FOREIGN KEY (added_by) REFERENCES team_members(id)
```

`bulk-action:126` writes `added_by: user.id` — an **`auth.users`** id. Measured:

- `team_members` rows: **4** (it is a CRM assignment roster, carrying `auto_assign_weight`)
- `team_members.id` values that are also an `auth.users` id: **0**
- rows where `team_members.id = team_members.user_id`: **0**

So the FK can **never** be satisfied by what the application writes, and `4b2e3f4`
changed the error from 42P10 to **23503** without closing the provenance gap.

**It is not fixable in code.** Of the **7** accounts now holding Hub authority, only
**3** have a `team_members` row. The four who do not — `doug@`, `ella@neuroprogeny.com`,
`ella@sensoriumneuro.com`, `paul@` — could never be recorded as the actor. Resolving the
actor to a `team_members.id` and writing `null` on miss would silently lose provenance
for the majority of operators, which is the defect Finding 8 exists to close.

**A column that can record 3 of 7 actors is a broken column.**

Precedent for the correct target already exists in this schema:
`crm_messages_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES auth.users(id)`.

## Defect 2 — the row cannot identify who was suppressed

`do_not_contact_list` has **no `contact_id`**. Columns: `id, org_id, phone, email,
reason, added_by, created_at`. The suppressed party is identified by phone/email only.

Measured over active contacts (`archived_at is null and merged_into_id is null`):

| Measure | Count |
|---|---|
| Active contacts | 282 |
| **Neither phone nor email** | **153** |
| No phone | 225 |
| **Currently DNC and unidentifiable** | **54** |

**More than half of all suppression rows would name nobody.** This also breaks reading,
not just writing: `isDNC` (`crm-server.ts:14-18`) matches with
`.or('phone.eq.X,email.eq.Y')`, which cannot match a contact that has neither.

## OUTPUT-ONLY SQL — migration 203, NOT APPLIED

Hub band per CLAUDE.md §13.1 (200+; 202 is taken). Confirm against **both** repos before
assigning the number.

```sql
-- ── PRE-CHECK. Run first and read the output. ────────────────────────────────
select count(*)                                                   as total_rows,
       count(*) filter (where added_by is not null)               as rows_with_added_by,
       count(*) filter (where added_by is not null
                          and added_by not in (select id from auth.users)) as would_violate_new_fk
from public.do_not_contact_list;
-- Expect total_rows = 1, rows_with_added_by = 0, would_violate_new_fk = 0.
-- If would_violate_new_fk > 0, STOP: those rows must be resolved before step 1.

-- ── 1. Repoint added_by to the identity the application actually has. ────────
alter table public.do_not_contact_list
  drop constraint do_not_contact_list_added_by_fkey;

alter table public.do_not_contact_list
  add constraint do_not_contact_list_added_by_fkey
  foreign key (added_by) references auth.users(id) on delete set null;

-- ── 2. Identify WHO was suppressed. ──────────────────────────────────────────
-- on delete SET NULL, never CASCADE: deleting a contact must not erase the record
-- that they asked not to be contacted. The suppression outlives the contact row.
alter table public.do_not_contact_list
  add column if not exists contact_id uuid
  references public.contacts(id) on delete set null;

create index if not exists idx_dnc_contact
  on public.do_not_contact_list (contact_id) where contact_id is not null;

comment on column public.do_not_contact_list.contact_id is
  'The contact this suppression was recorded against. Added 2026-08-02 (Finding 8b): '
  'the table previously identified the party by phone/email only, and 153 of 282 active '
  'contacts have neither, so most suppression rows identified nobody. NULL means the '
  'contact row was deleted after the fact; the suppression still stands.';

comment on column public.do_not_contact_list.added_by is
  'auth.users id of the operator who recorded this. Repointed from team_members(id) on '
  '2026-08-02 (Finding 8b): team_members is a 4-row assignment roster and could record '
  'only 3 of 7 Hub-authority operators. Nulled if that auth user is deleted — the actor '
  'is ALSO written into reason as text so provenance survives.';

-- ── 3. VERIFY (both must hold) ───────────────────────────────────────────────
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.do_not_contact_list'::regclass and contype='f';
-- expect added_by -> auth.users(id), org_id -> organizations(id)

select attname, format_type(atttypid, atttypmod) from pg_attribute
where attrelid='public.do_not_contact_list'::regclass and attname='contact_id';
-- expect: contact_id | uuid
```

## Ordering — SQL FIRST, then deploy

The code change writes `contact_id` and relies on the repointed FK.

- **SQL applied first, then deploy** — correct. Both writes land.
- **Deploy first** — every bulk DNC audit insert fails: `PGRST204` (unknown column
  `contact_id`) or `23503`. The contact flag still sets, the failure is **counted and
  reported** by the `4b2e3f4` handler, and nothing is silently lost. Recoverable, but
  no audit rows are written until the SQL runs.

Failing in that direction is acceptable precisely because `4b2e3f4` made it visible.

## Why the actor is written twice

`added_by` is a reference and is nulled if that auth user is ever deleted. `reason` now
carries `Bulk action by <email>` as text. A compliance record must not lose its actor
because an employee account was later removed.

## Scope note

`do_not_contact_list` is referenced in the Hub at `crm-server.ts:14` (read, via `isDNC`)
and `bulk-action:143` (write), plus the `auditor` manifest. Its RLS policy
(`do_not_contact_list_org_policy`) scopes on `user_org_ids()`, i.e. `org_members` —
shared. **The platform repo was not read**, so I cannot rule out a platform-side reader.
Both changes are additive or FK-widening: adding a nullable column and broadening
`added_by` from a 4-row roster to `auth.users` cannot invalidate an existing reader.

---

# Finding 3 (update) and Finding 10 — status callback vs call transcripts

**2026-08-02, read-only. No code changed, no SQL executed.** Connector verified:
`transaction_read_only = on`, `supabase_read_only_user`, project `htfrfaxlcuyawtlztxxm`.

---

## PART A — Finding 3 remains OPEN, but is now much narrower

### A1. Current state — three more sends today, all still `queued`

| Sent (UTC) | Direction | Status | To |
|---|---|---|---|
| 2026-08-02 19:55:24 | inbound | **`received`** | +18284155050 |
| 2026-08-02 19:54:26 | outbound | **`queued`** | +13212772527 |
| 2026-08-02 16:59:04 | inbound | **`received`** | +18284155050 |
| 2026-08-02 16:58:09 | outbound | **`queued`** | +13212772527 |
| 2026-08-02 14:12:08 | outbound | **`queued`** | +18287347558 |

Whole history: outbound **`queued` = 12**, **`delivered` = 1** (2026-07-27 only).
Inbound `received` = 11.

**A2: the callback is NOT working. Finding 3 does not resolve.** Three sends through
the deployed build sat unchanged for up to 9.5 hours.

### The decisive new evidence: inbound works, outbound status does not

An inbound message was written at **19:55:24**, **58 seconds after** an outbound send
that is still `queued`. So on the same deployment, in the same minute:

- Twilio **can** reach the Hub.
- A Twilio callback **can** pass signature validation and write to the database.
- `/api/twilio/*` is reachable unauthenticated — confirmed in
  `supabase-middleware.ts:20-27`, which lists `pathname.startsWith('/api/twilio')` as a
  public path, so middleware does not redirect it to `/login`.

That eliminates the whole class of "Twilio cannot reach us" and "the Hub rejects Twilio
callbacks" explanations.

### A4. The send-side construction is sound

- `sendOrgSms` (`twilio-org.ts:193,204`) sets
  `statusCallback = ${appUrl}/api/twilio/message-status`, where
  `appUrl = NEXT_PUBLIC_APP_URL || https://VERCEL_URL`.
- `/api/twilio/message-status` **exists in this repo** —
  `src/app/api/twilio/message-status/route.ts`, shipped in `85b609c`.
- The route validates against `${NEXT_PUBLIC_APP_URL}/api/twilio/message-status`
  (`message-status:67`) — the **same env var**, inlined at build time on both sides, so
  the two strings cannot drift within one build.

### A red herring, named and dismissed

`twilio.validateRequest` appears **exactly once** in the Hub —
`message-status/route.ts:68` — and the working inbound route does not call it. That
asymmetry looks damning and is **not** the cause: `inbound-sms:36` calls
`validateTwilioSignatureWithToken`, which (`twilio.ts:67-75`) is a **thin pass-through**
to the same `validateRequest(authToken, signature, url, params)` with identical argument
order. Both routes validate the same way. Recorded so it is not re-investigated.

### What is left, and what I cannot obtain

Everything on the Hub side that can be checked statically is sound. Two candidates
remain, and **neither can be discriminated from inside this repo or the database**:

1. **Twilio never calls the status callback.** Sends go through a **Messaging Service**
   (`org_settings.crm_twilio.messaging_service_sid`, `MG…`). A Messaging Service carries
   its own status-callback configuration, and its interaction with the per-message
   `StatusCallback` parameter is a Twilio-side precedence question. A change to that
   configuration between 2026-07-27 (the one delivery) and 2026-08-02 would explain the
   whole pattern.
2. **Twilio calls it and gets a non-2xx** — signature rejection despite the analysis
   above, or a runtime error.

### A3. EVIDENCE NEEDED FROM YOU — two items

**(i) Vercel Observability → Runtime Logs.** Filter `[message-status]`, time range
**2026-08-02 19:54–19:58 UTC** (the 19:54:26 send; also try 16:58–17:02 and 14:12–14:16).

| What appears | Meaning |
|---|---|
| `SIGNATURE REJECTED` | Twilio called; compare the printed `reconstructed_url=` against `twilio_called_host=`. A difference is the bug outright. |
| `no crm_messages row for sid` | Callback arrived and validated; the SID lookup failed. |
| `update failed for sid` | Callback arrived, matched, and the DB write failed. |
| **Nothing at all** | **Twilio never called.** Cause is Twilio-side config, and candidate 1 is confirmed. |

**(ii) Twilio Console → Messaging → Services → the `MG…` service → its status-callback
setting**, plus Monitor → Logs → Errors for 2026-08-02 (look for **11200** HTTP retrieval
failure). If the Messaging Service has its own callback URL configured, that is almost
certainly the answer.

---

## Finding 10 — call transcripts: captured, displayed, and NOT sharing Finding 3's cause

### B1. What exists

**Storage** — all on `call_logs`: `transcript` (text), `transcription_status` (text),
`recording_url`, `recording_sid`, `recording_duration_seconds`.

**Write paths**, both Twilio callbacks:
- `/api/twilio/recording-ready` — stores `recording_url`/`recording_sid`/duration, flips
  `status` to `voicemail`, sets `transcription_status='pending'`.
- `/api/twilio/transcription` — Twilio's `transcribeCallback`; matches `call_logs` on
  `external_call_sid` and writes `transcript` + `transcription_status`.

**Measured** (positive control: 16 total `call_logs` rows, so zero counts are real):

| Measure | Count |
|---|---|
| Total `call_logs` | 16 |
| With `recording_url` / `recording_sid` | **8** |
| With `transcription_status` | **8** |
| **With actual transcript text** | **2** |
| Latest call log | 2026-07-31 19:45:12 |
| Latest recording | **2026-07-21 16:33:52** |
| Latest transcript | **2026-07-21 14:10:26** |

Breakdown:

| `status` | `transcription_status` | n | Latest |
|---|---|---|---|
| `ringing` | **null** | **8** | 2026-07-31 19:45 |
| `voicemail` | `failed` | 3 | 2026-07-21 11:32 |
| `voicemail` | `pending` | 3 | 2026-07-21 16:33 |
| `voicemail` | **`completed`** | **2** | 2026-07-21 14:10 |

### B2. CAPTURED, not merely undisplayed — and the pipeline demonstrably worked

Two rows carry real transcript text. The recording callback fired 8 times. **The seam
works end to end.** This is not "captured but not displayed", and it is not "never
captured". It is **"worked, then stopped receiving input"**.

**Root cause of the gap since 2026-07-21: no call has reached voicemail since.** All 8
subsequent inbound calls sit at `status='ringing'` with `transcription_status` NULL —
they never progressed to the `<Record>` verb, so no recording callback was ever due and
no transcription was ever expected. `/api/twilio/call-status` is what moves a call off
`ringing` (`call-status:23,37,43` updates rows `.in('status', ['ringing','in-progress'])`).

**Two readings, and I cannot discriminate them from here:**

- **(a) Benign.** Callers rang, nobody answered, they hung up before voicemail. Eight
  abandoned calls over ten days is entirely plausible for this volume. Nothing is broken.
- **(b) Broken.** `/api/twilio/call-status` is not firing, so calls are stuck at
  `ringing` in the database while actually completing at Twilio.

**What discriminates them:** Twilio Console → Monitor → Logs → Calls for 2026-07-22 →
2026-07-31. If those calls show a real duration and a recording at Twilio but the Hub
still says `ringing`, it is (b). If they show as no-answer/canceled, it is (a) and there
is nothing to fix.

### B3. Does this share Finding 3's subsystem? NO — and the evidence is direct

Both are Twilio→Hub callbacks under `/api/twilio/*`, so the suspicion is reasonable. It
is wrong:

- **Neither `recording-ready` nor `transcription` validates a Twilio signature.**
  `validateRequest` occurs only in `message-status:68` (grep across
  `src/app/api/twilio/`). `transcription/route.ts` parses the body and writes with no
  signature check at all. So whatever affects signature validation **cannot** affect them.
- **They have succeeded far more recently and far more often than `message-status`.**
  8 recording callbacks and 2 transcription callbacks landed, versus **one** successful
  status callback in the system's entire history.

**These are two independent problems. Fixing one will not fix the other.** Worth stating
plainly, because "both are Twilio callbacks" is exactly the kind of shared-cause guess
that would have merged them.

### B4. The UI surface exists and is complete

`src/components/crm/comms-timeline.tsx:115-145` renders a voicemail entry as an
authenticated audio player (`/api/comms/recording/[id]`) plus the inline transcript, with
three distinct states:

- `:137-138` — transcript present → renders the text
- `:139-142` — `transcription_status === 'pending'` → pending indicator
- `:143` — `transcription_status === 'failed'` → failed indicator

It is mounted where it should be: `conversations/page.tsx:19` imports `buildTimeline` and
`TimelineStream`, and `contact-detail.tsx` uses the same timeline. **A transcript that
exists will display today.** No UI work is required.

### Secondary observation — transcription reliability

Of 8 voicemails: **2 completed, 3 failed, 3 still `pending`** (the callback never
arrived). Even while the flow worked, roughly a quarter succeeded. The route's own
comment (`transcription/route.ts:12-13`) calls Twilio's built-in transcription
"English-only + best-effort … swappable when we want higher accuracy", so this is a known
v1 trade-off rather than a defect — but the numbers are worth recording before anyone
concludes transcription is reliable.

---

## Summary

| Part | Verdict | Root cause | Blocked on |
|---|---|---|---|
| **A — Finding 3** | **OPEN** | Not determinable from the Hub. Send construction, route existence, middleware exclusion and signature logic all verified sound. Inbound callbacks prove reachability and validation both work. | Vercel `[message-status]` log **and** the Twilio Messaging Service status-callback setting |
| **B — Finding 10** | **RESOLVED as a question** | Transcripts are captured and displayed; the pipeline worked through 2026-07-21. The gap since is that **no call has reached voicemail** — 8 inbound calls stuck at `ringing`. | Twilio Call logs for 2026-07-22→31, to tell abandoned calls from a stalled `call-status` callback |

**No fixes proposed, per the brief.**

---

# Finding 11 — Accounting tables have no org scoping and no role check in RLS

**SECURITY. Recorded 2026-08-03. NOT fixed — deliberately deferred to its own session.**

Surfaced while investigating the Accounting service-delete feature. It is **not** caused
by that work and was **not** fixed by it, because a change to these policies needs the
same care as the R0.4 lockdown series and must not ride along with a feature change.

## The policies

All three Accounting tables carry a single permissive policy, `cmd = ALL`, role `{public}`:

| Table | Policy | `USING` | `WITH CHECK` |
|---|---|---|---|
| `acct_services` | `acct_services_auth` | `(auth.uid() IS NOT NULL)` | *(none)* |
| `acct_payments` | `acct_payments_auth` | `(auth.uid() IS NOT NULL)` | *(none)* |
| `acct_clients` | `acct_clients_auth` | `(auth.uid() IS NOT NULL)` | *(none)* |

RLS is **enabled** on all three — this is not a missing-policy case. The policy grants
every authenticated user full read and write on every row.

## What that means

- **No org scoping.** Nothing in the policy references `org_id`. Org isolation exists
  **only in client-side query builders** — `page.tsx:1610-1612` appends
  `.eq('org_id', orgId)` to each `select`. A predicate in application code is a display
  filter, not a boundary.
- **No role check.** Not `team_profiles`, not `profiles.role`, not `org_members`. The bar
  is "is logged in".
- **No `WITH CHECK`.** Even where `USING` gates reads, inserts and updates are
  unconstrained, so a row can be written with any `org_id`.

**Consequence:** any authenticated user of either application — including a platform
participant with no Hub authority at all — can read or write **every accounting row in
both orgs** by calling PostgREST directly. The Hub UI never shows them the other org's
data, but the UI is not what enforces it.

Scope note per Finding 9: `acct_services`, `acct_payments` and `acct_clients` are
**Hub-owned** (only `ehr/accounting/page.tsx` touches them in this repo). But `auth.uid()`
is satisfied by **any** account in the shared database `htfrfaxlcuyawtlztxxm`, which
serves three applications — so the exposed population is far wider than Hub staff. The
platform repo was not read; I cannot say whether anything there touches these tables.

## Live data at risk

Measured 2026-08-03: **59 `acct_services` rows and 76 `acct_payments` rows**, all
belonging to SNW (`b9fd8b2e-…`). Neuro Progeny (`00000000-…-0001`) currently holds zero
accounting rows, so today the exposure is one org's financial records — client names,
service amounts, payment history and payout splits.

## Why this is not fixed here

1. It is a **security posture change**, not a feature. It belongs with the R0.4 work that
   produced `contacts_org_rls` and the `r03`/`r04` revoke batches, and deserves the same
   before/after verification.
2. **Hub authority is mid-migration.** `HUB_ROLE_DECOUPLING.md` Phase 1 is unstarted, and
   the correct predicate depends on its outcome. Writing an `org_members`-based policy now
   would create exactly the coupling Phase 2 removes; a `team_profiles`-based one
   pre-empts Phase 1.
3. **The blast radius is the whole Accounting module** — dashboard, payouts,
   reconciliation, reports — all reading through the browser client. A policy that is
   even slightly too strict takes the module offline for its only real user.

## What a fix would need to establish first

- Which predicate: `team_profiles` (Hub authority, post-Phase-1) or org membership.
- Whether any non-Hub application reads these tables — **requires reading the platform
  repo**, which was out of scope here.
- Whether service-role API routes should replace the direct browser writes, as the CRM
  routes do. That is the larger correction: `page.tsx` performs **every** accounting
  write from the browser under the anon key, so RLS is the only control there will ever
  be until that changes.

**Do not fix in a feature branch. Give it a session.**

---

# Finding 12 — A deleted accounting payment leaves no record that it existed

**SECURITY / DATA-INTEGRITY. Recorded 2026-08-03. NOT fixed — deferred, like Finding 11.**

Surfaced while revising the Accounting service-delete feature (`2a8e3c7`, revised in the
follow-up commit that records this finding). Closely related to Finding 11: both concern
the same unprotected module.

## No audit trail, and nothing fires on DELETE

- **`acct_payments` has no audit trail.** The database contains 19 audit-style relations
  (`audit_log`, `activity_log`, `crm_activity_log`, `snw_audit_log`, `nr_audit_log`,
  `integration_audit_log`, `contact_merge_log`, and others — this is the positive control
  proving the scan works). **None of them is `acct_*`.**
- **The only trigger on `acct_payments` is `acct_payments_splits_trigger`, which is
  `AFTER INSERT OR UPDATE OF amount, payment_date, service_id`.** Nothing fires on
  `DELETE`.
- **Nothing depends on a payment.** Zero inbound foreign keys (control: 4 outbound FKs
  returned by the same query). So a delete cascades to nothing, and equally leaves nothing
  behind.

**A deleted payment is unreconstructable from this database.**

## What a deletion changes

The row carries the money *and* its derived state:
`id, org_id, service_id, client_id, amount, payment_date, notes, split_snw, split_clinic,
split_dr, clinic_id, payout_date, payout_period, is_paid_out, created_at`.

Deleting one silently changes:

- the client's **Paid total and balance**;
- **`split_snw`, `split_clinic`, `split_dr`** — the entire payout calculation for that
  payment;
- the **payouts view**, the **reconciliation view**, and the **reports view**;
- **reconciliation against `acct_checks`**, once payouts are being marked.

## Authorization

**RLS only, and the policy is `USING (auth.uid() IS NOT NULL)`** — see Finding 11. No org
scoping, no role check, no `WITH CHECK`. Any authenticated user of the shared database can
delete any payment in either org via direct PostgREST. In the UI it is one click behind a
`confirm()`, reachable from three places (`page.tsx:474`, `:489`, `:524`).

## Current exposure, measured 2026-08-03

| Measure | Value |
|---|---|
| `acct_payments` rows | **76** |
| Total amount | **$125,666.00** |
| With computed splits | **76 (all)** |
| With a `payout_date` | 76 (all) |
| Flagged `is_paid_out` | **0** |

**The zero is timing, not protection.** No payout has been marked complete *yet*. The
moment payouts start being flagged, deleting a payment silently desynchronises the books
from `acct_checks` — the check still records money paid out against a payment that no
longer exists, and nothing anywhere records that it ever did.

## This change increases reachability — deliberately

The revised service-delete behaviour **refuses** to delete a service while payments are
attached, and tells the operator to remove those payments first. That is the correct
safety property for the `ON DELETE CASCADE` on `acct_payments.service_id` — the cascade
never fires — **but it actively routes operators toward deleting payments by hand.**

**This was an accepted tradeoff, not an oversight.** The alternative considered was
archiving the service instead, which was rejected because the case being solved is a
service added to the *wrong client*, and archiving leaves that mistake on the client's
record permanently. Deleting a payment through the UI was already possible from three
places before this change; the change makes it a more common path.

Mitigation shipped alongside: `deletePayment` now checks both its error and its row count
(`page.tsx`), so a failed payment delete is visible rather than silent. That fixes the
*reporting*, not the *destructiveness*.

## Likely fix — for a future session

1. **Soft delete on `acct_payments`** (a `deleted_at` timestamptz, filtered out of every
   read and every derived total), or
2. **An `acct_*` audit trail** capturing before-images on delete — a table plus a
   `BEFORE DELETE` trigger, which is the only form that survives a direct PostgREST call
   bypassing the UI entirely.

(2) is the stronger option precisely because Finding 11 leaves the table writable by any
authenticated user: an application-level soft delete protects only operators who go
through the app.

**Related to Finding 11.** Both concern the same module, both are ultimately caused by
`acct_*` having no authorization beyond "is logged in" and no record of what was changed.
They should be scoped together, and neither should ride along with a feature change.
