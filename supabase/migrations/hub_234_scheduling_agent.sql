-- hub_234_scheduling_agent.sql
--
-- STATUS: PROPOSED 2026-11-09. NOT APPLIED. Needs a go. Production (htfrfaxlcuyawtlztxxm) only.
--
-- PURPOSE: scheduling agent, phase 3 (docs: the PR that adds this file).
--   hub_calendar_calendars  the calendars a Hub mail connection can see (owned or shared), with an exclude switch
--   hub_calendar_events     the next 14 days of events from the included calendars: start, end, title, calendar,
--                           attendee emails and whether it blocks time. NO descriptions, bodies, locations or links.
--                           Used for the morning brief's prep notes and, ruled 2026-11-09, as an extra busy source
--                           for proposing times (it can only remove a time, never add one). Past events are purged
--                           7 days after they end.
--   hub_mail_messages       + the draft state of each scheduling email the agent handled
--   hub_brief_runs          one row per brief sent, so a brief goes out at most once per day and kind
-- The calendar token is the mail connection's own refresh token (hub_216, Vault), granted the two read-only
-- calendar scopes on reconnect. The University's calendar tokens are never read.
--
-- ACCESS: RLS on with no policies, no grants to anon or authenticated: service role only, like hub_216/217/218.
--
-- ROLLBACK:
--   drop table if exists public.hub_brief_runs, public.hub_calendar_events, public.hub_calendar_calendars;
--   alter table public.hub_mail_messages drop column if exists draft_status, drop column if exists gmail_draft_id,
--     drop column if exists drafted_at, drop column if exists draft_note;

create table public.hub_calendar_calendars (
  id                  uuid primary key default gen_random_uuid(),
  connection_id       uuid not null references public.hub_mail_connections(id) on delete cascade,
  google_calendar_id  text not null check (length(google_calendar_id) between 1 and 300),
  summary             text check (summary is null or length(summary) <= 200),
  access_role         text check (access_role is null or access_role in ('owner', 'writer', 'reader', 'freeBusyReader')),
  is_primary          boolean not null default false,
  excluded            boolean not null default false,
  last_synced_at      timestamptz,
  sync_error          text check (sync_error is null or length(sync_error) <= 200),
  created_at          timestamptz not null default now(),
  unique (connection_id, google_calendar_id)
);

create table public.hub_calendar_events (
  id               uuid primary key default gen_random_uuid(),
  calendar_id      uuid not null references public.hub_calendar_calendars(id) on delete cascade,
  google_event_id  text not null check (length(google_event_id) between 1 and 1024),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  all_day          boolean not null default false,
  title            text check (title is null or length(title) <= 300),
  attendee_emails  text[] not null default '{}' check (cardinality(attendee_emails) <= 100),
  busy             boolean not null default true,
  updated_at       timestamptz not null default now(),
  unique (calendar_id, google_event_id),
  check (ends_at >= starts_at)
);
create index hub_calendar_events_time on public.hub_calendar_events (starts_at, ends_at);

alter table public.hub_mail_messages
  add column draft_status   text check (draft_status is null or draft_status in
                              ('drafted', 'link_drafted', 'flagged', 'exception', 'no_slot', 'error')),
  add column gmail_draft_id text check (gmail_draft_id is null or gmail_draft_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  add column drafted_at     timestamptz,
  add column draft_note     text check (draft_note is null or length(draft_note) <= 200);
create index hub_mail_messages_scheduling on public.hub_mail_messages (received_at desc)
  where category = 'scheduling';

create table public.hub_brief_runs (
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  kind           text not null check (kind in ('morning', 'evening')),
  for_date       date not null,
  slack_status   text check (slack_status is null or length(slack_status) <= 40),
  sms_status     text check (sms_status is null or length(sms_status) <= 40),
  sent_at        timestamptz not null default now(),
  primary key (owner_user_id, kind, for_date)
);

alter table public.hub_calendar_calendars enable row level security;
alter table public.hub_calendar_events enable row level security;
alter table public.hub_brief_runs enable row level security;
revoke all on public.hub_calendar_calendars, public.hub_calendar_events, public.hub_brief_runs from public, anon, authenticated;
grant all on public.hub_calendar_calendars, public.hub_calendar_events, public.hub_brief_runs to service_role;
