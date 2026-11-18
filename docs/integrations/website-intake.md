# Website intake contract: neuroprogeny.com to the Hub

**For:** the Neuroprogeny.com Website session. **Written:** 2026-11-17 (Running List q08, Hub half).
**Status:** the endpoint is live. The three forms below are proposed and switch on at a separate go
(`supabase/data/2026-11-17_website_intake_forms.sql`). Until then every post answers **404**.

No secrets are needed or used. The website posts straight from the visitor's browser.

## The endpoint

```
POST https://hub.neuroprogeny.com/api/intake
Content-Type: application/json
```

- **Origins allowed today:** `https://neuroprogeny.com`, `https://www.neuroprogeny.com` and
  `https://transitions.neuroprogeny.com` (the Transitions quiz, hosted on Netlify). Checked with a CORS preflight
  (204) at 15:08 CST on 17 Nov 2026. A page on any other origin is refused **403**.
- **Never send an `Authorization` header** from the browser. A header switches the endpoint into a server mode and
  is refused 401.

## The forms

| Form | `form` slug | Field keys (`values`) | Consent ids |
|---|---|---|---|
| Contact or inquiry | `np-website-contact` | `first_name` (required), `last_name`, `email` (required), `phone`, `message` | `email_marketing`, `sms_marketing` |
| Transitions quiz | `np-transitions-quiz` | `first_name` (required), `last_name`, `email` (required), `phone`, `quiz_outcome` (required) | `email_marketing`, `sms_marketing` |
| Newsletter | `np-newsletter` | `first_name`, `last_name`, `email` (required), `phone` | `email_marketing` (required), `sms_marketing` |

- Every value is a string of at most 500 characters. `phone` is any US or international number the visitor types;
  the Hub normalises it. `quiz_outcome` is the result key or name the quiz shows (for example `steady`).
- **Consent checkboxes** show this wording exactly (approved by Cameron, 18 Nov 2026). The Hub records its own copy
  of the wording, so the page must match it word for word:

  | Box | Wording | Starts |
  |---|---|---|
  | `email_marketing` | "Email me news and offers from Neuro Progeny. I can unsubscribe at any time." | **Ticked** |
  | `sms_marketing` | "Text me reminders and offers from Neuro Progeny. Message and data rates may apply. Reply STOP to opt out." | **Unticked** |

  - **The default is set on the website, not in the Hub.** The Hub's form has no "starts ticked" setting; it only
    receives the ids of the boxes the visitor left ticked in `consents`. A visitor can untick the email box, and
    then `email_marketing` is simply not sent.
  - Cameron accepted on 18 Nov that a pre-ticked email box is not valid consent for visitors in the EU or the UK.
  - If the wording changes, the Hub form changes first and this file is updated.
- Show the `sms_marketing` box only next to a phone field.

## The body

```json
{
  "form": "np-website-contact",
  "values": {
    "first_name": "Ana",
    "last_name": "Rivera",
    "email": "ana@example.com",
    "phone": "(828) 555-0100",
    "message": "I would like to learn about the Capacity Protocol."
  },
  "consents": ["email_marketing"],
  "website": "",
  "utm": { "utm_source": "instagram", "utm_medium": "social", "utm_campaign": "fall-launch" }
}
```

