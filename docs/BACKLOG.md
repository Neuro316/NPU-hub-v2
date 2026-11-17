# Hub backlog

One line per Hub Running List id. Titles and status come from the Hub Running List (a Claude artifact,
not in this repo), as of 16 Nov 2026, updated with the Hub chat's applied state that afternoon. Branch, PR and Migration come from git. `-` means none found in git.

| Id | Item | Status (16 Nov) | Branch | PR | Migration |
|----|------|-----------------|--------|----|-----------|
| q01 | Conversations: Add as contact with suggested pipeline and stage | Rank 8, not started | - | - | - |
| q02 | Contact card: Communications history section | DONE 17 Nov | `feat/contact-comms-history` | #52 merged (`411940b`) | none; Gmail history backfill proposed separately |
| q03 | Speed to lead counts self-booked leads and Gmail replies | DONE, merged Nov 10 | `feat/speed-to-lead` | #48 merged | hub_236 applied 16 Nov 11:22 |
| q04 | LeadConnector bridge into Sales | Deferred | - | - | - |
| q05 | Mobile friendly Hub | On hold | - | - | - |
| q06 | Every University booking link lands in the pipeline with stage history | Rank 1, Shane, Task B | `feat/booking-routes-triggers` (earlier: `feat/booking-routes` #23, `feat/discovery-bookings-sales` #42, both merged) | #50 merged (`3af023f`) | hub_237 applied 16 Nov 14:47; setup run 14:50 (dry_run) |
| q07 | Triggers: booking, checkout, purchase, consent, first session, inactivity, program end | Rank 2, Shane, Task B | `feat/booking-routes-triggers` | #50 merged (`3af023f`) | hub_237 applied 16 Nov 14:47; setup run 14:50 (dry_run) |
| q08 | Wire lead sources into Hub intake | Priority 1. Hub half merged (forms, Sales placement, contract for the Website session); website half is the Website session | `feat/website-intake` | #54 merged (`a471d14`); origins docs #55 merged (`c03fe78`) | data proposed, not run: supabase/data/2026-11-17_website_intake_forms.sql |
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
| q19 | Lead follow-up system | Rank 3, Shane, Task B | `feat/booking-routes-triggers` | #50 merged (`3af023f`) | hub_237 applied 16 Nov 14:47; setup run 14:50 (dry_run) |
| q20 | Program enrollment pipeline automation | Rank 4, Shane, Task B | `feat/booking-routes-triggers` | #50 merged (`3af023f`) | hub_237 applied 16 Nov 14:47; setup run 14:50 (dry_run) |
| q21 | Drop-off messages for clients | Rank 5, Shane, Task B | `feat/booking-routes-triggers` | #50 merged (`3af023f`) | hub_237 applied 16 Nov 14:47; setup run 14:50 (dry_run) |
| q22 | CRM notifications and task organization | Priority 2, merged; brief ships off | `feat/notifications-brief` | #53 merged (`c11c1a6`) | hub_239 applied 17 Nov 13:15 (nonprod, then production) |
| q23 | Hub Health (Hub half of Platform Health) | Rank 6, Shane; blocked on platform pf_310 | - | - | - |
| q24 | Adopt standing practices, STATE/BACKLOG, nonprod catch-up | DONE 16 Nov | `docs/standing-practices-2026-11-16` | #49 merged (`53e2788`) | nonprod catch-up applied 16 Nov 10:44, ledger aligned |
| q25 | Headset program access: 6 months from the last purchase, with an on/off switch on the contact card | Not started; platform builds the access rule plus a view and one override function, Hub builds the card and switch against them (handed to Cameron's platform chat 16 Nov) | - | - | - |
| q26 | Mail search endpoint across all connected mailboxes (for call prep) | Not started | - | - | - |
| q27 | Nonprod staff seed, then point Hub previews at nonprod | Not started | - | - | - |
| q28 | CI: stop the type check dying silently | DONE 16 Nov | `fix/ci-tsc-memory` | #51 merged (`96623f1`) | - |
| q29 | Count off-platform payments (check, cash) as paid sales | Waiting on the platform's field names | - | - | - |
| q30 | Contact card and Contacts list fixes from the q02 walkthrough (search, Comms tab, activity counts) | In progress | `fix/contacts-card-search` | (this PR) | - |
| q32 | Welcome email check (new University signups without a delivered welcome email) | Blocked on the platform: it does not record welcome emails or their delivery (contract sent 17 Nov) | `feat/welcome-email-check` (no commits) | - | - |
| c01 | hub_235 go, then merge PR #47 | DONE 16 Nov | `feat/metrics-targets` | #47 merged (`744bbd9`) | hub_235 applied 16 Nov 15:58 |
| c02 | Heather Bauer into Sales | DONE 16 Nov | - | - | - |
| c03 | Swap LeadConnector link for University discovery link | Cameron, manual | - | - | - |
| c04 | One Sales Pipeline for all discovery calls | DONE, decided Nov 13 | - | - | - |
| c05 | Approve first four campaigns and switch live | Cameron | `feat/speed-to-lead-campaigns` (drafts) | #40 merged | - |
| c06 | Shane's Hub access | DONE | - | - | - |
| c07 | Platform pf_310 (health tables) | Platform chat | - | - | pf_310 (platform) |
| c08 | Security: hub_232 team_profiles plus org_settings lockdown | DONE 16 Nov | `fix/team-profiles-lockdown` | #44 merged (`3a80963`) | hub_232 applied 11:20, hub_238 applied 14:42 |
| c09 | Reconnect cameron@ and admin@ mailboxes | Cameron, manual | - | - | - |
| c10 | hub_236 go (Gmail sent metadata) | DONE 16 Nov | `feat/speed-to-lead` | #48 merged | hub_236 applied 16 Nov 11:22 |
| c11 | Hub settings saves have failed silently since Nov 10 (pf_304); fix on PR #44 | DONE 16 Nov | `fix/team-profiles-lockdown` | #44 merged (`3a80963`) | hub_238 applied 16 Nov 14:42 |
| c12 | Decide which mailboxes count a reply toward speed to lead | Open decision | - | - | - |
| d01 | Clean up about 20 duplicate contacts | Deferred | - | - | - |
| d02 | Rotate exposed keys (Slack, Twilio, AI) | Deferred | - | - | - |
| d03 | Merge duplicate pipelines and overlapping tags | Deferred | - | - | - |
| d04 | WNW sender identity for marketing email | Deferred | - | - | - |
| d05 | Content repurposing and social DM lead capture | Deferred | - | - | - |
| d06 | Connector contact types and relationship map | Deferred | - | - | - |
| d07 | For Cameron to review: comped Phase 1 in the Phase 2/3 conversion cohort | For review | - | - | - |

## In flight

| Branch | PR | Migration |
|--------|----|-----------|
| `feat/scheduling-agent-phase3` | #46 open | hub_234 proposed |
| `fix/contacts-card-search` | (this PR) | none (q30) |
| `feat/speed-to-lead` | #48 merged | hub_236 applied 16 Nov |
