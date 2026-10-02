---
id: sequences-steps
title: Writing a campaign's steps
route: /campaigns
help_ids: [funnel.steps, steps.add, steps.kind, steps.preview, steps.save]
tags: [steps, sequence, messages, email, text message, sms, wait, delay, send after, kind, marketing, service, preview, merge tags]
summary: A campaign's steps are the messages people receive, in order. Each step waits for its delay after the previous one, then sends an email or a text, or simply waits.
related: [campaigns-hub, university-assets, consent-unsubscribe, sending-settings]
---

## Steps
1. Open the campaign on the Funnels tab and find the Steps section.
2. Press Add a step for each message.
3. Choose the Channel: Email, Text message, or Wait. A wait step sends nothing and only adds time.
4. Set Send after (hours): how long to wait after the previous step, or after the person enters for the first step. Zero means right away.
5. Choose the Kind of message. Marketing goes only to people who agreed to marketing on that channel. Service is for confirmations, reminders and things the person asked for.
6. Write the subject for an email and the message itself. You can use {{first_name}}, {{last_name}} and {{org_name}}.
7. Press Preview to see the message with a sample name. Nothing is sent.
8. Press Save steps.

## Common mistakes
- A step left without a kind counts as marketing, the stricter rule.
- Do not write your own unsubscribe line or opt out text. Marketing emails get an unsubscribe link and marketing texts get "Reply STOP to opt out." added for you.
- A text message that is too long once names and the opt out line are added is refused on save. Shorten it.
- Editing a message removes its Not previewed check; preview it again before you rely on it.
