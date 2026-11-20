# Hub session state

One Code session per repo, across machines. Update this file whenever any line below changes.
Last updated: 2026-11-19, by the Code session on Shane's Mac. Applied times are as reported by the Hub chat
(CST).

## Session

- **Running:** Code session on Shane's Mac (NPU-hub-v2).
- **Live branch:** `feat/touchpoint-monitor` (q35 Part 1: the waiting-on-us monitor and the review queue).
- **Cameron:** no Code session recorded on this repo. Say so here before starting one.

## Production

- **Main:** `c03fe78` (merge of #55, website intake origins docs). Before it: `a471d14` (#54), `c11c1a6` (#53), `411940b` (#52), `96623f1` (#51), `744bbd9` (#47), `3af023f` (#50), `3a80963` (#44), `53e2788` (#49).
- **Last production deployment:** GitHub deployment `7857621379` for `411940b`, state success,
  2026-11-17 15:22 UTC, `npu-hub-v2-m2ib4rdu3-cameronsensoriumneus-projects.vercel.app`.
  The Vercel `dpl_` id is not readable from this machine (the local Vercel CLI is on a different account).

## Open PRs

| PR | Branch | What | Migration |
|----|--------|------|-----------|
| #71 | `feat/touchpoint-monitor` | q35 Part 1: touchpoint monitor and Follow-ups to review | hub_245 (proposed); hub_244 (proposed, #70) |
| #46 | `feat/scheduling-agent-phase3` | Scheduling agent stage 1 | hub_234 (proposed) |
| #18 | `revert/release-2026-10-31` | Draft rollback, do not merge | none |

Merged 16 Nov: #49 (`53e2788`, standing practices, STATE and BACKLOG, nonprod catch-up), #44 (`3a80963`,
team_profiles lockdown, every settings save through a server route), #50 (`3af023f`, lifecycle engine, dry run)
#47 (`744bbd9`, Growth Dashboard targets both ways, product-line scorecard, coaching load) and #51 (`96623f1`,
verify gives tsc a 4 GB heap and reports its exit code and signal).

## Applied on 16 Nov (Hub chat)

| Time (CST) | What |
|------------|------|
| 10:44 | supabase/nonprod/catchup_2026-11-16.sql on nonprod; nonprod ledger aligned |
| 11:20 | hub_232_team_profiles_lockdown |
| 11:22 | hub_236_mail_sent_metadata (Gmail sent metadata stored; replies count toward speed to lead only from mailboxes marked shared, and all five are private today: Running List c12) |
| 14:42 | hub_238_org_settings_lockdown |
| 14:47 | hub_237_lifecycle_events |
| 14:50 | data-fixes/2026-11-16_lifecycle_setup.sql: hub_lifecycle mode is **dry_run** |
| 14:55 | data-fixes/2026-11-16_wnw_discovery_cards_to_sales.sql: 1 card moved |
| 15:58 | hub_235_metric_targets_direction |

## Applied on 17 Nov (Hub chat)

| Time (CST) | What |
|------------|------|
| 13:15 | hub_239_brief_runs, nonprod (cpasntagxhxitavivwlb) then production (htfrfaxlcuyawtlztxxm); read back clean: RLS on, 0 policies, 0 browser grants. The brief still ships off (mode unset) |

## Migrations waiting for a go

| Migration | Where | Status |
|-----------|-------|--------|
| hub_234_scheduling_agent | PR #46 | Proposed. Not applied anywhere. |
| data/2026-11-17_website_intake_forms.sql | #54 (merged) | Proposed, not run. Three published website forms, Sales routing, intake flag on. |

## Lifecycle engine

- PR #50 is merged (`3af023f`), so `/api/cron/lifecycle` runs in production in dry_run: rows in `hub_lifecycle_events` with `planned` filled, and nothing else.
- Going live is a separate go: set `hub_lifecycle.mode` to `live`, then activate campaign routes one at a time.

## Not yet checked

- Header comments in hub_232, hub_236, hub_238 still say proposed; fix in the next docs PR.
- Which Supabase host a Hub preview page calls. Previews sit behind Vercel SSO and this session has no
  browser, so it has not been observed. A person can check it: open a preview, DevTools, Network, filter
  `supabase.co`, and read the host of the requests. (Running List q27 points previews at nonprod.)
