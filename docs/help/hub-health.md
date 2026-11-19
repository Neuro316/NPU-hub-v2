---
id: hub-health
title: Hub Health and health alerts
route: /health
help_ids: []
tags: [hub health, health, status, alerts, bell, acknowledge, red, amber, green, ci, deploy, migrations, guards, platform health]
summary: Hub Health shows superadmins a green, amber or red tile for each part of the Hub that can break, with a one-line reason and the ones that need attention first. A change of colour opens or clears an alert in the bell.
related: [notification-settings]
---

## Steps
1. Open Hub Health from the card on the Hub home, or go to /health. It is for superadmins.
2. Read Needs attention first: red tiles, then amber. Each tile says in one line why it has that colour.
3. A tile is captured every 30 minutes. Unknown means its source could not be read, for example a token that is not set.
4. When a tile changes colour, an alert opens in the bell. When it turns green again, the alert clears. Alerts from the platform's own health checks show in the same list.
5. In the bell, press Acknowledge on an alert once someone is looking at it. The Hub records who acknowledged it and when.

## Common mistakes
- A tile that stays the same colour does not alert again. Only a change opens or clears an alert.
- Only a change to red sends a text, and only when notifications are live. Otherwise the text is held and noted on the alert.
- Acknowledging an alert does not fix or clear it. It clears on its own when the tile turns green.
