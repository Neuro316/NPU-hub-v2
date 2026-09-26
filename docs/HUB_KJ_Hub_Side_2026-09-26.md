# §KJ hub-side: email-keyed identity writers disabled, STEP 6 deleted, §KF cron disabled by ruling

Session 2026-09-26 in `NPU-hub-v2`, branch `fix/kj-hub-side` off `main` at `eaa462a`. Scope as
ruled by Cameron 2026-09-26 in `npu-platform-v2/docs/NPU_Future_Features_Queue_v4_AddendumC.md`
§KJ (hub-side), with §KE, §KF, §KK and §JM for the rulings. Read-only across repos; writes only
here. Findings below are for filing in Addendum C from the platform side; this note is the hub's
own record.

Harness: `npm run check:kj` (`scripts/hrv/kj-hub-writers-tamper.cjs`).

---

## 1. What changed, by file

| file | change |
|---|---|
| `src/lib/onboarding-pipeline.ts` | STEP 6 (the `np_hrv_participant_map` pre-link) **deleted** (§KE). The email-mismatch flag inside it **kept**, lifted out as its own block under the same step name `xreg_map` / `email_mismatch_flagged`. The wrong catch comment ("may not have org_id column") **not carried forward**. STEP 7 (the `np_hrv_sessions.participant_id` backlink keyed on email) **disabled, not deleted** (§KJ): pushes `xreg_sessions_backlink` / `disabled_by_ruling` and issues no write. Header list and the "Email is the single linking key" sentence corrected. |
| `src/app/api/integrations/xreg-participant-sync/route.ts` | **Refuses by ruling** (§KF): after the `CRON_SECRET` check, `DISABLED_BY_RULING_KF = true` returns **503** with `reason: 'disabled_by_ruling_KF'`, the detail, and the re-enable condition. The phantom `enrollment_track` in the first select is **deliberately not corrected**. The session writer (was `:119`) and both map writers (were `:127`, `:183`) **disabled**; each `results` row now carries `sessions_backlink` / `map_link: 'disabled_by_ruling_KJ'` so the absence of a link count is not read as "none to link". |
| `vercel.json` | the `*/30 * * * *` entry for `/api/integrations/xreg-participant-sync` **removed**. Restore it in the same commit that flips the constant. |
| `scripts/hrv/kj-hub-writers-tamper.cjs`, `package.json` | new harness, `npm run check:kj`. |

Nothing else. No migration, no SQL run, no write to any database, no change to the platform repo.

## 2. Line numbers from the platform session, verified against the tree

All were measured by the platform session and re-checked here before editing.

| claim | in the tree at `eaa462a` |
|---|---|
| STEP 6 block `onboarding-pipeline.ts:424–455` | exact |
| email-mismatch flag `:446–451` | exact |
| wrong catch comment `:453` | exact |
| header `:18` "8. Upsert np_hrv_participant_map" | exact; `:19` also advertised STEP 7 |
| STEP 7 write `:462` (block `:457–475`) | exact |
| `xreg-participant-sync` phantom select "`:54`" | **`:55`**. `:54` is `.from(...)`, `:55` is the `.select(...)` naming `enrollment_track`. Same statement, one line off. |
| session writer `:119`, map writers `:127` and `:183` | exact |

## 3. Findings (new, from this session's measurement)

### 3.1 ⚠ The hub's onboarding pipeline has never executed in production

`runOnboardingPipeline` has exactly **one** caller in this repo: the §KF cron
(`xreg-participant-sync/route.ts`). That cron has never got past its first query. Measured
2026-09-26 through the read-only connector:

| `np_onboarding_log.source` | rows |
|---|---|
| `stripe` | 23 |
| `admin` | 4 |
| ⚠ `xreg_cron` | **0** |

All 27 rows are the platform's. So:

- §KJ's writer table marks hub `onboarding-pipeline.ts:462` as **live: yes**. That is true of the
  code and false of production: it is reachable only through a caller that has never reached it.
  The hub's STEP 7 has written **zero** of the 345 `participant_id` values.
- §KE's "27 of 27 `upsert_failed`" are all **platform** rows. The hub's STEP 6 never ran either.
- Both were disabled/deleted anyway. Reachability is not a guard, and the ruling is about the
  writer, not its call count.

### 3.2 The hub has no harness runner

No `npm run verify`, no `scripts/verify.cjs`, no `HARNESS` declarations. Three ad-hoc scripts
exist (`np-twiml-snapshot.mjs`, `consent-merge-test.mjs`, `twilio-inbound-audit.mjs`).
`consent-merge-test.mjs` already follows "compile the real module, run it, tamper it, prove the
tamper is caught". The new harness follows that and the platform's SET convention (`RED_OF`, two
`exit(3)` sites). It carries a `HARNESS` declaration for the day a runner exists; nothing reads it
today. **`npm run check:kj` has to be run by hand.** That is the same gap §BV names for the
platform before `verify` existed, and it is the hub's standing state.

### 3.3 `NextResponse` loads under plain Node 24

`require('next/server').NextResponse.json(...)` works outside Next (14.2.18) with Node 24's global
`Request`/`Response`. So the route handler is **executed** in the harness, not grepped: case D
calls `GET()` with a stubbed request and reads the real status and body. The `@supabase/supabase-js`
module is replaced in `require.cache` so the route's own `createClient()` hands back the recorder.