| Key | Required | Meaning |
|---|---|---|
| `form` | yes | One of the slugs above |
| `values` | yes | Keyed by the field keys above. Unknown keys are ignored |
| `consents` | no | The ids of the boxes that are ticked when the visitor submits (the email box starts ticked, the text box unticked). Leave out or send `[]` when none |
| `website` | yes | The **honeypot**: a text input hidden from people (off-screen, `tabindex="-1"`, `autocomplete="off"`), always sent, normally `""`. When a bot fills it, the Hub answers 200 and drops the submission |
| `utm` | yes when present | Every `utm_*` parameter **from the page URL** (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`), at most 200 characters each. Keys that do not start with `utm_` are dropped. Carry them from the landing URL to the form page (for example in `sessionStorage`) so a visitor who browses first is still attributed |

Quiz body (the outcome is a field; the answers stay on the website):

```json
{
  "form": "np-transitions-quiz",
  "values": { "first_name": "Ana", "email": "ana@example.com", "quiz_outcome": "steady" },
  "consents": ["email_marketing", "sms_marketing"],
  "website": "",
  "utm": { "utm_source": "podcast", "utm_campaign": "transitions" }
}
```

Newsletter body:

```json
{
  "form": "np-newsletter",
  "values": { "email": "ana@example.com" },
  "consents": ["email_marketing"],
  "website": "",
  "utm": {}
}
```

## A working example

The two consent boxes, with their starting state and exact wording (show the text box only on forms with a phone
field):

```html
<label>
  <input type="checkbox" name="consent" value="email_marketing" checked>
  Email me news and offers from Neuro Progeny. I can unsubscribe at any time.
</label>
<label>
  <input type="checkbox" name="consent" value="sms_marketing">
  Text me reminders and offers from Neuro Progeny. Message and data rates may apply. Reply STOP to opt out.
</label>
<!-- the honeypot: hidden from people, always sent -->
<input type="text" name="website" value="" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px">
```

Collect the ticked ones when the form is submitted:
`const consents = [...form.querySelectorAll('input[name="consent"]:checked')].map((b) => b.value)`.

On success the Hub answers with the form's own message, which the page shows as it is:

| Form | `message` on success |
|---|---|
| `np-website-contact` | "Thank you. We have your message and will be in touch soon." |
| `np-transitions-quiz` | "Thank you. This is a great first step toward identifying the patterns that may be keeping you from living in alignment with your true self." |
| `np-newsletter` | "Thank you for signing up." |

```js
async function sendToHub(form, values, consents, honeypot) {
  const params = new URLSearchParams(window.location.search)
  const utm = {}
  for (const [k, v] of params) if (k.startsWith('utm_')) utm[k] = v.slice(0, 200)

  let res
  try {
    res = await fetch('https://hub.neuroprogeny.com/api/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ form, values, consents, website: honeypot || '', utm }),
    })
  } catch {
    // network error, or the origin is not allowed (403 with no CORS header reaches the page as a failed fetch)
    return { ok: false, message: 'We could not send this. Please try again in a moment.' }
  }
  const body = await res.json().catch(() => ({}))
  if (res.ok) return { ok: true, message: body.message }                       // show body.message
  if (res.status === 400) return { ok: false, fields: body.fields || {}, message: body.error }
  if (res.status === 429) return { ok: false, message: body.error }           // ask them to wait a few minutes
  return { ok: false, message: body.error || 'We could not send this. Please try again.' }
}
```

## Responses the site must handle

| Status | Body | Meaning | What the page does |
|---|---|---|---|
| 200 | `{ ok: true, message }` | Accepted (also the answer when the honeypot was filled) | Show `message` and clear the form |
| 200 | `{ ok: true, duplicate: true, message }` | Only in the Hub's server mode, which the browser never uses. Treat as accepted if ever seen | Same as 200 |
| 400 | `{ error, fields }` | A value does not fit. `fields` maps a field key to a message, `consent:<id>` to a consent message, or `_form` when neither an email nor a phone was given | Show each message next to its field; do not retry |
| 404 | `{ error }` | The form is not published, or intake is switched off | Show `error`; do not retry |
| 429 | `{ error }` | Too many submissions: more than 5 from one address in 10 minutes, or 60 to one form in a minute | Show `error`; let the visitor try again later |
| 403 | empty | The page's origin is not allowed | A failed fetch in the browser. Report it to Shane |
| 500 | `{ error }` | Save failed | Show `error`; one retry is safe |

Responses never contain contact data.

## What the Hub does with a submission

1. Matches the contact by email (or phone when there is no email) in Neuro Progeny, or creates one. A new
   contact's source on the card is the form's source key (`website:np-contact`, `website:np-transitions-quiz`,
   `website:np-newsletter`).
2. Fills a blank phone, never overwrites one, and records each ticked consent with the Hub's own wording. It
   never reverses a person's earlier opt-out.
3. Within 5 minutes, places a contact the submission created in Sales Pipeline at New Lead. An existing contact
   keeps their place.
4. Routes the source key into any campaign that listens for it. None does yet; that is a separate go.

## Why the quiz uses a form, not a lead device

The Hub's lead-device path for external sites (`docs/INTEGRATION_CONTRACT.md`) needs a server-side secret
(`LEAD_INTAKE_SECRET`) that must never reach a browser, and it treats every submission as a test until the device
is switched live. A form posts from the browser with no secret and is real from the moment it is published. If the
quiz later needs per-question answers on the card, outcome tags and lists, move it to a lead device posted from a
server, under that contract.
