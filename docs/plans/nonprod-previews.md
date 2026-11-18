# Hub previews on nonprod (Running List q27)

**For:** Shane. **Written:** 2026-11-17.
**Why:** every Vercel preview of the Hub uses production's Supabase keys today, so a walkthrough on a branch
writes to production: settings saves, an unread badge cleared, the dialer's call log. This plan points the
**Preview** scope at nonprod (`npu-platform-nonprod`, `cpasntagxhxitavivwlb`) and leaves Production alone.

Order: create the two logins (step 1), the Hub chat applies the seed on a go (step 2), then switch Vercel
(step 3). Switching before the seed leaves a preview that signs in to an empty workspace.

## 1. Create the two nonprod logins

Nonprod logins cannot be made safely by SQL, so each is made in the dashboard. The seed looks them up by email.

| Login | Status on nonprod (17 Nov) |
|---|---|
| `shane@neuroprogeny.com` | **missing**: create it |
| `cameron@neuroprogeny.com` | exists (confirmed, owner of Neuro Progeny): nothing to do |

For each missing login:

1. Open the Supabase dashboard and pick the project **npu-platform-nonprod** (ref `cpasntagxhxitavivwlb`).
   Check the ref in the address bar before going on.
2. **Authentication**, then **Users**, then **Add user**, then **Create new user**.
3. Email: the address above. Password: a new one, not your production password.
4. Tick **Auto Confirm User**, so no confirmation mail is needed.
5. **Create user**.

Then tell the Hub chat both logins exist. The seed (`supabase/nonprod/seed_2026-11-17_staff.sql`) stops with a
clear error naming the email if either one is missing.

## 2. The seed

The Hub chat applies `supabase/nonprod/seed_2026-11-17_staff.sql` to nonprod on a separate go. It refuses to
run on production, writes the org, both memberships and team profiles, the Sales and Enrolled pipelines, the
org settings with every sending switch off, and five fake contacts. The file header has the full detail and the
rollback.

## 3. Point the Preview scope at nonprod

In Vercel: team **cameron projects**, project **npu-platform-v2** (the Hub's project), **Settings**, then
**Environment Variables**.

Change exactly three variables, and only their **Preview** value. For each one:

1. Find the variable. If it has one entry ticked for Production, Preview and Development together, open it and
   untick **Preview** on that entry, then save. Production keeps its value.
2. **Add New**: the same name, the nonprod value, environment **Preview** only. Leave Production and
   Development unticked. Save.
3. Check the list: the name now has two entries, one for Production (unchanged) and one for Preview.

| Variable | Where to copy the nonprod value from (nonprod dashboard, `cpasntagxhxitavivwlb`) |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Project Settings**, then **Data API**: Project URL. It is `https://cpasntagxhxitavivwlb.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Project Settings**, then **API Keys**: the `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Project Settings**, then **API Keys**: the `service_role` `secret` key (Reveal, Copy). Paste it straight into Vercel; never into a chat, a doc or a commit |

Never change the **Production** entry of any of the three.

### Redeploy the preview

`NEXT_PUBLIC_` values are built into the browser bundle at build time, so an existing preview keeps talking to
production until it is rebuilt. After saving the three variables:

- **Deployments**, open the newest deployment of the branch you will walk through, the **...** menu,
  **Redeploy**. Leave "Use existing Build Cache" **unticked**.
- Or push any new commit to the branch.

Every older preview URL still points at production. Walk through only on a preview built after the switch.

### Confirm the preview is on nonprod

1. Open the redeployed preview and sign in with the **nonprod** password from step 1. A production password
   failing here is the first good sign.
2. Open the browser's developer tools, **Network** tab, reload. Filter by `supabase.co`.
3. Every request host must be `cpasntagxhxitavivwlb.supabase.co`. Any request to `htfrfaxlcuyawtlztxxm` means
   the build is old: redeploy without the cache.
4. Contacts shows exactly the five **Test ...** contacts plus whatever nonprod already held, never the
   production list.

### Switch back

1. Vercel, **Environment Variables**: delete the three **Preview** entries added above.
2. Open each variable's Production entry and tick **Preview** again (or add a Preview entry with the
   production value), then save.
3. Redeploy the preview without the build cache, and check the Network tab now shows `htfrfaxlcuyawtlztxxm`.

## 4. What a nonprod preview can still reach for real

