# Hub Gmail mailboxes (inbox agent phase 1): rulings and build plan

Branch `feat/mail-connections` off `main` at `1d9c316`. Migration `hub_216_mail_connections`
was **applied to production on 2026-11-01** (ledger version 20261102014051) after a separate go.

Scope: the connection layer only. No triage, drafting or sending.

## 1. What I read and what it means

- **Vault is enabled on production.** `supabase_vault` 0.3.1 is installed on `htfrfaxlcuyawtlztxxm`.
  service_role has usage on `vault` and full access to `vault.secrets`, `vault.decrypted_secrets` and
  `vault.create_secret`. authenticated has no usage on `vault`. The same database already stores
  NeuroReport calendar tokens this way (`nr_calendar_token_put/get`, migration 176), using SECURITY
  INVOKER functions that only service_role may execute. This build copies that pattern.
- **Migration number 215 is already taken in the ledger.** `hub_215_quick_send` is in the ledger
  (version 20261031160805), but its file was removed by the 2026-10-31 release revert. This
  migration is therefore **216**.
- **The existing Google OAuth code is not a model to copy.** Drive uses `state = orgId`, unsigned,
  and stores refresh tokens in plaintext in `org_settings`. Calendar uses a fixed state
  (`'npu_gcal'`) and plaintext `user_google_tokens`. The mail flow shares no code with either.
- **Role source.** `withStaff` (`src/lib/api-guard.ts`) provides `isSuperadmin`
  (`profiles.role = 'superadmin'`) and the caller's active staff orgs. The client never sees
  `profiles.role`, so the settings page asks `GET /api/mail/connections` and shows the section only
  when that call returns 200.

## 2. Rulings

1. **Superadmin only, on every route.** Each `/api/mail/*` route is wrapped in `withStaff` and
   returns 403 unless `ctx.isSuperadmin`.
2. **Visibility.**
   - A private connection is visible only to `owner_user_id`.
   - A shared connection is visible to superadmins who are active staff in its `org_id`.
   - A connection the caller cannot see returns 404, so a private mailbox's existence is never
     confirmed to anyone but its owner.
   - Only the owner can change visibility.
   - Check and Disconnect are allowed on any connection the caller can see.
3. **One owner per address.**
   - `email_address` is unique.
   - Reconnecting your own address replaces its Vault secret in place.
   - Connecting an address that is live under another user is refused (`mailbox_owned_by_other`,
     raised inside the database function), and the new grant is revoked at Google.
   - A revoked row can be claimed by whoever reconnects it. It resets to private.
4. **Signed state.**
   - The state is `b64url(json{user, org, nonce, exp}).HMAC`. Its key is derived from
     `GOOGLE_OAUTH_CLIENT_SECRET` under a fixed label, so no new env var is needed.
   - The state expires after 10 minutes.
   - The nonce is also set in an httpOnly, `Secure`, `SameSite=Lax` cookie scoped to
     `/api/mail/callback`.
   - The callback requires a valid MAC, an unexpired state, a matching user, a matching browser
     nonce, and an org the caller belongs to.
5. **Account checks at the callback.** The `id_token` from the token endpoint must show:
   - `email` ending in `@neuroprogeny.com`
   - `email_verified = true`
   - `hd = neuroprogeny.com`

   The granted scopes must include both `gmail.modify` and `gmail.send`, and a refresh token must
   be present. If any check fails, the grant is revoked at Google before redirecting.
6. **Redirect URI = request origin + `/api/mail/callback`.** Connect and callback build it the same
   way, so the session cookie is always present on return. On production this is
   `https://hub.neuroprogeny.com/api/mail/callback`. A preview host is not registered at Google, so
   connecting from a preview deployment fails at Google, which is the intended behavior.
7. **Disconnect.**
   - Revoke at Google first. A 400 from Google means the token is already dead, and counts as
     revoked.
   - If Google can't be reached, nothing is deleted locally, so the call can be retried.
   - Then `hub_mail_connection_revoke` deletes the Vault secret, nulls `vault_secret_id` and sets
     `status = 'revoked'`.
8. **Check.**
   - Exchanges the refresh token for an access token, then calls `users.getProfile`.
   - Success sets `last_checked_at` and `status = 'active'`.
   - Failure sets `last_error`. It also sets `status = 'error'` when the cause won't heal on retry:
     `invalid_grant`, a missing secret, or a profile for a different address.
   - The response is only `{ emailAddress, messagesTotal }`.
9. **No secrets or content in output.**
   - Every failure becomes a `MailError` with a fixed, Hub-written message.
   - Google response bodies are never echoed or logged. Logs carry only a short code
     (e.g. `invalid_grant`).
   - Redirects carry only a fixed outcome code.
   - No message content is fetched in this phase.
10. **Storage.** The table has RLS on with no policies. anon and authenticated have no privileges.
    The three functions are executable by service_role only. A delete trigger removes the Vault
    secret, including when an `auth.users` row is deleted and the cascade removes the connection.

## 3. Files

| File | Purpose |
|---|---|
| `supabase/migrations/hub_216_mail_connections.sql` | table, put/get/revoke functions, delete trigger |
| `src/lib/mail/google.ts` | state, OAuth, token, revoke, getProfile, visibility rules |
| `src/app/api/mail/connect/route.ts` | GET: signed state + cookie, redirect to Google |
| `src/app/api/mail/callback/route.ts` | GET: verify, exchange, store, redirect to Settings |
| `src/app/api/mail/connections/route.ts` | GET: list visible; PATCH: visibility (owner) |
| `src/app/api/mail/disconnect/route.ts` | POST: revoke at Google, drop secret, mark revoked |
| `src/app/api/mail/check/route.ts` | POST: getProfile health check |
| `src/components/settings/mailboxes-section.tsx` | Settings › Mailboxes UI |
| `src/app/(dashboard)/settings/page.tsx` | nav entry gated on the list endpoint |

## 4. Operator steps

- Add `https://hub.neuroprogeny.com/api/mail/callback` to the Authorized redirect URIs of the
  "NPU Hub Mail" OAuth client.
- `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are already set in Vercel. Both must
  also be listed in `.env.example` (guard G3).
