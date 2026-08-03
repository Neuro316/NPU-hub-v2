# NPU Hub — PWA Push Notifications: Feasibility Assessment

**2026-08-02. Design assessment only. Nothing built, no manifest, no migration, no
dependency added.**

Goal as stated: push notifications with a **badge count on an Android home-screen icon**,
so replies happen inside the CRM from the CRM number rather than from a personal phone.
Single user for now.

---

## Headline: one part of the request is not reliably deliverable on Android

**The notification half is straightforward. The badge-count-on-the-icon half is not.**

`navigator.setAppBadge()` (the Badging API) is supported by Chrome and Edge on **desktop**
— Windows, macOS, ChromeOS. **Chrome on Android does not implement it for installed
PWAs.** Android launchers show a *notification dot* driven by the presence of
notifications, not an application-set integer.

So the achievable Android behaviour is:

- a real push notification, with title/body/actions — **yes, works well**;
- a launcher **dot** on the icon while notifications are unread — **yes, launcher-dependent**;
- a **numeric count** rendered on the home-screen icon — **not reliably; treat as unavailable**;
- a numeric count **inside the notification and inside the app** — yes.

This should be settled before any build starts, because it is the specific thing that
was asked for. Worth knowing: the in-app unread count **already exists** —
`conversations/page.tsx` computes `unreadTotal` from `threads[].unread_count`.

---

## c1. What exists today — nothing. This is greenfield.

Verified, not assumed:

| Artefact | Status |
|---|---|
| `public/manifest.json` / `*.webmanifest` | **absent** — `public/` contains only `images/` and `templates/` |
| `src/app/manifest.ts` (Next metadata route) | **absent** |
| Service worker (`sw.js`, `service-worker.*`) | **absent** — repo-wide `find` returns nothing |
| `next-pwa` / `serwist` / `workbox` / `web-push` | **absent** from `package.json` |
| `next.config.js` | bare — `{ reactStrictMode: true }` only |
| Root layout metadata | `title` + `description` only (`src/app/layout.tsx:7-10`). No `manifest`, no `themeColor`, no icons |

**Nothing is generated implicitly.** Next.js emits a `<link rel="manifest">` only when
`app/manifest.ts` exists or `metadata.manifest` is set; neither is present. There is no
partial PWA to finish — every piece is new.

**What does exist, and is directly reusable:** a mature cron system — 10 jobs in
`vercel.json`, and a `CRON_SECRET` bearer-auth pattern at
`api/cron/crm-due-dates/route.ts:5-8`. That matters for c4.

---

## c2. Scope of a Web Push build

### Pieces required

| Piece | Work | Notes |
|---|---|---|
| Manifest | Small | `app/manifest.ts`, plus real icons at 192/512 — `public/` has none today |
| Service worker | Small–medium | Hand-rolled `public/sw.js` (origin scope) handling `push` and `notificationclick`. Avoids a new dependency |
| VAPID keys | Trivial | Generate once; 2 Vercel env vars (public + private) |
| Subscriptions table | Small | `endpoint`, `p256dh`, `auth`, `user_id`, `org_id`, `user_agent`, `created_at`, `last_seen_at` — plus RLS. **Schema change: needs approval** |
| Subscribe/unsubscribe route | Small | Permission prompt + `pushManager.subscribe()`, POST to the Hub |
| Send path | Medium | `web-push` npm package — **new dependency, needs approval per CLAUDE.md** — invoked from the inbound-SMS webhook |
| Badging | Small, low value | `setAppBadge()` on desktop only; see headline |

Single-user scope keeps fan-out, batching, and quiet hours out of v1.

### What makes this harder here than greenfield

1. **The authorization substrate is mid-migration.** A new `push_subscriptions` table
   needs an RLS policy, and *which* substrate to key it on is an open question right now
   (`HUB_ROLE_DECOUPLING.md`). Keying it on `org_members` would create exactly the
   coupling Phase 2 is removing; keying it on `team_profiles` pre-empts Phase 1. **Either
   build it after Phase 1, or scope it to `user_id = auth.uid()` only** — which is
   correct anyway for a per-device subscription and sidesteps the question entirely.
   *Recommend the latter.*
2. **Multi-org.** `WorkspaceContext` switches orgs and persists to `localStorage`. A
   subscription is per-device, but a notification must be org-scoped or the wrong org's
   messages will alert. Single-user today makes this invisible and it will bite later.
   Store `org_id` from day one even though nothing reads it yet.
3. **A service worker is origin-wide.** It will intercept every route in the app, not
   just CRM. A scope bug becomes an app-wide bug. Keep it minimal: `push` and
   `notificationclick` handlers, **no** caching/offline strategy in v1. Offline caching is
   where PWA builds usually go wrong, and none of it is needed here.
4. **Two new npm packages** (`web-push`, and any SW tooling) require approval per
   `CLAUDE.md`. The hand-rolled SW avoids the second.
5. **The `.catch`/discarded-error habit.** This codebase has ten recorded instances of a
   failed call whose error is swallowed (see `HUB_403_INVESTIGATION.md`). A push send that
   fails silently would reproduce it exactly. Subscription-expiry (`410 Gone`) **must** be
   checked and the row deleted, or the table fills with dead endpoints that fail forever.

**Honest estimate:** 2–3 focused days for notification delivery on inbound SMS,
single-user, no offline caching, assuming the two dependencies are approved. The badge
count is not included because it is not deliverable on Android.

