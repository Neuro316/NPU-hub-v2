# Resource suggestions from the call: plan

Branch `feat/resource-suggestions` off `main` at `4b086a7`. No schema change, no new package.

## What it does
When Send resources opens for a contact (contact card or in-call), the panel asks
`/api/resources/suggest` in the background for:
- the library files that fit what was said on the call, pre-checked and labelled
  "Suggested from your call"
- a drafted note that replaces the standard note, with "Use standard note" to switch back
  (and "Use note drafted from your call" to switch again)

Everything stays editable, and a person always presses Send. The panel opens at once. A
slow, failed or empty suggestion shows the normal panel with no message. A suggestion that
arrives after the person edited the files or the note, or previewed, does not override
their edits.

## Source
- The contact's latest `call_logs` row with `transcription_status = 'completed'` and a
  transcript, in the contact's org, created in the last 7 days.
- **No live transcript exists.** Voice Intelligence transcribes the recording after the
  call ends (usually a minute or two). So during a call the suggestion comes from the
  latest earlier call in the 7 days, if any. Today's call counts as soon as its transcript
  lands.
- No transcript, or an empty library: Claude is not called, and the panel is unchanged.

## Claude
- **Key:** `ANTHROPIC_API_KEY`, the one every Hub AI feature already uses. It is set in
  production: mail triage ran 87 times in the 3 days to 2026-11-04 with no errors.
- **Request:** `claude-opus-5-5`, effort low, structured JSON output, and the
  server-side refusal fallback, as in `src/lib/mail/triage.ts`.
  - The schema limits `resource_ids` to the available ids, and `validateSuggestion`
    checks again.
  - Timeout 20 s, no retry.
- **Sent:** the transcript text, the contact's first name, and each active resource's
  id, title and description. Resources have no category field, so none is sent.
  - The stored transcript labels the contact with their full name, so their turns are
    relabelled with the first name only.
  - Emails, phone numbers and links in the text are redacted.
- **Returned:** at most 5 resource ids, and a 2 to 3 sentence note in Cameron's voice that
  references what the person shared.
  - The server appends "Reply here anytime with questions." and the sender's first name
    (from their profile).
  - Em and en dashes are removed.
- **Not stored or logged:** the prompt, the transcript and the reply. A failure logs a
  short code only (for example `ai_status_529`).

## Access
Same as `/api/resources/send`: a platform superadmin who is a member of the contact's org.

## Also fixed
`DASHBOARD_SEGMENTS` (`src/lib/call-navigation-guard.ts`) was missing `mail` and
`resources`. During a call, moving to Mail or Resources was treated as leaving the Hub, and
the test:voice check for it was failing on main.

## Files
| File | Purpose |
|---|---|
| `src/lib/resources/suggest.ts` | Pure rules and orchestration (transcript cleaning, validation, note) |
| `src/lib/resources/suggest-model.ts` | The Claude request |
| `src/app/api/resources/suggest/route.ts` | GET, for the panel |
| `src/components/crm/send-resources.tsx` | Background fetch, labels, note switch |
| `scripts/tests/resource-suggestions.test.mjs` | 14 tests, in `npm run test:voice` |
