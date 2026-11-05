# Hub session hand-off, 2026-11-05

Main is at `61f094e` (#30). Production: hub.neuroprogeny.com, Supabase `htfrfaxlcuyawtlztxxm`.

## Shipped and live
- **Mobile calling:** two-way browser audio, ringer and a full-screen call screen on phones (#2), with automatic reconnect (#16).
- **Global Call button:** on every Hub page (#6).
- **Calls survive navigation:** moving around the Hub never ends a live call (#12). Mail and Resources were added to the guard in #29.
- **Recordings and two-speaker transcripts:** recordings play in the thread, and transcripts label both speakers (#8, #14).
- **Call status:** outbound call logs record status, duration and end time (#10).
- **New-number calling:** one tap calls a number that isn't a contact, which creates an "Unknown" contact (#15).
- **Pipeline card notes and tasks:** recent notes and open tasks show on pipeline cards (#11).
- **Resource Library with in-call send:** the library at `/resources` (hub_222, #25), and Send resources from the contact card and from the call panels (#27).
- **Send from picker:** any mailbox the user can see. The default is cameron.allen@ for Cameron and ops@ for anyone else (#27).
- **Call-based suggestions:** files pre-checked and a drafted note from the latest transcript in the last 7 days, via Claude (#29).
- **Thumbnails:** PDF first page and image thumbnails, DOCX tiles, Replace file and click-to-preview (#30). Verified rendering on Vercel in production on 2026-11-05.
- **Growth Dashboard:** `/analytics` (hub_223, #26), with an hourly and nightly rollup, targets, test-account review and texts to Cameron.
- **Quiet hours:** the Neuro Progeny `hub_send_policy` send window is 08:00 to 20:00 in the contact's timezone (applied 2026-11-03).
- **hub_224:** Quick Send's unused tables and the `crm_quick_send` setting were dropped (#28, applied 2026-11-04). Quick Send never shipped.

## Open items
- **Cameron's untested checks:** the phone layout of `/resources` (390 px), an image upload, and Replace file. None has been run.
- **Draft rollback PR #18:** reverses #17, #27, #29 and #30 and keeps hub_224. Refresh it from main before ever using it.
- **Dashboard metrics with no data source yet:**
  - shows and no-shows
  - lead device
  - ad spend beyond clinic co-op
  - Gmail-sent replies
  - checkout started
  - partner referrals
  - memberships
  - email engagement
  - posts
  - push
  - attribution

  See `docs/metrics/definitions.md` (G2 to G13).

## Standing rules for this repo
- **Migrations:** propose the full SQL and stop. Apply only on Cameron's separate go.
- **Production only:** Hub migrations go to production only, never npu-platform-nonprod.
- **Approval prompts:** Supabase approval prompts expire after 2 minutes, so tell Cameron to be at the desk before applying.
- **Merging:** merge PRs with merge commits, never squash, so the parity pins stay reachable.
- **Test results:** never merge on test results Cameron hasn't reported himself.
