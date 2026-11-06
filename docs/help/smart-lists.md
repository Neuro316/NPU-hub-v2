---
id: smart-lists
title: Building and using smart lists
route: /smart-lists
help_ids: []
tags: [smart list, list, audience, segment, filter, broadcast, target, texting allowed, current client, no data source]
summary: A smart list is a saved filter that is always current. Campaigns and broadcasts target a list, and any text message is limited to people with Texting allowed, whichever list is used.
related: [campaigns-hub, consent-unsubscribe, dry-run-vs-live, send-log]
---

## Steps
1. Open Smart Lists under GROW, then choose a list or press New list.
2. Add filters and choose whether a person must match all of them or any of them.
3. Watch the live count and the members update, then press Save.
4. To point a campaign at the list, choose the campaign and press Target this list.
5. To start a one-message send, press New broadcast. It creates a draft campaign on this list.
6. When a campaign is Active, press Enroll members. Pressing it again only adds people who joined the list since.

## Common mistakes
- A list with no filters has no members. It never means everyone.
- A list marked no data source yet has a filter nothing records so far, and that filter matches nobody.
- Enrolling does not send by itself. Each message still has to pass the send decisions, including consent and the send window.
- Texting allowed means a current client or an SMS opt-in, without a STOP or do not contact, and with a phone number in international format.
- WNW lists can be built, but WNW sends are refused until a WNW sender is configured.
