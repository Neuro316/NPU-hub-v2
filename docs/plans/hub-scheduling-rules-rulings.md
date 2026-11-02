# Hub Scheduling Rules: rulings and build plan

Branch `feat/scheduling-rules` off `main` at `7df523d`. Migration `hub_218_scheduling_rules`
is **proposed, not applied**. It waits for a separate go.

The goal is one source of truth for each Hub user's availability. The future inbox scheduling
agent and the platform booking links both read it, through the same database function.

## 1. What I read and what it means

- **Number.** The ledger stops at `hub_216`. `hub_217` is reserved by the unmerged
  inbox-triage branch, so this is `hub_218`. Neither migration depends on the other.
- **Seed owner.** Cameron's seed looks up `auth.users` by `cameron@neuroprogeny.com` and fails
  loudly if that user is missing. No user id is hard-coded.
- **Mailboxes.** All four connected mailboxes (admin@, cameron@, cameron.allen@, ops@) are
  owned by that user, so all four get seeded reply rules.

## 2. The contract for the platform

```
public.hub_sched_check(p_owner uuid, p_category text, p_starts_at timestamptz, p_ends_at timestamptz,
                       OUT allowed boolean, OUT reason text)
```

- **Access:** service role only. Through supabase-js:
  `db.rpc('hub_sched_check', { p_owner, p_category, p_starts_at, p_ends_at })` returns
  `{ allowed, reason }`.
- **Categories:** `one_on_one`, `podcast`, `in_person`, `group_coaching`, `team_familiar`.
- **Reason codes.** These are tested in this order, and the first failure wins:

| Reason | Meaning |
|---|---|
| `invalid_request` | Owner or times missing, end not after start, or unknown category. |
| `no_rules_set` | The owner has no category windows. Every user except Cameron starts here. |
| `spans_days` | Start and end fall on different local dates. |
| `before_earliest_start` | Local start is before `earliest_start` (08:00). |
| `summer_rules_undefined` | A weekday after `school_year_end` (2027-05-28), with no summer windows set. |
| `one_off_block` | Overlaps a one-off block for this category. |
| `recurring_block` | Overlaps an occurrence of an active recurring block. |
| `blocked_window` | Overlaps a daily blocked window for that kind of day (e.g. pickup). |
| `kids_home` | Kids-home time, and the category has no kids-home windows. |
| `weekend` | A weekend, and the category has no weekend windows. |
| `outside_window` | Not inside one window for the category on that kind of day. |
| `ok` | Allowed. |

- **Exception requests.** For a time outside the rules, the platform inserts into
  `public.hub_sched_exception_requests` with:
  - `owner_user_id`, `category`, `requested_starts_at`, `requested_ends_at`
  - `requester_name`, `requester_email`, `note`
  - `source = 'platform'`, and `check_reason` set to the reason it got

  Only after the owner approves (`status = 'approved'`) may the platform book that exact time.
  It then sets `status = 'booked'` and fills `booking_ref`.

## 3. Rulings

1. **Kinds of day.**
   - A Saturday or Sunday is a weekend.
   - A weekday after `school_year_end` is summer.
   - A date in `hub_sched_kids_home_dates` is a kids-home day. With `from_time` set, it is
     school before that time and kids-home from it.
   - Any other weekday is a school day.
   - Weekends are not treated as kids-home days; the weekend rules apply.
2. **Windows.** A booking must fit inside **one** window for its category. Adjacent windows are
   not merged. On a half day each part must fit a window of its own kind.
3. **Blocks win over windows.** Blocked windows apply to the matching kind of day only, so
   pickup does not apply on kids-home days, when nobody is at school. Recurring and one-off
   blocks apply on any day.
4. **Recurring blocks** occur on the weekday every N weeks counted from the anchor date, in both
   directions.
   - An inactive block does nothing, including its overrides.
   - The database only lets a block be active once it has an anchor date, a start and an end,
     and the anchor date falls on the chosen weekday.
   - "Cormac" is seeded inactive: every 2 weeks, Wednesday, all categories, with no anchor
     date or times.
   - **Overrides:**
     - `skip`: no occurrence on that date.
     - `add`: an occurrence on that date, with the override's times or the block's.
     - `change`: an occurrence on that date, with the times given.
5. **Ownership.**
   - Every table carries `owner_user_id`.
   - The API never accepts an owner. It inserts with the caller's id and filters every update
     and delete by it, so another user's row returns 404, superadmins included.
   - Overrides reference `(block_id, owner_user_id)`, so an override can't point at someone
     else's block.
   - A trigger refuses a reply rule for a mailbox the owner didn't connect.
6. **Time zones.** One-off blocks and "Test a time" take local wall-clock times. Postgres
   resolves them in the owner's zone (`2026-11-05 15:00 America/New_York`), DST included.
7. **Reply rules.**
   - Mode `draft_only` is the only value the API accepts. The column also allows `auto_send`
     for later.
   - Cameron's four are seeded with always-draft categories `personal`, `legal_financial` and
     `clinical`, and an empty voice note.
8. **Trusted senders.** Nothing is seeded, and inbound SMS and Slack are not handled in this
   build. SMS addresses are stored in E.164; Slack ids are `U…`/`W…` member ids.
9. **Access.** RLS is on with no policies on all 10 tables, anon and authenticated have no
   privileges, and `hub_sched_check` is executable by service_role only.

## 4. Tests

`scripts/scheduling/check-tests.sql` holds 27 cases: the 8 required ones, plus controls for
edges, half days, Cormac every other week and its skip override, and a user with no rules.

- It runs as one statement and always ends by raising, so its fixtures roll back and nothing
  persists.
- The outcome is in the error text: `HUB_SCHED_TESTS PASS n/n` or `FAIL ...`.
- Run it after the migration is applied.

## 5. Files

| File | Purpose |
|---|---|
| `supabase/migrations/hub_218_scheduling_rules.sql` | 10 tables, `hub_sched_check`, reply-rule trigger, Cameron's seed |
| `scripts/scheduling/check-tests.sql` | tests for `hub_sched_check` |
| `src/lib/scheduling/rules.ts` | vocabulary, reason texts, validators, resource specs |
| `src/app/api/scheduling/route.ts` | GET everything for the caller |
| `src/app/api/scheduling/[resource]/route.ts` | owner-scoped POST/PATCH/DELETE |
| `src/app/api/scheduling/settings/route.ts` | PUT settings |
| `src/app/api/scheduling/check/route.ts` | "Test a time" |
| `src/components/settings/scheduling-rules-section.tsx` | the Rules page |
| `src/app/(dashboard)/settings/page.tsx` | the "Scheduling Rules" section (every user) |
