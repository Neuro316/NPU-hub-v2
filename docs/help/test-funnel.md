---
id: test-funnel
title: Testing a funnel campaign end to end
route: /campaigns
help_ids: [funnel.test-drive, wizard.activate-test, funnel.status]
tags: [test, test drive, end to end, check a campaign, test contact, try it]
summary: A test drive puts your own test contact into a campaign through the real engine. Within about five minutes the first step runs, and the result and its reason appear on the campaign page.
related: [dry-run-vs-live, send-log, campaigns-hub]
---

## Steps
1. Make sure your test contact is on the allowlist in CRM Settings, Campaign Sending.
2. Open the campaign, set its Status to Active and press Save campaign.
3. In the Sending section, press Test drive with my test contact.
4. Wait for the engine's next run, about five minutes. The result appears below the button on its own.
5. Read the decision and its reason, and what would have been sent.
6. To test what starts the campaign, submit its form yourself, or move your test contact into the stage it listens for.
7. When you are done, set the campaign back to Draft or Paused if it is not ready for real people.

## Common mistakes
- A test drive only runs on an Active campaign.
- If the campaign engine is switched off, the test drive reports that and nothing runs.
- Your test contact is entered once per event. Running a test drive again while they are still in the campaign starts nothing new.
- While live sending is off, the test is a dry run: nothing is sent, but the decision is real.
