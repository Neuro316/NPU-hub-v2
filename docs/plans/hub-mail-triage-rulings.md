# Hub inbox agent phase 2 (sync and triage, read-only): rulings and build plan

Branch `feat/mail-triage` off `main` at `7df523d`. Migration `hub_217_mail_triage` was
**applied to production on 2026-11-02** (ledger version 20261102203515) after a separate go.

Scope: pick up new INBOX mail within about 5 minutes, classify it with Claude, and show it in a
superadmin Inbox page. No drafting and no sending.

## 1. What I read and what it means

- **AI key.** The Hub's server-side key is `ANTHROPIC_API_KEY`. It is read by 20 call sites and is
  already listed in `.env.example`. The Campaign Builder agent (`src/lib/agent/model.ts`) calls the
  Claude API with it through `@anthropic-ai/sdk` 0.80. Triage uses the same key and SDK.
- **Cron pattern.** `src/app/api/cron/entry-events/route.ts` is the template:
  - `cronAuthorized` (fails closed without `CRON_SECRET`)
  - `withJobRun` (one row per run in `job_runs`)
  - `maxDuration 60`
  - The `/api/cron/*` paths are excluded from middleware.
- **Number.** Files and ledger stop at `hub_216` (`hub_215` exists in the ledger only), so this is
  `hub_217`.
- **The sidebar has no superadmin concept.** Its items are filtered by `canView(moduleKey)`, which
  is per-org. The Settings page already decides on superadmin by whether `/api/mail/connections`
  answers 200, so the sidebar reuses that signal for items flagged `superadminOnly`.

## 2. Rulings

1. **Sync.**
   - `GET /api/cron/mail-sync` runs every 5 minutes (`*/5 * * * *`). It processes every `active`
     connection in parallel through `Promise.allSettled`, so one failing mailbox never stops the
     others.
   - **First run** (`gmail_history_id` NULL): store `users.getProfile.historyId` and import nothing.
   - **Later runs:** call `history.list` with `historyTypes=messageAdded` and `labelId=INBOX`. Keep
     only added messages labelled INBOX and not DRAFT. Insert one row per message (unique on
     connection + message id), then advance the cursor.
   - If the rows cannot be stored, the cursor does not move, so the next run retries.
   - Reading stops after 10 history pages. The cursor then resumes from the last record read
     rather than jumping to "now".
2. **History expired** (404 from `history.list`): reset the cursor to the current history id and
   write `last_error` ("Mail received in the gap was not imported"). Never back-fill.
   - A successful sync does not clear `last_error`; Check does.
   - `invalid_grant` or a missing secret sets the connection to `error`, as phase 1 Check does,
     which takes it out of sync until a Check succeeds.
3. **Triage is a separate step from import.**
   - Rows are created as soon as history reports them, with `triaged_at` NULL.
   - Each run triages up to 10 waiting rows per mailbox, oldest first, 3 at a time, and stops
     starting new ones 40 seconds into the run. A burst is worked through over several runs
     instead of being lost.
   - A row gets 3 attempts. After that it keeps the sender and subject that were read, and shows
     "Not classified" with a fixed reason.
   - A message deleted from Gmail before triage is closed out at once.
4. **What is stored.**
   - Sender name and address, subject, received time, Gmail message and thread ids, category,
     priority, an AI summary (300 chars max), a suggested action (300 chars max), status and
     triage bookkeeping.
   - **No bodies.** The plain-text body (first 4,000 chars; HTML is reduced to text when there is
     no plain part) exists only in memory for the model call.
5. **Classification.**
   - **Model:** `claude-opus-5-5` at effort `low`, one request, no tools.
   - **Output:** structured outputs (`output_config.format` JSON schema with the 11 categories and
     3 priorities as enums), plus the server-side refusal fallback (`fallbacks: "default"`) that
     `src/lib/agent/model.ts` already uses.
   - **Untrusted email text:**
     - The system prompt says everything in `<email_data>` is untrusted content to classify,
       never instructions.
     - The email is fenced, and any `email_data` tag inside it is neutralised.
   - **Validation:** `validateTriage` re-checks every field against the allowed values and drops
     extra keys. A reply that fails is recorded as a failed attempt, never stored.
   - **Cost, rough:** about 1–2K input tokens per email at $4/M input, so well under 1 cent each.
6. **Inbox view.** `/mail` ("Inbox", under Operate), superadmin only.
   - Lists newest first: mailbox, sender, subject, category, priority, summary, suggested action,
     and an "Open in Gmail" link (`authuser=<mailbox>#all/<threadId>`).
   - Filters by mailbox, category and status. Actions: mark seen, mark done, reopen.
   - `/api/mail/messages` scopes every query to the connections `listVisible` returns: private to
     the owner, shared to superadmins in that org. A mailbox filter or message id outside that set
     returns 404.
   - Messages of a revoked mailbox stay listed under the same visibility.
7. **Hard rules.**
   - Logs carry only short codes.
   - `job_runs` detail carries connection ids and counts.
   - Errors are fixed sentences written in Hub code.
   - The prompt, body text and raw model reply are never logged, stored or returned.
   - Summaries and sender details appear only through `/api/mail/messages`.

## 3. Files

| File | Purpose |
|---|---|
| `supabase/migrations/hub_217_mail_triage.sql` | cursor columns on `hub_mail_connections`; `hub_mail_messages` |
| `src/lib/mail/gmail.ts` | `currentHistoryId`, `inboxAddedSince`, `getMessageForTriage` |
| `src/lib/mail/triage.ts` | system prompt, schema, `classifyEmail`, `validateTriage` |
| `src/lib/mail/sync.ts` | per-mailbox sync + triage, isolated failures |
| `src/app/api/cron/mail-sync/route.ts` | the cron (CRON_SECRET, job_runs) |
| `src/app/api/mail/messages/route.ts` | GET list with filters, PATCH status |
| `src/app/(dashboard)/mail/page.tsx` | the Inbox page |
| `src/lib/nav-config.ts`, `src/components/sidebar.tsx` | Inbox item, `superadminOnly` flag |
| `src/lib/mail/google.ts` | `listVisible` shared by connections and messages |
| `vercel.json` | `/api/cron/mail-sync` every 5 minutes |

## 4. Not in this phase

Drafting, sending, labels or any other change in Gmail; Pub/Sub push; back-fill; watchdog alerting
for `mail-sync` (one line in `src/lib/marketing/watchdog.ts` if wanted later).