The switch moves the **database** only. Every other key in the Preview scope is still the real one, so a preview
can still reach real people and real accounts through these. Names only; read each scope in Vercel to see
which are set for Preview.

| Variable | What a preview does with it | Risk on a nonprod preview |
|---|---|---|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_TWIML_APP_SID`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_PHONE_NUMBER` | The org's Twilio fallback. The seed writes no `crm_twilio`, so on nonprod **every** call and text uses these: the dialer, `/api/sms/send`, the SMS outbox, lead alerts | **Real calls and texts from Neuro Progeny's number** to any number a person types. The fake contacts' `+1555...` numbers fail at Twilio, but a typed real number goes through. The TwiML app's voice URL is set in Twilio and points at production, so a browser call's call log lands in **production** |
| `TWILIO_VOICE_SIGNATURE_MODE` | How inbound Twilio webhooks are verified | Inbound only; no outbound reach |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL` | The base URL put in Twilio status and recording callbacks, Google Drive redirects, the NeuroReport webhook and links in messages | If set to `hub.neuroprogeny.com`, callbacks from a preview's calls and texts go to **production** and write there |
| `RESEND_API_KEY` | The marketing email provider | Sends only when `provider_email` and `gate_live_sends` are on; the seed sets both off, and the seed's sending domain is `example.com`, which Resend refuses. Real mail if someone turns them on |
| `RESEND_WEBHOOK_SECRET` | Verifies Resend's delivery webhooks | Inbound only |
| `APPS_SCRIPT_URL` | The Google Apps Script that sends mail as Neuro Progeny (fallback when the org's `gmail` setting has none). Used by Send Resources and the auditor | **Real email** from the Neuro Progeny Google account, not behind any marketing flag |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Connecting a staff Google mailbox (mail sync and sending) | A staff member who connects their real mailbox on a preview gives nonprod a token that can read and send their **real mail** |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Calendar and Drive | Reads and writes the **real calendar and Drive** of whoever connects |
| `NOTIFICATION_PHONE` | A staff phone number texted by the podcast conversion route | **Real text** to that staff phone |
| `HUB_NOTIFY_SECRET` | Authenticates `/api/notify/sms`, which texts staff | A caller with the secret can make a preview text staff for real (via the Twilio keys above) |
| `NEUROREPORT_URL` | The NeuroReport app the webhook route calls | Calls the **real NeuroReport** |
| `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY` | AI features and call transcription | Paid accounts: cost only, no person reached |
| `CRON_SECRET` | Authenticates the cron routes | Vercel runs crons on Production only, so a preview runs none on its own. A request carrying the secret can still run one by hand |
| `HUB_INTAKE_ALLOWED_ORIGINS`, `HUB_INTAKE_SERVER_SECRET` | The website intake endpoint | Inbound only; the seed sets `intake` off |
| `HUB_UNSUBSCRIBE_SECRET` | Signs unsubscribe links | No outbound reach |
| `READAI_WEBHOOK_SECRET` | Read AI's inbound webhook | Inbound only |
| `TURNSTILE_SITE_KEY` | The bot check on lead devices | No outbound reach |
| `HUB_WATCHDOG_USER_ID`, `NP_ORG_ID`, `NP_PIPELINE_ID` | Production ids the watchdog and onboarding read | Point at production rows that nonprod may not have: a page or cron using them finds nothing |

Slack has no env variable: its webhook lives in `org_settings` `slack_config`. Nonprod's Neuro Progeny row has a
webhook set and switched on today; the seed switches it off without reading or changing the webhook.

**To close the remaining gaps** (each a separate decision, not part of q27): give the Preview scope Twilio's
test credentials or no Twilio variables at all, unset `APPS_SCRIPT_URL`, `NOTIFICATION_PHONE` and
`HUB_NOTIFY_SECRET` for Preview, and set `NEXT_PUBLIC_APP_URL` for Preview to the preview's own URL.

## Found while checking (17 Nov)

- Nonprod's Neuro Progeny already holds 11 contacts, all on `gmail.com`, and 2 `messages` rows. They may be
  real people copied in earlier. The seed leaves them; deciding what to do with them is a separate go.
- Cameron's nonprod login has a different user id from production. `src/lib/notify/settings.ts` names
  production's id as the default alert recipient, so on nonprod that default points at nobody. Notifications are
  off in the seed, so nothing is affected until someone turns them on.
