# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This App Is

NPU Hub — internal operations platform for Neuro Progeny and Sensorium Neuro Wellness.
Shares the same Supabase backend as the Mastermind Platform (participant-facing).
Built with Next.js 14 (App Router) / Supabase / Tailwind / Vercel.

## Commands

```bash
npm run dev          # Start dev server at localhost:3000
npm run build        # Production build (runs type-check implicitly)
npm run lint         # ESLint
npm run type-check   # tsc --noEmit
```

No test framework is configured. Validation is done via `npm run build`, `npm run lint`, and `npm run type-check`.

## Deploy Pattern

```bash
git add .
git commit -m "message"
git pull --no-rebase
git push
```

Vercel auto-deploys on push to main.

---

## CRITICAL ARCHITECTURAL RULES

### Supabase Client Rule

There are three Supabase client entry points — using the wrong one causes silent auth failures:

| Context | File | Function | Key used |
|---------|------|----------|----------|
| API routes | `src/lib/supabase.ts` | `createAdminSupabase()` | service role |
| Client components | `src/lib/supabase-browser.ts` | `createBrowserClient()` | anon |
| Server components | `src/lib/supabase-server.ts` | `createServerComponentClient()` | anon + cookies |
| Middleware | `src/lib/supabase-middleware.ts` | `updateSession()` | anon + cookies |

`supabase.ts` also exports `createServerSupabase()` (anon key) — used only by middleware internals.

### Pipeline Column

Client pipeline stored in dedicated `pipeline` column on contacts/profiles.
Valid values: `'mastermind' | 'enrolled' | 'subscribed'`
Do NOT revert to tag-based pipeline logic.

### SQL Rule

Output SQL only — never execute. All schema changes run in Supabase SQL Editor manually.

### Migration Numbering: Hub starts at 200

**Hub migrations are numbered from 200 upward. The platform stays in its current sequence. Never cross.**

This is a number rather than a principle because the ledger gives no warning.
`supabase_migrations.schema_migrations` keys on a **timestamp `version`, not the filename prefix**, so
two files can both be named `084_*` and both apply cleanly with no error. That is exactly what happened
on 2026-07-24: Hub's `084_v_platform_signups` (version 20260724152537) and the platform's
`084_complete_signup_rpc` (version 20260724225937) are both applied and both objects are live.

`npu-hub-v2`, `npu-platform-v2`, and `neuroreport-app` share the database `htfrfaxlcuyawtlztxxm` and
therefore share **one migration ledger**. Before writing a migration, take the max of BOTH repos'
numbers, and use the 200+ band so ownership is readable from the filename alone.

Related known drift: the Hub tree has no `083`, and `072_merge_duplicate_cameron_contact.sql` exists as
a file with no ledger row, meaning it was applied outside `apply_migration`.

### Local `npm run build` halts on `/api/integrations/*` — not a gate failure

`npm run build` on a machine without a real `.env.local` compiles successfully, then fails during
"Collecting page data" with:

```
Error: supabaseUrl is required.
Failed to collect page data for /api/integrations/neuroreport/sync
```

**Cause:** that route instantiates a Supabase client at **module scope**
(`src/app/api/integrations/neuroreport/sync/route.ts:16`) reading `process.env.NEXT_PUBLIC_SUPABASE_URL`.
A tree containing only `.env.local.example` fails there regardless of the diff under test.
**Vercel builds fine**, because the env vars are set there.

So: `npx tsc --noEmit` is the reliable local signal and must be clean. Treat a build failure at
`/api/integrations/*` with `supabaseUrl is required` as environmental — but **confirm the failing route
is one you did not touch before dismissing it**, and never dismiss a failure elsewhere in the build on
these grounds. For a genuinely green local build, supply a real `.env.local`.

### Next artifact clash

Run `rm -rf .next` when switching between `npm run build` and `next dev`, and after deleting any route.
Stale generated stubs in `.next/types/app/**` reference deleted routes and produce
`TS2307: Cannot find module` errors that are not real.

---

## Architecture Overview

### Routing

All source code is under `src/`. Next.js App Router with two layout groups:

- **`src/app/(dashboard)/`** — authenticated routes behind middleware. Contains ~40 pages across modules: CRM, EHR, finance, media, meetings, tasks, rocks (OKRs), campaigns, teams, analytics, etc.
- **`src/app/(public)/`** — unauthenticated routes: `/login`, `/signup`, `/pending`, `/invite/[token]`, `/policies`.
- **`src/app/api/`** — 70+ API routes organized by domain: `/api/contacts/`, `/api/crm/`, `/api/email/`, `/api/sms/`, `/api/twilio/`, `/api/voice/`, `/api/ai/`, `/api/finance/`, `/api/webhooks/`, etc.

### Auth & Middleware

- `src/middleware.ts` refreshes Supabase sessions on all non-static routes.
- Unauthenticated users → `/login`. Users with `status='pending'` → `/pending`.
- Public routes excluded from auth: `/login`, `/signup`, `/pending`, `/api/auth`, `/api/twilio`, `/api/webhooks`, `/policies`.
- Roles: `participant`, `facilitator`, `admin`, `superadmin`.

### State Management

Global state uses **React Context** (not Zustand, despite it being a dependency):

- **`WorkspaceContext`** (`src/lib/workspace-context.tsx`) — current user, org list, workspace switching, enabled modules. Persists selected org to `localStorage` key `npu_hub_current_org`.
- **`SidebarContext`** (`src/lib/sidebar-context.tsx`) — sidebar collapse/mobile state.
- **`PermissionsProvider`** (`src/lib/hooks/use-permissions.tsx`) — RBAC checks.

### Data Layer

- CRM read operations: `src/lib/crm-client.ts`
- CRM write operations: `src/lib/crm-server.ts`
- CRM AI features: `src/lib/crm-ai.ts`
- Identity resolution: `src/lib/identity-client.ts`
- Onboarding pipeline: `src/lib/onboarding-pipeline.ts`
- Data hooks are in `src/lib/hooks/` (e.g., `use-task-data.ts`, `use-meeting-data.ts`, `use-rock-data.ts`)

### Types

- CRM types (the largest): `src/types/crm.ts` — `CrmContact` interface with 100+ fields.
- Domain-specific types: `src/lib/types/` — `tasks.ts`, `meetings.ts`, `podcast.ts`, `rocks.ts`, `journey.ts`.

### Key Integrations

- **Twilio** — SMS, voice calls, recordings (`src/lib/twilio.ts`, `src/lib/twilio-org.ts`)
- **Google** — OAuth, Calendar sync, Drive sync (`src/lib/google-drive.ts`, `/api/gcal/`, `/api/drive/`)
- **Stripe** — payments, subscriptions (`src/lib/stripe-auto-tagger.ts`, `/api/finance/`)
- **Anthropic Claude** — AI features across tasks, meetings, CRM, platform advisor (`/api/ai/`)
- **Slack** — notifications (`src/lib/slack-notifications.ts`)
- **Deepgram** — transcription (`src/lib/deepgram.ts`)

### Multi-Org

The platform supports multiple organizations. `WorkspaceContext` manages org switching. Most tables include an `org_id` column. Both NPU Hub and the Mastermind Platform share the same Supabase project.

---

## What Needs Approval Before Running

- Any schema change (SQL output only)
- Any change to auth, middleware, or session logic
- Any change to Stripe webhook or payment flow
- Any new npm package install

## What Claude Can Do Without Asking

- Read any file
- Edit UI components and pages
- Run: `git status`, `git diff`, `npm run build`, `npm run lint`, `npx tsc --noEmit`
