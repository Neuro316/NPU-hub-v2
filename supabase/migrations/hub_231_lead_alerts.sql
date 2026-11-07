-- hub_231_lead_alerts.sql
--
-- STATUS: PROPOSED. Not applied. Needs Cameron's go (schema change).
--
-- Hub band (200+). Checked 2026-11-07: Hub files stop at hub_230, and the ledger has no hub_231 row.
--
-- PURPOSE
--   1. public.hub_lead_alerts: the speed-to-lead queue. /api/cron/lead-alerts (every minute) finds new leads
--      (a lead device submission, a form intake, a discovery booking, a new University sign-up) and inserts one
--      row per lead, deduplicated on (org_id, source, source_id), then sends the due rows to the staff member
--      named in org_settings 'hub_lead_alerts' by Slack DM (a push to the phone) and by SMS to the phone on their
--      Hub profile. Quiet hours (8 PM to 8 AM Eastern) set due_at to the next 8 AM, except a booking that starts
--      within 24 hours. The row holds NO name, email, phone or answer: the message is composed at send time from
--      the source row, and nothing personal is stored or logged here.
--   2. entry_events.origin gains 'signup', so a new University sign-up can start the "Signed up, no purchase"
--      campaign through the existing raise_entry_event / route_and_enroll path. raise_entry_event already queues
--      nothing unless an ACTIVE route listens for the key, and the four campaign drafts' routes are inactive.
--   3. org_settings 'hub_lead_alerts' for Neuro Progeny: on, recipient Cameron (the user id the earlier data fixes
--      use as his), since = the apply time, so leads from before the apply never alert.
--
-- UNIVERSITY: nothing here touches a University table or function. The poller READS profiles, nr_bookings,
-- nr_booking_leads, nr_appointment_types and nr_booking_pipeline_routes; it writes only hub_lead_alerts,
-- entry_events (through raise_entry_event) and, through the existing notify path, Cameron's own SMS log.
--
-- ACCESS: RLS on with NO policies, and no grants to anon or authenticated. Service role only.
--
-- ROLLBACK:
--   begin;
--   delete from public.org_settings where setting_key = 'hub_lead_alerts';
--   delete from public.entry_events where origin = 'signup';
--   alter table public.entry_events drop constraint entry_events_origin_check;
--   alter table public.entry_events add constraint entry_events_origin_check
--     check (origin in ('stage','tag','contact_tag','call','import'));
--   drop table if exists public.hub_lead_alerts;
--   delete from supabase_migrations.schema_migrations where name = 'hub_231_lead_alerts';
--   commit;

begin;

create table public.hub_lead_alerts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  source       text not null check (source in ('lead_device', 'form', 'booking', 'university_signup', 'test')),
  source_id    text not null check (length(source_id) between 1 and 100),
  contact_id   uuid references public.contacts(id) on delete set null,
  occurred_at  timestamptz not null,
  -- a booking's start, for the quiet-hours exception; null for every other source
  starts_at    timestamptz,
  due_at       timestamptz not null,
  status       text not null default 'pending'
               check (status in ('pending', 'sending', 'sent', 'partial', 'failed', 'skipped')),
  push_status  text check (push_status in ('sent', 'failed', 'skipped')),
  sms_status   text check (sms_status in ('sent', 'failed', 'skipped')),
  attempts     int not null default 0,
  -- codes only (e.g. slack_not_in_channel, twilio_400_21610), never message text
  error_code   text check (error_code is null or length(error_code) <= 120),
  claimed_at   timestamptz,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (org_id, source, source_id)
);

create index hub_lead_alerts_due_idx on public.hub_lead_alerts (due_at) where status = 'pending';

alter table public.hub_lead_alerts enable row level security;
revoke all on public.hub_lead_alerts from anon, authenticated;

comment on table public.hub_lead_alerts is
  'Speed-to-lead queue (hub_231). One row per new lead, deduplicated on (org_id, source, source_id). '
  '/api/cron/lead-alerts sends due rows by Slack DM and SMS to the recipient in org_settings hub_lead_alerts. '
  'Holds no name, email, phone or answer. Service role only: RLS on, no policies.';

alter table public.entry_events drop constraint entry_events_origin_check;
alter table public.entry_events add constraint entry_events_origin_check
  check (origin in ('stage', 'tag', 'contact_tag', 'call', 'import', 'signup'));

insert into public.org_settings (org_id, setting_key, setting_value)
values ('00000000-0000-0000-0000-000000000001', 'hub_lead_alerts',
        jsonb_build_object('enabled', 'on', 'recipient_user_id', '22456608-5f7d-495e-af02-7037fea125cc',
                           'since', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
on conflict (org_id, setting_key) do nothing;

commit;

-- AFTER APPLY (read back):
--   select relrowsecurity from pg_class where oid = 'public.hub_lead_alerts'::regclass;              -- true
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'hub_lead_alerts' and grantee in ('anon', 'authenticated');                -- no rows
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'entry_events_origin_check'; -- includes signup
--   select setting_value from public.org_settings where setting_key = 'hub_lead_alerts';            -- on, Cameron, since
