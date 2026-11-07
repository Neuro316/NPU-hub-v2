# Hub integration contract: how the University platform sends entry events

**Status:** the Hub's receiving side is built and deployed. The platform's calling side is NOT built
(ruling 1 of `docs/plans/hub-marketing-build-rulings.md`: no platform changes in this build).
**Written:** 2026-10-01.

## What it is for

Some entry events happen in the University platform, not the Hub: a quiz is completed, a session is
booked, a free account is created. Each of those should put the person into the right Hub campaign,
through the same enrollment engine as every other entry event (ruling 5). The platform reports the
event to the Hub; the Hub decides which campaign, if any.

## The endpoint

`POST https://hub.neuroprogeny.com/api/intake` in **server mode**. This is the same exact path the
public forms use (approved, ruling 7). No new public path exists for the platform.

### Authentication

```
Authorization: Bearer <HUB_INTAKE_SERVER_SECRET>
Content-Type: application/json
```

- The secret is at least 32 random characters, set in the Hub's Vercel environment and in the
  platform's. Compared in constant time.
- A request that sends an `Authorization` header that is wrong, or arrives while the Hub has no
  secret set, is refused **401**. It never falls back to public mode.

### Body

```json
{
  "form": "university-quiz",
  "event_id": "quiz_result:6c1f0f2e-0a51-4f43-9a1d-3d8b2c1a7e10",
  "values": { "email": "person@example.com", "first_name": "Ana", "phone": "+18285550100" },
  "consents": ["email_updates"],
  "utm": { "utm_source": "instagram", "utm_campaign": "phase-shift" }
}
```

| Field | Required | Meaning |
|---|---|---|
| `form` | yes | The slug of a **published** form definition in the Hub (Forms and Pages). It names the org, the fields the Hub accepts, the exact consent wording, and the source key that routes into campaigns. Create one form per kind of event, for example `university-quiz`, `university-booking`, `university-signup`. |
| `event_id` | yes | The platform's own stable id for this event, letters, numbers and `: _ . -`, at most 120 characters. **The call is idempotent on it**: the same `event_id` for the same form is accepted once; a replay answers `200 { ok: true, duplicate: true }` and changes nothing. |
| `values` | yes | Field values keyed by the form's field keys. At least an email or a phone. |
| `consents` | no | Ids of the form's consent boxes the person actually ticked in the platform, **shown with the same wording the Hub form holds**. The Hub records the wording from its own definition, never text from the request. |
| `utm` | no | Only `utm_*` keys are kept, each at most 200 characters. |

### What the Hub does

1. Refuses unless the form is published and the org's `intake` switch is on (404).
2. Validates `values` against the form definition (400 with per-field messages).
3. Matches the contact in that org by email, or by phone when there is no email, or creates one.
4. Records each ticked consent, with two protections: it never reverses the person's own earlier
   opt-out, and an SMS consent counts only when the phone in `values` is the phone on the contact.
5. Routes the form's source key into every active campaign that listens for it, with event id
   `platform:<event_id>`, so the same event can never enroll a person twice.

### Responses

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ ok: true, message }` | Accepted |
| 200 | `{ ok: true, duplicate: true, message }` | This `event_id` was already accepted for this form |
| 400 | `{ error, fields? }` | Missing `event_id`, or values that do not fit the form |
| 401 | `{ error: "unauthorized" }` | Wrong or unset secret |
| 404 | `{ error }` | Form not published, or intake switched off |
| 500 | `{ error }` | Retry with the same `event_id`; it is safe |

Responses never contain contact data.

### Retry rule for the platform

Retry on 500 and on network errors **with the same `event_id`**. Do not retry 400, 401 or 404.

## What the Hub does not offer the platform

- No read access to contacts, consent or campaigns.
- No way to override an opt-out: a person who unsubscribed or replied STOP stays opted out until
  they opt in again themselves.

## Setting it up

1. Set `HUB_INTAKE_SERVER_SECRET` in the Hub's Vercel environment (Production and Preview) and give
   the same value to the platform.
2. In the Hub, create and publish one form per event kind, with the fields the platform will send and
   consent wording identical to what the platform displays.
3. In Campaigns, Funnels, add the form's source key under "Starts from" on the campaign it should start.
4. Turn on the `intake` switch for the org (CRM Settings, Campaign Sending).

---

# Lead device external intake: devices hosted on other sites

**Status:** built and deployed.
**Written:** 2026-11-06.

## What it is for

A quiz, lead magnet, webinar registration, tool or form hosted on neuroprogeny.com or WNW reports each
submission to the Hub. The first submission from an unknown slug registers the device in draft, and the
Hub creates its pipeline, tags, lists and draft campaigns around it. Nothing sends to real people until
Cameron switches the device live.

**A submission to a device that is not live is a test.** It is stored on the device and counts toward the
readiness checklist, and that is all: no contact is created, and no consent, tag, list, pipeline, campaign
or text follows. A site should not rely on this endpoint for real leads until the device is live.

This is separate from the University's server mode above. Marketing stays in the Hub: no lead device
runs in the University, and none of this reads or writes a University table.

## The endpoint

`POST https://hub.neuroprogeny.com/api/intake`. The path is shared with the forms and with server mode,
and those keep working unchanged. A body with `device` and `submission` is a lead device request.

