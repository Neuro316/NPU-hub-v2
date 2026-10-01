# Hub click-to-call: rulings and build plan

Branch `feat/click-to-call`, base `d49d00e`. Standing rules of `docs/plans/hub-marketing-build-rulings.md`
apply (rulings 2, 4, 13 to 18). Status: **approved 2026-10-01** with the Press 1 guard (R1a); real test call in production after merge
(flag on, live off, then off); data writes approved, SQL shown before running; verify.cjs gets the
new harness lines.

## 1. What I read and what it means

- **Conversations view** is one client page, `src/app/(dashboard)/crm/conversations/page.tsx`. The
  header is inline (contact name at line 501), not a component. The open thread is `selectedThread`
  (`ThreadItem`: `id, contact_id, contact_name, contact_phone, line_e164`, ...). Switching runs
  `openThread()`. There is no full contact object in state.
- **Lines.** A contact has one conversation; `conversations.line_e164` is the line it last used, NULL
  meaning the org default. The default is resolved by `getVoiceCallerId()` (`src/lib/twilio-org.ts:354`).
  "Primary" exists only as the env fallback nickname, so in this build **"Primary" means the org
  default line** and the confirm says so ("Default line (Primary)").
- **Timeline** (`src/components/crm/comms-timeline.tsx`) already renders `call_logs` rows by
  `contact_id` with direction, duration and Missed. A `failed` row renders as a bare "Outgoing call".
- **Voice webhooks.** `ring-complete` is the only app code that raises entry events, and only when
  the `call_logs` row has `direction = 'inbound'`. `inbound-call` treats any non-`client:` caller as
  inbound, so a REST-originated leg must never point there. Signature checking is shared through
  `resolveVoiceWebhookAuth` + `voiceSignatureUrl` (`src/lib/twilio-voice-signature.ts`);
  `recording-ready` is the enforced, fail-closed example to copy. `call-status`, `ring-complete` and
  `transcription` do not verify (they are in the G1 baseline).
- **Twilio client** is per org: `getOrgTwilioConfig` + `createOrgTwilioClient` (`twilio-org.ts`), env
  fallback. `notify-sms.ts` is SMS only and pins the "Primary" nickname.
- **Staff phone** is `team_profiles.phone` (per org), edited on `/team` (no deep link exists).
- **Gates available:** `contacts.do_not_contact`, `do_not_contact_list` (via `isDNC`, which only warns
  on a read error), `suppressions` (hub_211). Quiet-hours precedent: `gate_check` uses
  `contacts.timezone`, else `hub_send_policy.default_timezone`, window 08:00 to 20:00.
- **Flags** live in `org_settings` jsonb; only the exact string `'on'` counts. Allowlist is
  `campaign_test_contacts` (phone matched on last 10 digits, org scoped).
- **Live schema (read 2026-10-01):** `call_logs` has `direction` (inbound|outbound), `status`
  (ringing, in_progress, completed, missed, voicemail, failed), `from_number, to_number,
  external_call_sid, conversation_id, started_at, ended_at, duration_seconds`, no metadata column.
  `crm_activity_log` has `contact_id NOT NULL, org_id, event_type, event_data jsonb, ref_table,
  ref_id, actor_id -> auth.users, occurred_at, created_at`, no CHECK on `event_type`.

## 2. Rulings as I will implement them

**R1 Mechanism (bridge).** `POST /api/comms/click-to-call` (withStaff) takes `{ conversation_id }`
only. The server derives everything else: org from the conversation (must be in `ctx.orgIds`, else
403), contact from `conversations.contact_id`, line from the conversation, staff phone from the
caller's own `team_profiles` row in that org. It inserts the `call_logs` row first, then
`calls.create({ to: staffPhone, from: line, url: bridge?log=<id>, statusCallback: status?log=<id>,
timeout: 25 })`, then stamps `external_call_sid`. The staff member sees the business line as caller ID.

**R1a Voicemail guard (my addition, please confirm).** When the staff phone answers, the bridge says
"Press 1 to call <first name>." Only a 1 dials the contact. Without it, a staff voicemail pickup would
dial the contact into a dead line. No key within 8 seconds hangs up and logs `staff_no_confirm`.

**R2 UI.** A phone icon beside the contact name, `title` and `aria-label` "Call <name>". Click opens
a small confirm fed by `GET /api/comms/click-to-call?conversation_id=` (a preflight that runs the same
gates without dialing): contact number, line it calls from (nickname + number, and "default line" when
it fell back), staff phone it rings first, a quiet-hours warning when relevant, Call and Cancel. The
icon is disabled with a plain sentence when: flag off, contact has no phone, contact is do-not-contact
or suppressed, the caller has no phone on their team profile (with a link to `/team`), or (live off)
the contact is not on the test allowlist. Preflight is keyed by `selectedThread.id`; a response for a
thread that is no longer open is discarded, and Call posts the id of the thread open at click time.

