---
id: sending-settings
title: Campaign Sending settings
route: /crm/settings
help_ids: [sending.settings, sending.save, sending.switches, sending.allowlist]
tags: [campaign sending, sender, from address, sending domain, reply to, quiet hours, send window, frequency cap, marketing limit, switches, time zone]
summary: CRM Settings, Campaign Sending holds the sender, the hours messages may go out, how many marketing messages a person may get, the switches for the campaign engine and its parts, and the test contacts.
related: [dry-run-vs-live, consent-unsubscribe, test-funnel]
---

## Steps
1. Open CRM, then CRM Settings, and choose Campaign Sending.
2. Set From, the Sending domain verified in Resend, and where replies go.
3. Set the Time zone for people with none on file, and when the Send window opens and closes.
4. Set Marketing messages per person at most, and In any number of days.
5. Press Save sending settings.
6. A superadmin can turn each switch on or off under Switches, such as the campaign engine, live sending, email, text messages and public forms.

## Common mistakes
- Until a real sending domain is set, no campaign email can go out live.
- The send window follows each person's own time zone. A message outside it waits until the window opens.
- The marketing limit counts emails and texts together. Service messages do not count.
- Only a platform superadmin can change the switches.
