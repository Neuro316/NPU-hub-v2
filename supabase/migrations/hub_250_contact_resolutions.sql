-- hub_250_contact_resolutions.sql
--
-- STATUS: PROPOSED 2026-11-23. NOT APPLIED. Needs "go hub_250". Applied by the Hub chat: nonprod (cpasntagxhxitavivwlb)
-- first, then production (htfrfaxlcuyawtlztxxm), then NOTIFY pgrst and a read-back.
-- Hub band. hub_249 (mailbox also_visible_to) is the last; this is 250.
--
-- PURPOSE: "No reply needed" (Resolve), one action shared by every place the Hub says a person is waiting on us
--   (src/lib/resolve/rules.ts). One row per resolve, keyed on the CONTACT, never the login: a resolve by Cameron is a
--   resolve for Shane. It holds until the contact sends something new (reopened_at, 'new_inbound') or a teammate
--   reopens it ('manual'). Rows are never deleted by code; nothing on the contact changes.
--
-- ACCESS: RLS on. Staff of the row's org (team_profiles active, role super_admin, admin or team_member) may SELECT,
--   the same policy as hub_touchpoint_situations. No insert, update or delete policy: only the service role (the
--   /api/resolve route and the monitors) writes.
--
-- READ-BACK:
--   select count(*) from public.hub_contact_resolutions;                                          -- 0
--   select relrowsecurity from pg_class where oid = 'public.hub_contact_resolutions'::regclass;   -- true
--   select policyname, cmd from pg_policies where tablename = 'hub_contact_resolutions';          -- one SELECT policy
--   select indexname from pg_indexes where tablename = 'hub_contact_resolutions';                 -- pkey, one_live, contact
--
-- ROLLBACK:
--   begin;
--   drop table if exists public.hub_contact_resolutions;
--   delete from supabase_migrations.schema_migrations where name = 'hub_250_contact_resolutions';
--   commit;
--   (contact_timeline entries contact_resolved and contact_resolution_reopened stay; the code treats a missing table as
--   "nothing resolved", so the monitors raise as before.)

begin;

create table public.hub_contact_resolutions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  contact_id       uuid not null references public.contacts(id) on delete cascade,
  scope            text not null check (scope in ('text_waiting', 'touchpoint', 'speed_to_lead', 'all')),
  reason           text not null check (reason in ('conversation_ended', 'not_a_lead', 'former_client', 'handled_elsewhere', 'spam')),
  note             text check (note is null or length(note) <= 200),
  resolved_by      uuid not null,
  resolved_at      timestamptz not null default now(),
  reopened_at      timestamptz,
  reopened_reason  text check (reopened_reason is null or reopened_reason in ('new_inbound', 'manual')),
  constraint hub_contact_resolutions_reopen check ((reopened_at is null) = (reopened_reason is null))
);

create unique index hub_contact_resolutions_one_live on public.hub_contact_resolutions (contact_id, scope) where reopened_at is null;
create index hub_contact_resolutions_contact on public.hub_contact_resolutions (contact_id, resolved_at desc);

alter table public.hub_contact_resolutions enable row level security;
revoke all on public.hub_contact_resolutions from public, anon, authenticated;
grant select on public.hub_contact_resolutions to authenticated;
grant all on public.hub_contact_resolutions to service_role;

create policy hub_contact_resolutions_staff_select on public.hub_contact_resolutions
  for select to authenticated
  using (exists (
    select 1 from public.team_profiles tp
     where tp.org_id = hub_contact_resolutions.org_id
       and tp.user_id = auth.uid()
       and tp.status = 'active'
       and tp.role in ('super_admin', 'admin', 'team_member')
  ));

comment on table public.hub_contact_resolutions is
  'No reply needed (Resolve): one row per resolve, keyed on the contact (shared by every staff login). Holds until a new inbound or a manual reopen. Staff of the org read; service role writes.';
comment on column public.hub_contact_resolutions.id is 'Row id.';
comment on column public.hub_contact_resolutions.org_id is 'The contact''s org (the staff select policy keys on it).';
comment on column public.hub_contact_resolutions.contact_id is 'The contact marked No reply needed. Every monitor checks this, never the login.';
comment on column public.hub_contact_resolutions.scope is 'What it quiets: text_waiting (the text alert), touchpoint (follow-up cards), speed_to_lead (tiles, brief, lead_no_touch_24h), or all.';
comment on column public.hub_contact_resolutions.reason is 'The chip chosen: conversation_ended, not_a_lead, former_client, handled_elsewhere or spam.';
comment on column public.hub_contact_resolutions.note is 'Optional one-line note from the teammate, at most 200 characters. Never message text.';
comment on column public.hub_contact_resolutions.resolved_by is 'The staff user (profiles id) who resolved it, from the session.';
comment on column public.hub_contact_resolutions.resolved_at is 'When it was resolved. Anything the contact sends after this reopens it.';
comment on column public.hub_contact_resolutions.reopened_at is 'When it stopped holding; null while live (one live row per contact and scope).';
comment on column public.hub_contact_resolutions.reopened_reason is 'Why it reopened: new_inbound (a text, call or email from the contact after resolved_at) or manual (Reopen).';

commit;