**R3 Line.** `conversations.line_e164` if it is still one of the org's numbers (`findOrgNumber`), else
`getVoiceCallerId(config)`; the confirm shows which.

**R4 Gate, rate limit, log.**
- Block: `contacts.do_not_contact`, a `do_not_contact_list` row (phone last 10 digits or email), or
  any active `suppressions` row on the contact's phone (any scope). **Fails closed** on a read error,
  unlike `isDNC`.
- Quiet hours: outside 08:00 to 20:00 in contact local time (contact `timezone`, else
  `hub_send_policy.default_timezone`, else America/New_York) shows a warning; the call is allowed.
- Rate limit per user: 5 attempts per 10 minutes and 40 per day, counted from `crm_activity_log`
  (`event_type = 'click_to_call'`, `actor_id`). 429 with a sentence saying when to retry.
- Log: one `crm_activity_log` row per attempt (`event_type 'click_to_call'`, `actor_id`, `ref_table
  'call_logs'`, `ref_id`), `event_data = { result, reason, line, from_number, staff_phone,
  contact_phone, quiet_hours, parent_call_sid, dial_call_sid, requested_at, staff_answered_at,
  ended_at, outcome }`, updated by the callbacks. Refusals are logged too. A wrong-org request is
  not written into the other org (console warning only).
- Timeline: the `call_logs` row (`direction 'outbound'`, `conversation_id`, `contact_id`, `from_number`
  = line, `to_number` = contact) is what the timeline shows. Callbacks set `status`
  (completed / missed for contact no-answer or busy / failed for staff not reached or not confirmed),
  `duration_seconds` = `DialCallDuration` (talk time with the contact), `ended_at`. One additive line
  in `CallRow` shows "Not connected" for a `failed` call, so every outcome is visible.

**R5 Flags.** New `org_settings` row `setting_key = 'click_to_call'`, `setting_value = {"enabled":
"on|off", "live": "on|off"}`. Missing row or key is off. A separate key, not `hub_marketing_flags`, so
the marketing flags code (and the campaign session) is untouched. Live off: only contacts whose phone
is on `campaign_test_contacts` for that org are dialed; others get "Click-to-call is in test mode. This
contact is not on the test list." Flipping is a data write; exact SQL is in section 6.

**R6 No recording.** No `record`, `recordingStatusCallback` or `<Record>` anywhere in the new code,
and the harness fails if one appears. The org's per-line `record_calls` setting is not consulted.

**R7 No entry events.** The row is `direction 'outbound'`. The new routes never import
`raiseEntryEvent`, never point Twilio at `inbound-call` or `ring-complete`, and never write `contacts`
(the hub_212 triggers fire on contact stage and tag changes). Proven by the static harness and a
read of `entry_events` for the test contact after the real call.

**R8 Webhooks.** `POST /api/twilio/click-to-call/bridge` (TwiML) and `POST
/api/twilio/click-to-call/status` (parent `statusCallback` and the `<Dial action>`) both verify the
signature **before any DB access**, always enforced (not `TWILIO_VOICE_SIGNATURE_MODE`), 403 on a
missing URL, missing header, mismatch or a throw. The signed URL includes the query string. Both also
require the `log` id to exist with `direction 'outbound'` and a matching `external_call_sid`.
`/api/twilio` is already a middleware public prefix. G1 learns the new verifier name so these routes
count as wrapped.

**R9 No new table.** `call_logs` holds the call; `crm_activity_log` holds every attempt with actor and
SIDs. **No migration.**

## 3. Files

New:
- `src/lib/click-to-call/logic.ts`: pure gate decision, line pick, quiet hours, rate-limit window,
  TwiML builders, outcome mapping (what the harness compiles and tests).
- `src/lib/click-to-call/server.ts`: DB reads for the gates, flag read, allowlist, logging.
- `src/lib/click-to-call/verify.ts`: `verifyTwilioWebhook(request, path)`.
- `src/lib/click-to-call/ui-logic.ts`: preflight state keyed by conversation id (stale discard).
- `src/app/api/comms/click-to-call/route.ts` (GET preflight, POST place), withStaff.
- `src/app/api/twilio/click-to-call/bridge/route.ts`, `.../status/route.ts`.
- `src/components/crm/click-to-call-button.tsx`: icon, disabled reason, confirm.
- `scripts/click-to-call/c2c-tamper.cjs`, `scripts/click-to-call/parity.cjs`.

