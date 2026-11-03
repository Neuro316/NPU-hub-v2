-- hub_220_booking_sync.sql
--
-- STATUS: PROPOSED, NOT APPLIED. Apply to production (htfrfaxlcuyawtlztxxm) only,
-- through the Supabase connector as migration name hub_220_booking_sync, after an
-- explicit go. Not for npu-platform-nonprod: the Hub has no nonprod.
--
-- Hub band (200+). Checked 2026-11-02: the ledger stops at hub_219. This is 220.
--
-- PURPOSE: Build 1, University bookings into Hub pipelines
-- (docs/plans/hub-booking-routes-rulings.md). One row per synced booking: the
-- idempotency key (booking_id) and what the contact card shows under "Booking
-- answers". contacts stays byte-identical (ruling A2): nothing is added to it.
--
--   booking_id        nr_bookings.id. No FK: platform table, read-only to the Hub
--   contact_id        the contact the booking was matched to or created as. NULL when
--                     that contact was deleted, and the sync then leaves the booking
--                     alone instead of creating the person again
--   route_id          nr_booking_pipeline_routes.id used at first sync (no FK)
--   appointment_type  name at sync time, so the card reads without a platform join
--   starts_at/ends_at the booking's current time; a reschedule rewrites it
--   status            the booking's current status; a cancellation rewrites it
--   answers           [{key, label, answer}] in intake_questions order, the label being
--                     the question's wording when it was answered
--   placement         what happened to the stage at first sync: moved, entered, kept
--                     (never backward), other_pipeline (left where it is), none
--
-- ACCESS: RLS on with no policies; anon and authenticated have no privileges;
-- service_role only. The cron writes; GET /api/bookings/contact reads after checking
-- staff membership in the contact's org.
--
-- ROLLBACK:
--   begin;
--   drop table if exists public.hub_booking_syncs;
--   delete from supabase_migrations.schema_migrations where name = 'hub_220_booking_sync';
--   commit;

begin;

create table public.hub_booking_syncs (
  booking_id            uuid primary key,
  org_id                uuid not null,
  contact_id            uuid references public.contacts(id) on delete set null,
  route_id              uuid,
  appointment_type_id   uuid not null,
  appointment_type      text not null,
  starts_at             timestamptz not null,
  ends_at               timestamptz,
  status                text not null,
  answers               jsonb not null default '[]' check (jsonb_typeof(answers) = 'array'),
  placement             text not null default 'none'
                        check (placement in ('moved', 'entered', 'kept', 'other_pipeline', 'none')),
  first_synced_at       timestamptz not null default now(),
  last_synced_at        timestamptz not null default now()
);

create index hub_booking_syncs_contact on public.hub_booking_syncs (contact_id, starts_at desc);

alter table public.hub_booking_syncs enable row level security;
revoke all on public.hub_booking_syncs from public, anon, authenticated;
grant all on public.hub_booking_syncs to service_role;

commit;
