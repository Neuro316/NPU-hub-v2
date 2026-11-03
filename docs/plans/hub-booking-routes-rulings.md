# Build 1: University bookings into Hub pipelines — rulings and build plan

Branch `feat/booking-routes` off `main` at `9e5bd8a`. Two migrations are **proposed, not
applied**, and wait for a separate go:

- `hub_220_booking_sync` (schema): the new Hub table `hub_booking_syncs`.
- `hub_221_booking_routes_seed` (data only): the "Discovery Call Booked" stage and the two
  routes. **Blocked on the choice of sales pipeline (§1).**

## 1. The sales pipeline is ambiguous

The Neuro Progeny org's board (`org_settings.crm_pipelines`) has no pipeline called
"Neuro Progeny sales". These are the candidates:

| Board id | Name | Contacts | Discovery-like stage today | Why it's a candidate |
|---|---|---|---|---|
| `default` | Sales Pipeline | 10 | "Discovery call Scheduled" (2nd) | The org's default pipeline, and the only one named "Sales" |
| `pipeline-1790143608575` | Waynesville Neuro Wellness | 8 | "Scheduled discovery call" (4th) | **WNW** = Waynesville Neuro Wellness, the same prefix as the appointment type "WNW Discovery Call" |
| `pipeline-1779900078615` | June 2026 NP Outreach | 11 | "Discovery Call Scheduled" (4th) | Has a full discovery-call sales flow |

The seed file has the pipeline id as one constant, `c_sales`, which is set at the go. It
refuses to run until that's done.

All three already have a stage that means "discovery call booked". The brief says to create
"Discovery Call Booked" after the first stage if it is missing; on any of them that would
create a **second** stage with the same meaning. The go can instead name the existing stage,
and then nothing is created.

## 2. What I read

- **Appointment types** (Neuro Progeny org):
  - "WNW Discovery Call" `eeeb4aac-…` has 0 bookings.
  - "Interesting meeting" `75b0f7c3-…` has 4 bookings, 1 of them confirmed, with questions
    `h`/`w` (text) and `a` (choice).
  - Another org has its own "Interesting meeting"; the seed doesn't touch it.
- **`nr_booking_pipeline_routes`** (pf_249):
  - Empty today, and unique per appointment type.
  - `pipeline_id` is text with no FK.
  - Service role only, with a clinic_fence policy.
- **Two id spaces for pipelines.** The board writes `org_settings.crm_pipelines[].id` into
  `contacts.pipeline_id`, e.g. `default`. `public.pipelines` is a uuid mirror kept by the
  trigger `hub_org_settings_pipeline_sync`. Routes store the **board id**, because it's what
  a contact holds.
- **Guests:**
  - A booking has `lead_id` → `nr_booking_leads` (name, email, phone), or `participant_id` →
    `profiles` (full_name, email, phone).
  - The platform has no "rescheduled" event. A reschedule shows up only as a new `starts_at`.

## 3. Rulings (mine, to confirm at the go)

1. **The table.** `contacts` stays byte-identical (ruling A2). The booking fields and the
   answers live in the new Hub table `hub_booking_syncs`, one row per booking. Its primary
   key, `booking_id`, is the idempotency key.
2. **Matching uses the duplicate sweep's rules.**
   - Email first: case-insensitive, must pass `isUsableEmail` (now shared in
     `src/lib/contacts/match.ts`), merged contacts excluded.
   - Then phone: last 10 digits via `match_contact_by_phone`.
   - Otherwise, create the contact with name, email, phone and source `university_booking`,
     only if the route's "create contact if missing" is on.
3. **Placement.**

   | The contact is… | Result |
   |---|---|
   | In no pipeline, or in a deleted pipeline | Placed at the route's stage (entered) |
   | In the same pipeline at an earlier stage | Moved forward |
   | At the same or a later stage, when "never move backward" is on | Kept |
   | On **another live pipeline** | **Left where it is** (`other_pipeline`), because a contact sits on one board and moving it would take it off the other. The timeline entry says so |

   - Board moves write the `pipeline_changed` timeline entry through `trg_pipeline_timeline`,
     and set `hub_pipeline_deals` (entered and stage-changed times) the way the board does.
   - **Stage emails are not fired** by a booking-driven move. That would be an automated
     send nobody pressed.
4. **First sight of an already-cancelled booking brings nobody in.** It is skipped.
5. **Later runs.** A new `starts_at` or a cancellation rewrites the stored booking and adds a
   timeline entry (`booking_rescheduled` / `booking_cancelled`). The stage never moves again.
   - If the contact was merged, the row follows `merged_into_id`.
   - If it was deleted, `contact_id` becomes NULL and the sync leaves that booking alone
     instead of creating the person again.
6. **Answers.** Every question appears in the type's order, with its wording at the time it
   was answered. Keys that are no longer questions are listed after.
7. **Scope of each run.** Bookings changed in the last 30 days, at most 500 per run, inside a
   45-second window. Runs can't overlap: the cron is every 5 minutes with a 60-second limit.
   A duplicate insert is ignored.
8. **Nothing personal in logs.** Logs and `job_runs` carry counts and codes only: no names,
   addresses or answers.

## 4. Access

| Surface | Who |
|---|---|
| `/api/cron/booking-sync` | `CRON_SECRET`, fails closed |
| `/api/booking-routes` (GET/PUT/DELETE) | Platform superadmin **and** a member of the org. The type must be in that org, and the pipeline and stage must exist in its board config. Writes only route rows, never `tag_on_submit` / `custom_field_map` |
| `/api/bookings/contact` | Staff of the contact's org (the org comes from the contact row) |
| `hub_booking_syncs` | RLS on, no policies, service role only |

## 5. Tests

`node scripts/bookings/placement-check.mjs` passes 13/13. It covers placement in every case
above, the never-backward switch, and the answer list.

## 6. Files

| File | Purpose |
|---|---|
| `supabase/migrations/hub_220_booking_sync.sql` | `hub_booking_syncs` |
| `supabase/migrations/hub_221_booking_routes_seed.sql` | Stage and two routes (data) |
| `src/lib/bookings/placement.ts` | Pure rules: placement and answers |
| `src/lib/bookings/sync.ts` | The sync |
| `src/lib/contacts/match.ts` | `isUsableEmail`, shared with `/api/contacts/duplicates` |
| `src/app/api/cron/booking-sync/route.ts` + `vercel.json` | Every 5 minutes |
| `src/app/api/booking-routes/route.ts` | Settings API |
| `src/app/api/bookings/contact/route.ts` | Contact card API |
| `src/components/settings/booking-routes-section.tsx` | Settings › Booking Routes |
| `src/components/crm/booking-answers.tsx` | Contact card › Booking answers |

## 7. Order at the go

1. Apply `hub_220`.
2. Apply `hub_221` with the chosen pipeline, and read back the routes and the stage.
3. Run verify, merge, and confirm the first cron run in `job_runs`.
4. Book a test discovery call and confirm where it appears.
