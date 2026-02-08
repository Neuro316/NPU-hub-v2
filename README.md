# NPU Hub — Operations Platform

Internal operations platform for Neuro Progeny and Sensorium Neuro Wellness.

Shares the same Supabase backend as the Mastermind Platform (participant-facing).

## Stack

- **Framework:** Next.js 14 (App Router) + TypeScript
- **Styling:** Tailwind CSS with NP brand tokens
- **Backend:** Supabase (PostgreSQL, Auth, Realtime, Edge Functions, Storage)
- **Hosting:** Vercel
- **Auth:** Google OAuth via Supabase Auth

## Setup

### 1. Clone and install

```bash
git clone https://github.com/Neuro316/npu-hub.git
cd npu-hub
npm install
```

### 2. Environment variables

Copy the example and fill in your keys:

```bash
cp .env.local.example .env.local
```

| Variable | Where to find it |
|----------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role (keep secret) |

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 4. Deploy to Vercel

1. Push to GitHub
2. Import project in Vercel
3. Add the three environment variables
4. Deploy

## Architecture

```
npu-hub/              ← This app (operations)
mastermind-platform/  ← Participant-facing app (separate Vercel project)
supabase/             ← Shared database (htfrfaxlcuyawtlztxxm)
```

Both apps connect to the same Supabase project. Shared tables (support_tickets, payments, participant_assessments, feature_events) are read/written by both.
