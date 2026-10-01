---
id: dry-run-vs-live
title: Dry runs, live sending and the test contact allowlist
route: /campaigns
help_ids: [funnel.live, sending.switches, sending.allowlist]
tags: [dry run, live, live sending, allowlist, test contacts, real messages, go live]
summary: Every campaign message is a dry run until live sending is switched on. A dry run records exactly what would have been sent and sends nothing. Test contacts on the allowlist can receive real messages before a campaign goes live.
related: [test-funnel, sending-settings, send-log]
---

## Steps
1. While the Live sending switch is off for your organization, every message is a dry run.
2. When it is on, only test contacts on the allowlist receive real messages, and everyone else still gets a dry run.
3. To send a campaign for real to everyone who agreed, a platform superadmin ticks Live sending for this campaign in its Sending section.
4. The test contacts are listed at the bottom of CRM Settings, Campaign Sending.

## Common mistakes
- A dry run still runs every check, so its recorded reason tells you whether the real message would have gone out.
- Live sending for one campaign does not switch on any other campaign.
- Email and text messages each have their own switch as well; with one off, that channel is not sent even when live.
