# Hub session state

One Code session per repo, across machines. Update this file whenever any line below changes.
Last updated: 2026-11-16, by the Code session on Shane's Mac.

## Session

- **Running:** Code session on Shane's Mac (NPU-hub-v2).
- **Live branch:** `feat/booking-routes-triggers` (Task B, PR #50). Task A is `docs/standing-practices-2026-11-16` (PR #49).
- **Cameron:** no Code session recorded on this repo. Say so here before starting one.

## Production

- **Main:** `3bfa102` (merge of #48, speed to lead).
- **Last production deployment:** GitHub deployment `7684846090` for `3bfa102`, state success,
  2026-11-10 14:30 UTC, `npu-hub-v2-qxr1gd3wf-cameronsensoriumneus-projects.vercel.app`.
  The Vercel `dpl_` id is not readable from this machine (the local Vercel CLI is on a different account).

## Open PRs

| PR | Branch | What | Migration |
|----|--------|------|-----------|
| #44 | `fix/team-profiles-lockdown` | Lock team_profiles writes, staff save route, revised hub_232 | hub_232 (proposed) |
| #46 | `feat/scheduling-agent-phase3` | Scheduling agent stage 1 | hub_234 (proposed) |
| #47 | `feat/metrics-targets` | Growth Dashboard targets both ways | hub_235 (proposed) |
| #49 | `docs/standing-practices-2026-11-16` | Standing practices, STATE and BACKLOG, nonprod catch-up | nonprod catch-up (proposed) |
| #50 | `feat/booking-routes-triggers` | Lifecycle engine: booking routes and triggers (q06, q07, q19, q20, q21), dry run only | hub_237 + two data fixes (proposed) |
| #18 | `revert/release-2026-10-31` | Draft rollback, do not merge | none |

## Migrations waiting for a go

Production ledger read 2026-11-16: hub_214 to hub_231 and hub_233 are applied. Nonprod has hub_211 to hub_213 only.

| Migration | Where | Status |
|-----------|-------|--------|
| hub_232_org_settings_lockdown | PR #44 | Proposed, revised. Not applied anywhere. Its header still says "Production only"; under the 16 Nov rules it goes nonprod first. |
| hub_234_scheduling_agent | PR #46 | Proposed. Not applied anywhere. |
| hub_235_metric_targets_direction | PR #47 | Proposed. Not applied anywhere. |
| hub_236_mail_sent_metadata | **main** (merged in #48) | Not applied anywhere. The code degrades cleanly (`not_ready`), so production works, but a Gmail reply does not count as a speed-to-lead touch until it is applied. |
| supabase/nonprod/catchup_2026-11-16.sql | PR #49 | Schema-only catch-up of hub_214 to hub_231 and hub_233 for nonprod. Needs a go. Run first: hub_237 depends on it on nonprod. |
| hub_237_lifecycle_events | PR #50 | Proposed. Not applied anywhere. Nonprod (after the catch-up), then production. |
| data-fixes/2026-11-16_lifecycle_setup.sql | PR #50 | Proposed, not run. Production, after hub_237. Leaves everything in dry_run. |
| data-fixes/2026-11-16_wnw_discovery_cards_to_sales.sql | PR #50 | Proposed, not run. Production. Moves 1 card (counted 16 Nov). |

## Not yet checked

- Which Supabase host a Hub preview page calls. Previews sit behind Vercel SSO and this session has no
  browser, so it has not been observed. A person can check it: open a preview, DevTools, Network, filter
  `supabase.co`, and read the host of the requests.