### 3.4 `process-pending-participants` is clean

The sibling `*/30` cron touches `org_members`, `pending_participant_creation`, `profiles`,
`integration_audit_log` only. Not in scope, checked so the vercel.json edit could not be confused
with it.

### 3.5 `.env.local` exists on this machine

So `next build` here is a genuine gate; CLAUDE.md's `supabaseUrl is required` caveat did not apply.

## 4. Harness: declaration and measured runs

```js
const RED_OF = {
  dropflag:      ['B'],   // requiresManualIntervention = true -> false in the emitted pipeline JS
  restorewriter: ['E'],   // an email-keyed participant_id write planted in BOTH files' source
  enablecron:    ['D'],   // DISABLED_BY_RULING_KF = true -> false in the emitted route JS
  keepschedule:  ['F'],   // the */30 entry injected back into the parsed vercel.json
}
```

| case | asserts | control |
|---|---|---|
| A | a pipeline run touches neither `np_hrv_sessions` nor `np_hrv_participant_map` | A0: the same run touched `contacts`, `profiles`, `np_onboarding_log` |
| B | xReg email ≠ enrollment email → flag set, reason names both, step present | B0: equal emails (case-insensitive) → no flag, no step |
| C | STEP 7 pushes `disabled_by_ruling` with a profile, nothing without | — |
| D | authorised GET → 503, `reason: disabled_by_ruling_KF`, detail cites §KF, **zero tables touched** | D0: wrong bearer → 401, zero tables touched |
| E | no `update({ participant_id` construct in either file, comment-stripped, per file | tamper plants it |
| F | no `xreg-participant-sync` in `vercel.json` crons | sibling cron still present (the file was read) |

Measured 2026-09-26, transcribed from the run rather than declared from it:

| run | red set | exit |
|---|---|---|
| untampered | `{}` | 0 PASS |
| `TAMPER=dropflag` | `{B}` = declared | 1 |
| `TAMPER=restorewriter` | `{E}` = declared | 1 |
| `TAMPER=enablecron` | `{D}` = declared. Got `status 200`, `touched: ["np_hrv_participant_map"]`: with the constant flipped the route reached the phantom-column query. That is the write path the refusal now stands in front of. | 1 |
| `TAMPER=keepschedule` | `{F}` = declared | 1 |
| `TAMPER=1` | `{B,D,E,F}` = union; count **4 = 1+1+1+1**, no cancellation | 1 |
| `TAMPER=bogus` | `FATAL: unknown TAMPER` | 2 |

The `TAMPER=1` sum is asserted by hand in this table only; there is no runner to do it.

## 5. Verification

- `npx tsc --noEmit`: 0 errors.
- `npm run build`: see §8 below (filled in from the run).
- `npm run check:twiml`: see §8.
- §KE's positive signal, "a new `np_onboarding_log` row with no `xreg_map` upsert entry", **cannot
  be produced from the hub**: the pipeline's only caller is now refusing. The harness's case A is
  the substitute, and it is a component proof, not a production one.

## 6. Deliberately not done

- The `enrollment_track` column name in the cron's first select. §KF: the one-word fix is the wrong
  fix.
- Deleting STEP 7. §KJ: "disabled (deleted when pairing lands)".
- Deleting the two map writers rather than disabling them. Same ruling; and §KJ says their fate is
  for whoever re-enables §KF's cron.
- `params.xregEmail` and `params.xregUserId` stay declared. `xregEmail` is used by the kept flag;
  `xregUserId` is used at the `contacts` and `np_client_records` writes. §KE's note about
  `xregUserId`'s only supplier being the disabled cron still holds; leave with §KF.
- `CURRENT.md`'s two stale entries are marked stale, not rewritten (Cameron, 2026-09-26: separate
  housekeeping).
- The three untracked docs (`docs/revenue/`, `docs/gate-multi-line-*.txt`) were not staged. Staging
  in this session was by path only.

## 7. Re-enable checklist for §KF (both conditions, not either)

1. Trust ruled: done, §JM.
2. `np_hrv_participant_map` confirmed by hand: not done. The four linked rows first, per §JM TRUST.
3. Decide what the two map writers in this route become. They `.update()` `participant_id` by an
   email match and leave `trust` alone, so they would repoint an `inferred` or `confirmed` row by
   the disqualified key. Not covered by §KJ's disposition.
4. Decide the `enrollment_track` select. It is not a column on this table.
5. Flip `DISABLED_BY_RULING_KF` to `false` and restore
   `{ "path": "/api/integrations/xreg-participant-sync", "schedule": "*/30 * * * *" }` in
   `vercel.json` in the same commit. `npm run check:kj` cases D and F will go red; update their
   declarations deliberately, not by pasting the run.

## 8. Build and snapshot results

Measured 2026-09-26 on this tree, after all edits:

| gate | result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npm run build` | green, exit 0, full route table emitted |
| `npm run check:twiml` | all snapshot checks passed, exit 0 (unrelated to this work; proves the tree is otherwise intact) |
| `npm run check:kj` | as tabled in §4 |