### Authentication

```
Authorization: Bearer <LEAD_INTAKE_SECRET>
Content-Type: application/json
```

- The secret is at least 32 random characters, set in the Hub's Vercel environment and on the calling
  server. Compared in constant time and never logged. It must never reach a browser.
- A missing or wrong secret, or a Hub with no secret set, is refused **401**.
- `LEAD_INTAKE_SECRET` and `HUB_INTAKE_SERVER_SECRET` are different secrets. Neither opens the other mode.

### Body

```json
{
  "device": {
    "slug": "sleep-reset-guide",
    "name": "Sleep Reset Guide",
    "brand": "neuro_progeny",
    "type": "lead_magnet",
    "description": "A short guide to resetting sleep through nervous system training.",
    "outcomes": [{ "key": "starter", "label": "Starter" }],
    "questions": [{ "key": "q1", "label": "How well did you sleep last week?" }],
    "fields": ["email", "first_name", "phone"],
    "email_consent_text": "Email me tips and offers from Neuro Progeny.",
    "sms_consent_text": "Text me reminders and offers. Message and data rates may apply. Reply STOP to opt out.",
    "asset_url": "https://neuroprogeny.com/guides/sleep-reset.pdf",
    "hot_lead_rule": { "outcomes": ["starter"] }
  },
  "submission": {
    "email": "person@example.com",
    "first_name": "Ana",
    "phone": "+18285550100",
    "outcome": "starter",
    "answers": { "q1": "Poorly" },
    "consent": {
      "email": true,
      "sms": false,
      "email_text": "Email me tips and offers from Neuro Progeny.",
      "sms_text": "Text me reminders and offers. Message and data rates may apply. Reply STOP to opt out."
    },
    "utm": { "source": "instagram", "medium": "social", "campaign": "sleep", "content": "reel-1" },
    "page_url": "https://neuroprogeny.com/sleep",
    "submitted_at": "2026-11-06T18:00:00Z",
    "idempotency_key": "site-sleep-3f9a1c"
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `device.slug` | yes | Lower case letters, numbers and single hyphens, at most 80 characters. Unique across the Hub. |
| `device.name`, `brand`, `type` | on the first submission | `brand` is `neuro_progeny` or `wnw`. `type` is `quiz`, `lead_magnet`, `webinar`, `tool`, `form` or `booking`. |
| `device.*` (the rest) | no | Stored as the manifest when the device registers. A later change to the manifest is made in the Hub, not by a submission. |
| `submission.idempotency_key` | yes | Your stable id for this submission, letters, numbers and `: _ . -`, at most 120 characters. **The call is idempotent on it**: a replay for the same device answers `200 { ok: true, duplicate: true }` and changes nothing. |
| `submission.email` | yes, or `phone` | How the contact is matched. |
| `submission.first_name`, `phone` | no | A new contact takes these. |
| `submission.outcome` | no | An outcome key from the manifest. It sets the outcome tag, the lists and the campaign. |
| `submission.answers` | no | An object of answers, keyed by question. |
| `submission.consent` | yes | `email` and `sms` count only when they are exactly `true`, and each needs its exact text in `email_text` or `sms_text`. Send what the person actually ticked, with boxes unticked by default. |
| `submission.utm` | no | `source`, `medium`, `campaign`, `content`, each at most 200 characters. |
| `submission.page_url`, `submitted_at` | no | Where and when it happened. |

### What the Hub does

1. Registers the device in draft if the slug is new, and creates what goes around it in dry run. If the
   device is not live, it stores the submission as a test and stops here.
2. Matches the contact by email, or by phone when there is no email, or creates one.
3. Adds the source and outcome tags, and stores the answers for the contact card's Device answers section.
   A new contact takes the device slug as its source. An existing contact keeps its source; the
   `lead_device` Smart List field covers attribution for both.
4. Records each consent as marketing consent with the text you sent. It never reverses the person's own
   earlier opt-out, and an SMS consent counts only when the phone sent is the phone on the contact.
5. Places the contact at New lead. A contact already on a pipeline keeps that place and is added to this
   pipeline alongside it. Then routes it through `route_and_enroll`.
6. Texts Cameron when the device's hot lead rule matches.

### Responses

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ ok: true, test, device_status }` | Accepted. `test` is true unless the device is live. `device_status` is `draft`, `live` or `paused`. |
| 200 | `{ ok: true, duplicate: true, test, device_status }` | This key was already accepted for this device |
| 400 | `{ error, fields? }` | A required field is missing, or a value does not fit |
| 401 | `{ error: "unauthorized" }` | Wrong or unset secret |
| 409 | `{ error }` | The slug belongs to a device hosted by the Hub |
| 500 | `{ error }` | Retry with the same key; it is safe |

Responses never contain contact data. Retry on 500 and on network errors with the same
`idempotency_key`. Do not retry 400, 401 or 409.

## Setting it up

1. Set `LEAD_INTAKE_SECRET` in the Hub's Vercel environment (Production and Preview) and on the server
   that will call this endpoint.
2. Send a test submission. It registers the device in draft.
3. Review the device on Hub Marketing, Lead Devices, then have Cameron switch it live.
