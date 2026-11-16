# Hub backlog

One line per Hub Running List id. Titles and status come from the Hub Running List (a Claude artifact,
not in this repo), as of 16 Nov 2026. Branch, PR and Migration come from git. `-` means none found in git.

| Id | Item | Status (16 Nov) | Branch | PR | Migration |
|----|------|-----------------|--------|----|-----------|
| q01 | Conversations: Add as contact with suggested pipeline and stage | Rank 8, not started | - | - | - |
| q02 | Contact card: Communications history section | Rank 7, not started (needs hub_236 applied) | - | - | depends on hub_236 |
| q03 | Speed to lead counts self-booked leads and Gmail replies | DONE, merged Nov 10 | `feat/speed-to-lead` | #48 merged | hub_236 not applied |
| q04 | LeadConnector bridge into Sales | Deferred | - | - | - |
| q05 | Mobile friendly Hub | On hold | - | - | - |
| q06 | Every University booking link lands in the pipeline with stage history | Rank 1, Shane, Task B | `feat/booking-routes-triggers` (earlier: `feat/booking-routes` #23, `feat/discovery-bookings-sales` #42, both merged) | not opened | - |
| q07 | Triggers: booking, checkout, purchase, consent, first session, inactivity, program end | Rank 2, Shane, Task B | `feat/booking-routes-triggers` | not opened | - |
| q08 | Wire lead sources into Hub intake | Rank 6, website and platform sessions, not this repo | - | - | - |
| q09 | Scheduling assistant: morning brief and reply drafts | Rank 10, on hold | `feat/scheduling-agent-phase3` | #46 open | hub_234 proposed |
| q10 | Customer service: support drafts, FAQ videos, welcome email monitoring | Rank 11 | - | - | - |
| q11 | Website tracking and lead source attribution | On hold | - | - | - |
| q12 | Workflow steps: wait until, if/else, goal exit | Rank 12 | - | - | - |
| q13 | Broadcasts, newsletter, campaign reporting, campaigns 5 to 15 | Rank 13 | - | - | - |
| q14 | Discovery call transcript to personal follow-up | Rank 14 | - | - | - |
| q15 | Coaching pre-session brief and recap | Rank 15 | - | - | - |
| q16 | Affiliate and podcast promo code tracking | Rank 16 | - | - | - |
| q17 | Failed payment recovery and weekly KPI text | Rank 17 | - | - | - |
| q18 | Podcast workflow | Rank 18 | - | - | - |
| q19 | Lead follow-up system | Rank 3, Shane, Task B | `feat/booking-routes-triggers` | not opened | - |
| q20 | Program enrollment pipeline automation | Rank 4, Shane, Task B | `feat/booking-routes-triggers` | not opened | - |
| q21 | Drop-off messages for clients | Rank 5, Shane, Task B | `feat/booking-routes-triggers` | not opened | - |
| q22 | CRM notifications and task organization | Rank 9 | - | - | - |
| q23 | Hub Health (Hub half of Platform Health) | Rank 6, Shane; blocked on platform pf_310 | - | - | - |
| q24 | Adopt standing practices, STATE/BACKLOG, nonprod catch-up | Rank 0, Task A | `docs/standing-practices-2026-11-16` | this PR | nonprod catch-up proposed |
| c01 | hub_235 go, then merge PR #47 | Waiting on go and nonprod catch-up | `feat/metrics-targets` | #47 open | hub_235 proposed |
| c02 | Heather Bauer into Sales | Waiting on go | - | - | no data-fix file found in git |
| c03 | Swap LeadConnector link for University discovery link | Cameron, manual | - | - | - |
| c04 | One Sales Pipeline for all discovery calls | DONE, decided Nov 13 | - | - | - |
| c05 | Approve first four campaigns and switch live | Cameron | `feat/speed-to-lead-campaigns` (drafts) | #40 merged | - |
| c06 | Shane's Hub access | DONE | - | - | - |
| c07 | Platform pf_310 (health tables) | Platform chat | - | - | pf_310 (platform) |
| c08 | Security: hub_232 team_profiles plus org_settings lockdown | TOP PRIORITY | `fix/team-profiles-lockdown` | #44 open | hub_232 proposed, not applied |
| c09 | Reconnect cameron@ and admin@ mailboxes | Cameron, manual | - | - | - |
| c10 | hub_236 go (Gmail sent metadata) | Waiting on go and nonprod catch-up | `feat/speed-to-lead` | #48 merged | hub_236 on main, not applied |
| d01 | Clean up about 20 duplicate contacts | Deferred | - | - | - |
| d02 | Rotate exposed keys (Slack, Twilio, AI) | Deferred | - | - | - |
| d03 | Merge duplicate pipelines and overlapping tags | Deferred | - | - | - |
| d04 | WNW sender identity for marketing email | Deferred | - | - | - |
| d05 | Content repurposing and social DM lead capture | Deferred | - | - | - |
| d06 | Connector contact types and relationship map | Deferred | - | - | - |

## In flight

| Branch | PR | Migration |
|--------|----|-----------|
| `fix/team-profiles-lockdown` | #44 open | hub_232 proposed |
| `feat/scheduling-agent-phase3` | #46 open | hub_234 proposed |
| `feat/metrics-targets` | #47 open | hub_235 proposed |
| `feat/speed-to-lead` | #48 merged | hub_236 on main, not applied |
| `docs/standing-practices-2026-11-16` | this PR | nonprod catch-up proposed |
| `feat/booking-routes-triggers` | not opened | Running List ranks 1 to 5 (Task B) |
