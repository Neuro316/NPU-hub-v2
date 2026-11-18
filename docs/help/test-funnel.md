---
id: test-funnel
title: Testing a funnel campaign end to end
route: /campaigns
help_ids: [funnel.test-drive, wizard.activate-test, funnel.status]
tags: [test, test drive, end to end, check a campaign, test contact, try it]
summary: A test drive puts your own test contact into a campaign through the real engine. It skips the campaign's waits and exit rules, so every step runs in turn, about five minutes apart, and each step's decision, reason and message appear on the campaign page.
related: [dry-run-vs-live, send-log, campaigns-hub]
---

## Steps
1. Make sure your test contact is on the allowlist in CRM Settings, Campaign Sending.
2. Open the campaign, set its Status to Active and press Save campaign.
3. In the Sending section, press Test drive with my test contact.
4. Wait for the engine's next run, about five minutes. Each step then runs on the next run after the one before, without the campaign's waits, and the result appears below the button on its own.
5. For each step, read the decision and its reason, and the subject and first lines of what would have been sent, with your test contact's name filled in.
6. The latest test drive stays on the page after it ends, with when it ran and, if it ended early, why.
7. To test what starts the campaign, submit its form yourself, or move your test contact into the stage it listens for.
8. When you are done, set the campaign back to Draft or Paused if it is not ready for real people.

## Common mistakes
- A test drive only runs on an Active campaign.
- If the campaign engine is switched off, the test drive reports that and nothing runs.
- Your test contact is entered once per event. Running a test drive again while they are still in the campaign starts nothing new.
- While live sending is off, the test is a dry run: nothing is sent, but the decision is real.
- A test drive ignores the campaign's exit rules, such as a cancelled booking or a payment on your test contact, so it always shows every step. Real people still leave the campaign when a rule applies, and still wait the full time between steps.
