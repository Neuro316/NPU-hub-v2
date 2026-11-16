# Hub session state

One Code session per repo, across machines. Update this file whenever any line below changes.
Last updated: 2026-11-16 afternoon, by the Code session on Shane's Mac. Applied times are as reported by the Hub chat
(CST).

## Session

- **Running:** Code session on Shane's Mac (NPU-hub-v2).
- **Live branch:** `feat/booking-routes-triggers` (PR #50), with origin/main merged in on 16 Nov.
- **Cameron:** no Code session recorded on this repo. Say so here before starting one.

## Production

- **Main:** `3a80963` (merge of #44, team_profiles lockdown and server-side settings saves). Before it: `53e2788` (merge of #49).
- **Last production deployment:** GitHub deployment `7835770292` for `3a80963`, state success,
  2026-11-16 20:38 UTC, `npu-hub-v2-qapit8lzd-cameronsensoriumneus-projects.vercel.app`.
  The Vercel `dpl_` id is not readable from this machine (the local Vercel CLI is on a different account).

## Open PRs

| PR | Branch | What | Migration |
|----|--------|------|-----------|
| #50 | `feat/booking-routes-triggers` | Lifecycle engine: booking routes and triggers (q06, q07, q19, q20, q21), dry run only | hub_237 and both data fixes applied or run 16 Nov |
| #46 | `feat/scheduling-agent-phase3` | Scheduling agent stage 1 | hub_234 (proposed) |
| #47 | `feat/metrics-targets` | Growth Dashboard targets both ways | hub_235 (proposed) |
| #18 | `revert/release-2026-10-31` | Draft rollback, do not merge | none |

Merged 16 Nov: #49 (`53e2788`, standing practices, STATE and BACKLOG, nonprod catch-up) and #44 (`3a80963`,
team_profiles lockdown, every settings save through a server route).

## Applied on 16 Nov (Hub chat)

| Time (CST) | What |
|------------|------|
| 10:44 | supabase/nonprod/catchup_2026-11-16.sql on nonprod; nonprod ledger aligned |
| 11:20 | hub_232_team_profiles_lockdown |
| 11:22 | hub_236_mail_sent_metadata (Gmail replies now count as a speed-to-lead touch) |
| 14:42 | hub_238_org_settings_lockdown |
| 14:47 | hub_237_lifecycle_events |
| 14:50 | data-fixes/2026-11-16_lifecycle_setup.sql: hub_lifecycle mode is **dry_run** |
| 14:55 | data-fixes/2026-11-16_wnw_discovery_cards_to_sales.sql: 1 card moved |

## Migrations waiting for a go

| Migration | Where | Status |
|-----------|-------|--------|
| hub_234_scheduling_agent | PR #46 | Proposed. Not applied anywhere. |
| hub_235_metric_targets_direction | PR #47 | Proposed. Not applied anywhere. |

## Lifecycle engine

- The cron `/api/cron/lifecycle` ships with PR #50. Until #50 is merged and deployed, nothing reads the settings
  the setup data fix created, so nothing is recorded.
- After the merge it runs in dry_run: rows in `hub_lifecycle_events` with `planned` filled, and nothing else.
- Going live is a separate go: set `hub_lifecycle.mode` to `live`, then activate campaign routes one at a time.

## Not yet checked

- Which Supabase host a Hub preview page calls. Previews sit behind Vercel SSO and this session has no
  browser, so it has not been observed. A person can check it: open a preview, DevTools, Network, filter
  `supabase.co`, and read the host of the requests. (Running List q27 points previews at nonprod.)
