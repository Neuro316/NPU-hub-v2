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
