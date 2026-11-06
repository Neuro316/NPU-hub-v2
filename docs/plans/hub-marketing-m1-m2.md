# Marketing foundations (M1) and smart lists (M2): plan

Branch `feat/marketing-m1-m2` off `main` at `8a236cf`. Migration `hub_225`, production only, on Cameron's go.
This work sends nothing live: `gate_live_sends` stays off and no campaign's `live_enabled` changes.
Cameron's rulings 2026-11-05: backfill is Neuro Progeny only and excludes research-sourced contacts (97 rows).

## Order
1. Propose `hub_225` and the backfill count, then stop for the go.
2. Apply it and check it in `pg_catalog`.
3. Build the app, run `npm run verify`, open the PR, merge with a merge commit.
4. Report each starter list's live count and the hygiene proposals.

## M1
- **Consent:** `consent_events` stays the source of truth. The backfill is a direct insert, because
  `record_consent` lifts unsubscribe and stop suppressions on a grant. New contacts get no row, so they need an opt-in.
- **Computed status:** `hub_current_client_reasons`, `hub_email_marketing_allowed` and `hub_texting_allowed`.
  `gate_check` and `hub_contact_facts` both read them, so a list and the gate can't disagree on who is a client.
- **SMS opt-in means a ledger event.** `contacts.sms_consent` isn't read, because `inbound-sms` sets it on any new inbound texter.
- **Sender:** `from_address` becomes `Cameron Allen <hello@mail.neuroprogeny.com>`. The reply-to is already right.
- **WNW block:** `gate_check` denies when the campaign brand or the org is WNW and no `brand_senders.wnw` is set.
  This also applies to dry runs.
- **Hygiene:** a proposal doc only, `docs/plans/hub-data-hygiene-proposals.md`. Nothing changes without per-item approval.

## M2
- **Evaluation:** a pure TypeScript matcher in `src/lib/marketing/smart-lists/` runs over `hub_contact_facts(org)` on
  each read. No membership is stored, so lists are always current. This matches how metrics are computed in TS.
- **Definition:** `{match: all|any, rules: [{field, op, value}]}`. Flat, with no nested groups.
- **No data source yet:** a field catalog marks `quiz_archetype` (seeded as Holder, Giver, Ember and Tender, pending the Transitions quiz), `lead_device`, `no_show`, `attended`,
  `webinar_registered` and `webinar_attended` as having no source. A rule on one of those matches nobody and never
  widens a list. The badge comes from the catalog, so it clears when a source is added.
- **API:** `/api/marketing/smart-lists` for list, create, update, duplicate, archive, count and preview.
  `withStaff` and `requireOrg`; writes need an org admin.
- **Page:** a Smart Lists item in the GROW nav, `moduleKey: 'campaigns'`. Filter editor, live count, member preview,
  campaigns using the list, duplicate and archive. Add a `docs/help` article for help coverage.

## Campaigns and broadcasts
- **Targeting:** a new route sets `smart_list_id` and `brand`. A list's brand must match its campaign's.
- **Enroll from list:** each member goes through the existing `enroll()` with `source_key = smart_list:<id>` and
  `event_id = smart_list:<id>`, so a contact enters once per list per campaign.
- **Broadcast:** no broadcast or bulk path exists today. A broadcast is a draft campaign with a one-step sequence
  targeting a list. It adds no new send path, and activation and the live switch stay as they are.
- **Text steps:** enforced in `gate_check`, so it holds whatever list a campaign uses.

## Files left alone
`flags.ts`, `engine.ts`, `api-guard.ts`, `middleware.ts` and the other parity-pinned files. No new flag or send path is needed.

## Verification
- A new tamper harness in `verify.cjs` covers the matcher: missing fields match nobody, group logic, and the
  `any`, `none` and date ops.
- After applying: `pg_catalog` checks, the backfill count, and read-only `hub_texting_allowed` samples for a client,
  a DNC contact and a prospect.
- After deploy: a dry-run campaign text to a non-client must log `no_marketing_consent` in `send_log`.

## Known limits
- **Ungated 1:1 sends:** the Resource Library send, `/api/email/send`, `/api/sms/send`, stage emails and legacy
  sequences don't call `gate_check`, so they don't follow this consent model. Out of scope here.
- **Throughput:** the engine runs 25 steps per cron run, about 300 an hour.
