# Hub recurring blocks as spans: rulings and build plan

Branch `feat/recurring-spans` off `main` at `169b71f`. Migration `hub_219_recurring_spans` is
**applied to production** on 2026-11-02 (ledger version 20261103004445), with Cormac converted
Wednesday to Tuesday as ruled at the go. Tests: **PASS 47/47**, rolled back.

The need: a custody schedule ("Cormac every other week, Wednesday to Wednesday") is one block,
not one block per weekday.

## 1. What I read

- **Production today** has one recurring block, Cameron's "Cormac": active, anchor 2026-11-04,
  every 2 weeks, Wednesday, 14:00–15:30, all categories, no overrides.
- **Constraint names** the migration drops, read from `pg_constraint`:
  - `hub_sched_recurring_blocks_check2` (active needs an anchor and times)
  - `hub_sched_recurring_overrides_kind_check`
  - `hub_sched_recurring_overrides_block_id_date_key`
- **The anchor-weekday check** (`_check1`) follows the column rename `weekday` → `from_weekday`
  on its own.

## 2. The model

| Field | Meaning |
|---|---|
| `repeat`, `interval_weeks` | weekly = 1, every_other_week = 2, custom = N (1..52); checked to agree |
| `from_weekday`, `to_weekday` | the span runs from `from` forward to the next `to`. Same day = 8 days with both ends (Wed..Wed); Wed..Tue = 7 |
| `anchor_date` | must be a `from_weekday`; spans start there, then every N weeks. **No spans before it** |
| `days` | ISO weekdays inside the span that are blocked (default all) |
| `all_day`, `start_time`, `end_time` | one setting for every chosen day |
| `per_day_times` + `hub_sched_recurring_block_days` | times per span offset (0 = first day, 7 = last day of an 8-day span), each a window or all day |

**Overrides.** The date-level kinds are `skip`, `add` and `change`. The span-level kinds, keyed
by the span's first day, are new: `skip_span` and `add_span`.
- A date-level override decides its own date outright.
- `add` without times uses the block's times, or all day.
- A span-level and a date-level override may share a date (unique on block, date and scope).

`hub_sched_check` keeps its signature and reason codes. `recurring_block` is now decided by
`hub_sched_recurring_blocked(owner, category, date, start, end)`, service role only.

## 3. Rulings

1. **Cormac converts to Wednesday to TUESDAY, days {Wednesday}, 14:00–15:30.** This blocks
   exactly the Wednesdays it blocks today (Nov 4, Nov 18, Dec 2, ...).
   - The brief asked for "from Wed to Wed, days = Wednesday". In the 8-day model that also
     blocks each span's last Wednesday (Nov 11, Nov 25, ...), i.e. every Wednesday, which
     breaks "behaves exactly as before".
   - **Decide at the go.** If Cameron wants the real custody span, he sets it on the page
     after the migration (e.g. Wed to Wed, the days he has Cormac, all day, with first-day
     and last-day times for the hand-offs).
2. **No spans before the anchor**, as the brief says ("the first span starts there"). The
   old model counted backwards too; for Cormac the only effect is on Wednesdays before
   2026-11-04, none of which is still ahead.
3. **A chosen day without its own per-day row** falls back to the block's shared times, or
   all day when there are none. The API refuses to activate a per-day block until every
   chosen day has a row.
4. **Override rules.** `skip_span` must name the first day of a regular span. `add_span` must
   start on the From weekday. The API checks both against the owner's own block.
5. **Ownership** is as before: every write is filtered by the caller's id. Per-day rows and
   overrides reference `(block_id, owner_user_id)`, so they can't attach to another user's
   block. The new table has RLS on with no policies and is service role only.

## 4. Tests

`scripts/scheduling/check-tests.sql` now runs in 5 phases, 47 checks, rolled back as before:

| Phase | What it covers |
|---|---|
| 0 | The migrated Cormac row's stored fields, and that it blocks Nov 4 and Nov 18 14:00–15:30 but not Nov 11, Nov 25, 15:30 or Thursday |
| 1 | The 27 original hub_218 cases, unchanged |
| 2 | Every other week, Wed..Wed from 2026-11-04, Mon–Fri 15:00–16:00: blocked Nov 5 and Nov 11 15:30, free Nov 12, blocked Nov 19 |
| 3 | 8-day span with first Wednesday 13:30–14:30 and last Wednesday 16:00–17:00 |
| 4 | `skip_span` 2026-11-18 frees Nov 19; `add_span` 2026-11-11 blocks Nov 12 |

## 5. Files

| File | Purpose |
|---|---|
| `supabase/migrations/hub_219_recurring_spans.sql` | span columns, per-day table, span overrides, helper function, `hub_sched_check` |
| `scripts/scheduling/check-tests.sql` | phased tests |
| `src/lib/scheduling/spans.ts` | span maths for validation, summary and preview |
| `src/lib/scheduling/rules.ts` | whole-block validation, per-day times, span override checks |
| `src/app/api/scheduling/[resource]/route.ts` | saves per-day times; checks span overrides against the owner's block |
| `src/app/api/scheduling/route.ts` | returns per-day times |
| `src/components/settings/scheduling-rules-section.tsx` | the new Recurring blocks card |