---

## c3. Which events survive if the Twilio callback subsystem is still broken

**This is the decisive question, and the answer is favourable.** Part A established that
Twilio callbacks are *not* uniformly broken — different webhooks have different health:

| Event | Webhook | Health (measured 2026-08-02) | Push on day one? |
|---|---|---|---|
| **Inbound SMS** | `/api/twilio/inbound-sms` | **HEALTHY** — 11 rows written, latest **19:55 today** | **YES** |
| Inbound call ringing | `/api/twilio/inbound-call` | **HEALTHY** — `call_logs` rows created, latest 07-31 | YES |
| Voicemail recorded | `/api/twilio/recording-ready` | Worked (8 recordings) but **no input since 07-21** | Conditional |
| Voicemail transcribed | `/api/twilio/transcription` | Worked twice; **2 of 8** succeeded | Unreliable |
| Call completed | `/api/twilio/call-status` | **Uncertain** — 8 calls stuck at `ringing` | Unknown |
| **Outbound delivery status** | `/api/twilio/message-status` | **BROKEN** — 1 success in the system's history | **NO** |

**The event Cameron actually wants rides on the healthy webhook.** "A text came in →
notify me → I reply in the CRM" depends only on `/api/twilio/inbound-sms`, which is
demonstrably working *today* and is a **different route** from the broken one.

**Finding 3 does not block this build.** The only casualty is "your outbound message was
delivered/failed" notifications, which would silently never fire while Finding 3 is open.
Do not build that notification type until Finding 3 closes — it would look broken and be
indistinguishable from having no notifications.

---

## c4. The 30-minute digest alternative

### What it takes

Genuinely small, because the infrastructure exists: **one route + one line in
`vercel.json`**. Reuse the `CRON_SECRET` bearer pattern from
`api/cron/crm-due-dates/route.ts:5-8`, and `sendOrgSms` for delivery.

### The watermark, which is the part that must be right

The brief is correct to insist on a stored watermark rather than a rolling 30-minute
window. **There is no precedent in this repo to copy** — `crm-due-dates` uses a rolling
`todayStr`, which is exactly the anti-pattern. Required semantics:

1. Read the stored watermark (an `org_settings` row keyed e.g. `digest_watermark` reuses
   the existing config pattern and needs **no new table**).
2. Select activity with `created_at > watermark`.
3. **If zero rows: send nothing and do not advance the watermark.** Silence is the
   correct output.
4. Send one summary SMS. **Check the result.**
5. **Advance the watermark only on a confirmed send**, and advance it to
   `max(created_at)` **of the rows actually read** — never to `now()`. Advancing to
   `now()` drops anything inserted during the run; advancing on an unchecked send drops
   everything the failed run covered.

That last point is the whole value of the design: a failed or skipped run **catches up**
on the next tick instead of losing the window. Given this codebase's ten recorded
swallowed-error instances, step 4 is the one most likely to be got wrong.

### What the digest cannot do that push can

- **No real-time.** Up to 30 minutes late, on a conversational medium.
- **No badge or dot.** It is just another SMS.
- **No quick-reply action** and no deep link into the thread.
- **It sends to a personal phone — the exact thing this is meant to stop.** Strategically
  it moves in the wrong direction.
- **It costs a Twilio segment per digest**, forever.
- **Its own delivery is unverifiable.** The digest goes out through the same outbound
  path whose status callback is broken (Finding 3), so a digest that silently fails to
  deliver would look identical to a quiet period. **A notification system you cannot
  confirm is a poor foundation.**

### What it can do that push cannot

- Works with **no install, no service worker, no browser permission**, and is immune to
  Android evicting a service worker.
- Reaches a phone that never opens the Hub.

---

## c5. Recommendation

**Build push first. The digest is not worth building now.**

The reasoning rests directly on the Part A finding: **the broken callback is
`message-status`, and inbound SMS is on a different, demonstrably healthy webhook.** Had
inbound SMS been broken too, the recommendation would invert — push would have had no
reliable trigger and the digest (which polls the database rather than depending on a
callback) would have been the only workable option. That is not the situation.

Push also does what was actually asked: alert on the phone, reply **inside the CRM from
the CRM number**. The digest explicitly does not — it routes activity back to the
personal phone.

**Is the digest worth building at all?** Only as a fallback, and only if push proves
unreliable in practice — Android is aggressive about evicting service workers on
battery-optimised devices, and that is a real risk worth measuring after v1 ships. If it
comes to that, build it as a **daily** summary rather than 30-minute: at daily cadence the
latency objection is already conceded, and the SMS cost and noise drop accordingly. The
watermark design above holds at any interval.

**Suggested order**
1. Confirm the badge-count expectation, since the numeric icon badge is not deliverable
   on Android. Decide whether notification + dot + existing in-app `unreadTotal` is enough.
2. Manifest + icons + minimal service worker + subscribe flow. Verify install and a test
   push on the actual Android device before writing any send path.
3. Wire the send to `/api/twilio/inbound-sms` only — the one healthy trigger.
4. Add `notificationclick` deep-linking to `/crm/conversations` for the thread.
5. Revisit delivery-status notifications **only after Finding 3 closes**.

**One prerequisite worth respecting:** scope the subscriptions table to
`user_id = auth.uid()` rather than an org-based policy, so this does not entangle with the
Phase 1/Phase 2 authorization migration currently in flight.
