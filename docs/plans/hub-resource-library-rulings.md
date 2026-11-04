# Build 2: Resource Library — rulings and build plan

Branch `feat/resource-library` off `main` at `198e496`. Migration `hub_222_resource_library`
was **applied to production on 2026-11-03** (ledger 20261103125315). The rulings below were
accepted at the go.

**Amended at the go:** `hub_resource_sends.mailbox_id` is nullable with `on delete set null`.
Deleting a Hub user cascades to `hub_mail_connections`, and a plain foreign key would block
that. A send row keeps its `from_address` either way.

**Tests:** `node scripts/resources/plan-check.mjs` passes 11/11 (the 20 MB split and the
email text).

## 1. What I read

- **The sending mailbox.** `cameron.allen@neuroprogeny.com` is connected in
  `hub_mail_connections`: active, `gmail.send` granted, **private**, owned by
  cameron@neuroprogeny.com.
- **Platform superadmins:** cameron@, paul@, shane@.
- **Storage.** No bucket fits:
  - `pipeline-resources` lets any signed-in user read.
  - `builder-resources` is publicly readable.
  - Every existing storage policy names its own bucket, so a new bucket with no policies is
    reachable only by the service role.
- **Existing "pipeline resources"** (`pipeline_resources`, per pipeline stage) has 0 rows and
  is left untouched. It isn't reused because its bucket is readable by every signed-in user.

## 2. Rulings (mine, to confirm at the go)

1. **Who.** The Resources page and every resource route are for platform superadmins
   (`profiles.role`) who are members of the org. Resources belong to an org.
2. **Who can press Send.** Sending uses the existing mailbox rule (`canSee`): a private mailbox
   is usable only by its owner.
   - Today only Cameron can send from cameron.allen@. Paul and Shane see the panel with Send
     disabled and the reason.
   - If Cameron makes the mailbox **shared** in Settings › Mailboxes, any superadmin in the org
     can send from it.
3. **Uploads skip the app server.** Vercel caps request bodies at 4.5 MB, so:
   - The route checks the role, type and size, then returns a one-time signed upload URL.
   - The browser uploads straight to the private bucket.
   - The server then confirms the object exists and records its size and type **from storage,
     not from the browser**.
   - Allowed files: PDF, DOCX, JPEG, PNG, GIF and WebP, up to 50 MB each.
4. **The 20 MB rule**, measured on the files' own sizes:
   - Every checked file is attached.
   - While the total is above 20 MB, the **largest** attached file moves to a signed link.
   - Links expire after **7 days**. The preview says which files are linked and when the links
     expire, and the email says so too.
   - Mail goes through Gmail's upload endpoint (`message/rfc822`, up to 35 MB). 20 MB of files
     is about 27 MB once encoded.
5. **The email.**
   - From and to:
     - From cameron.allen@, so it lands in that mailbox's Sent folder.
     - To the contact's email, which must pass `isUsableEmail`.
     - No CC or BCC.
   - Content:
     - The subject defaults to "Resources from Neuro Progeny" and is editable.
     - The note is prefilled with the brief's text and is editable.
     - Plain text and HTML. No signature is added; Cameron can type one into the note.
   - Preview and Send are separate requests, and the panel shows the preview before Send is
     enabled. No cron or automation can send.
6. **The record.**
   - One `hub_resource_sends` row per email: sender, mailbox, recipient, subject, attached and
     linked files, and the Gmail message id.
   - A `resources_sent` timeline entry naming the files.
   - The note, file contents, URLs and tokens are never stored or logged.
7. **Archive, don't delete.** An archived file leaves the library and the send panel, but its
   object stays in storage so links already sent keep working until they expire.
8. **Order.** Up and down buttons rewrite `sort_order`. The send panel lists active files in
   that order, with the "default for discovery follow-up" files pre-checked.

## 3. Access

| Surface | Who |
|---|---|
| `/resources` page, `/api/resources/*` | Platform superadmin **and** member of the org |
| `POST /api/resources/send` | The above, **and** allowed to use the sending mailbox (`canSee`) |
| `hub_resources`, `hub_resource_sends` | RLS on, no policies, service role only |
| Bucket `hub-resources` | Private, no storage policies, service role only. Signed upload URLs are single-use; signed download URLs last 7 days and appear only in the email |

## 4. Files (after the go)

| File | Purpose |
|---|---|
| `supabase/migrations/hub_222_resource_library.sql` | Bucket and the two tables |
| `src/lib/resources/plan.ts` | Pure rules: the 20 MB split and the email text |
| `src/lib/resources/send.ts` | MIME build and the Gmail upload send |
| `src/app/api/resources/*` | List, upload URL, create, edit, reorder, archive, preview, send |
| `src/app/(dashboard)/resources/page.tsx` | The Resources page (superadmin nav item) |
| `src/components/crm/send-resources.tsx` | The contact card's Send resources panel |
| `scripts/resources/plan-check.mjs` | Checks for the 20 MB split |