Edited (small, marked `CLICK-TO-CALL-BEGIN/END`): `conversations/page.tsx` (one import, one element
in the header), `comms-timeline.tsx` ("Not connected"), `scripts/guards/run-guards.cjs` (G1 regex),
`scripts/verify.cjs` (two harness lines). No new environment variable: callback URLs use the
existing `NEXT_PUBLIC_APP_URL` (else `VERCEL_URL`) through `voiceSignatureUrl`, the same base the
signature is checked against.

Untouched and pinned byte-equal by the parity harness: `twilio/inbound-call`, `ring-complete`,
`call-status`, `recording-ready`, `transcription`, `voice/token`, `lib/twilio.ts`, `lib/twilio-org.ts`,
`lib/notify-sms.ts`, `lib/marketing/*`.

## 4. Tests

- **c2c-tamper.cjs** compiles the real TS (pure-tamper pattern) and runs declared-red selectors:
  `wrongorg, nophone, suppressed, dnclist, nostaffphone, ratelimit, flagoff, allowlistonly,
  notallowlisted, quiethoursblock` (a), `sigbridge, sigstatus` (b: bad or missing signature must be
  rejected, and verification must precede the first DB call in both route files), `staleswitch` (c:
  preflight for thread A arriving after a switch to B is discarded and Call posts B), `entryevent,
  inboundroute, recording, directionin` (d and R6: static checks over the new files), and `1`.
  `BASE=HEAD~1` reads the pre-build tree, where every case must be red.
- **parity.cjs** (e): untouched files byte-equal to `d49d00e`; marked files equal outside the markers.
- `npx tsc --noEmit`, `npm run verify` (guards G1 to G5 plus every harness) green; HEAD~1 run recorded.
- Browser (f), see section 5.

## 5. Stages after approval

Build, push branch, Vercel preview, click-through, merge to main once, deploy, confirm deploy SHA,
read back that `click_to_call` is off (row absent) in production.

Click-through needs the flag on for the NP org. **The database is shared, so turning it on for the
preview also turns it on for production.** Before the merge that is harmless (production has no
code); I turn it off again before merging.

## 6. Data writes for your go (not schema)

```sql
-- enable for the click-through (NP org), test mode only
insert into public.org_settings (org_id, setting_key, setting_value)
values ('<np_org_id>', 'click_to_call', '{"enabled":"on","live":"off"}'::jsonb)
on conflict (org_id, setting_key) do update set setting_value = excluded.setting_value;
-- rollback / production off
delete from public.org_settings where org_id = '<np_org_id>' and setting_key = 'click_to_call';
```

## 7. Open items needing you at this stop

1. **Allowlist.** `campaign_test_contacts` has one row (your profile phone). The test contact must be
   your *other* number, so it needs a row: `insert into public.campaign_test_contacts (org_id, phone,
   label) values ('<np_org_id>', '<other number>', 'Cameron second phone (click-to-call test)');`
2. **Preview callbacks** (resolved: real call runs in production after merge). Twilio must reach
   the webhooks. Callback URLs come from `NEXT_PUBLIC_APP_URL`. If the Preview env's
   `NEXT_PUBLIC_APP_URL` is the production host, Twilio would call production (which has no route yet),
   and Vercel deployment protection blocks Twilio on preview URLs. Options: you set
   a preview URL with protection bypass for automation, or
   I run the real call after merge in production with the flag on and live off, then switch it off.
3. **verify.cjs collision.** The campaign branch adds one line to `scripts/verify.cjs`; I add two.
   Whichever merges second resolves a one-hunk conflict by keeping both. Say if you would rather I
   leave `verify.cjs` alone and expose `npm run check:c2c` instead.
4. **Live read refused.** My read of the triggers on `call_logs` / `crm_activity_log` was blocked by
   the session's permission check. The repo migrations show only the `last_activity_at` triggers
   (209). I will repeat the read when allowed, before the build.

## 8. Assumptions

- A1 "Primary" = the org default line from `getVoiceCallerId`.
- A2 Staff phone is `team_profiles.phone` only, not `profiles.phone`.
- A3 Any active suppression on the phone blocks, whatever its scope.
- A4 Duration in the timeline is talk time with the contact (`DialCallDuration`).
- A5 Refused attempts count toward the rate limit.
- A6 `call_logs.team_member_id` stays null (it references `team_members`, not users); the staff
  member is `crm_activity_log.actor_id`.
