# CURRENT

Running state of in-flight Hub work. Newest first.

---

## 2026-09-03 — Accounting CRM enrol: fixed and deployed, repair held

**Status: shipped to production. Awaiting confirmation from the operator. Migration 206 deliberately NOT applied.**

| | |
|---|---|
| Deployed SHA | `970ca1365df90246c6c74fee6d466932b41908ce` |
| Alias | https://hub.neuroprogeny.com |
| Deployment | `dpl_5dBMySqZVbnrLwMpXnc3h33sehbu` · Ready |
| Commits | `06c89ed` (routes), `970ca13` (session hardening) |

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

### HELD — migration 206

`supabase/migrations/206_repair_accounting_crm_links.sql` — **written, reviewed, NOT
applied, NOT committed.** Held until Ella's path is confirmed working. It blocks nobody.

Measured 2026-09-03: 18 NP clients, 12 with payments.

- **S1** relink 2 enrol orphans (Adam Hill, Dylan Constance — each matches exactly one
  non-merged NP contact by name)
- **S2** null 2 dangling links (Mary-Lynn Manley, Elizabeth Nelson — targets absent, not
  merged; no surviving name match)
- **S3** move the 1 off-pipeline `'Paid'` contact to `'Paid/ payment plan'`

**Stage-move failures needing repair: 0.** Eleven NP clients sit at a non-paid stage, but
nine are at *later* stages — legitimate forward progress that must not be rewound. The
silent defect was real; it left no repairable damage.

**Not repaired, needs a person:** four 2026-09-03 rows with no contact and no name match —
`Megan Pomphrey` twice 27 minutes apart (a retry after the error, so one is a duplicate),
`Megan`, and `jhtf`. SQL would mint one duplicate and two junk NP contacts.

### Open / filed

- **`sensoriumwalk@` and `admin@neuroprogeny.com` have no `team_profiles` row in either
  org.** They will now get a named 403 where the UI still shows them the button (the UI
  fails open: middleware only redirects on `status='pending'`, and
  `use-permissions.tsx:76,82` returns `true` when the row is missing). If either is a real
  operator that is a provisioning act — one row — not a code change.
- **`acct_clinics.crm_org_id`** — durable replacement for the server-side NP constant. All
  three clinics carry Sensorium in `acct_clinics.org_id`, *including* the NP one, so the
  target cannot be read from the row today.
- **`acct_clients.enrolled_contact_id` is `text` with no FK** to `contacts.id` (uuid).
  That is what allowed S2's dangling rows.
- **`acct_*` tables have no org scoping** (`acct_clients_auth` checks neither org nor
  role), so any authenticated user can write any org's accounting rows via PostgREST.
  Pre-existing; `HUB_403_INVESTIGATION.md` Finding 11. These routes tighten the UI path
  only — the direct path is untouched.
- **ESLint is not configured** in this repo; `npm run lint` prompts to create a config.
  `npx tsc --noEmit` is the working signal and is clean.
