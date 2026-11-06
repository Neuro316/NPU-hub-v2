-- hub_228_lead_devices.sql
--
-- STATUS: PROPOSED. Not applied. Waiting for Cameron's go.
--
-- Hub band (200+). Checked 2026-11-06: the ledger stops at hub_227. This is 228.
--
-- PURPOSE: the Lead Device Kit (M3). All of it lives in the Hub: nothing here reads or writes a
-- University-owned table (ruling 0, 2026-11-06).
--   storage bucket lead-devices   private; one self-contained HTML file per version, 2 MB
--   lead_devices                  the registry: slug, brand, type, hosting, status, manifest
--   lead_device_versions          each upload; the live link serves live_version_id, so a rollback
--                                 moves a pointer and re-uploading never changes what is live
--   lead_device_submissions       one row per completed submission, idempotent per device. Answers and
--                                 the exact consent text shown are stored here. Name, email and phone
--                                 stay on the contact.
--   lead_device_events            views, starts and other NPU.track events, and the capture
--                                 endpoint's attempts, which the rate limit counts
--   hub_contact_facts             gains lead_devices and quiz_archetypes, so those two Smart List
--                                 fields have a data source. Test submissions do not count.
--   hub_lead_device_contact       matches or creates the contact. Only a new contact takes the device
--                                 slug as its source; an existing contact keeps its source.
--
-- SLUGS ARE UNIQUE ACROSS THE HUB, stricter than the brief's "unique per org". Every device shares one
-- public origin, so the link is https://start.neuroprogeny.com/<slug>, and the external intake can name a
-- device by slug alone.
--
-- SEARCH PATH: hub_lead_device_contact does not use the empty search path of hub_intake_contact. A contact
-- insert fires trg_contact_identity, whose function and resolve_identity name their objects without a schema
-- and use similarity(), so they run under the caller's path.
--
-- REPOINTING: lead_device_submissions.contact_id follows a contact merge, because
-- merge_contact_repoint updates every public column named like %contact_id%.
--
-- ACCESS:
--   - All four tables have RLS on with no policies. anon and authenticated have no privileges, so they
--     are service_role only. Every read and write goes through a Hub route.
--   - The bucket is private and has no storage.objects policies, so only the service role reaches it.
--
-- WHAT IT DOES NOT DO: it creates no device, contact, consent, campaign or route. It sends nothing:
-- gate_live_sends stays off and no campaign's live_enabled changes.
--
-- ROLLBACK (the bucket must be emptied first, through the Storage API or dashboard):
--   begin;
--   drop function public.hub_contact_facts(uuid);
--   -- recreate hub_contact_facts from its definition in hub_225_marketing_foundations_smart_lists.sql,
--   -- then revoke and grant execute as below
--   drop function public.hub_lead_device_contact(uuid, text, text, text, text, text, jsonb);
--   drop table public.lead_device_events;
--   drop table public.lead_device_submissions;
--   alter table public.lead_devices drop constraint lead_devices_live_version_fk;
--   drop table public.lead_device_versions;
--   drop table public.lead_devices;
--   delete from storage.buckets where id = 'lead-devices';
--   delete from supabase_migrations.schema_migrations where name = 'hub_228_lead_devices';
--   commit;

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lead-devices', 'lead-devices', false, 2097152, array['text/html']);

create table public.lead_devices (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  slug               text not null unique
                     check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80
                            and slug not in ('api', 'favicon', 'health', 'lead-device', 'robots', 'sitemap')),
  name               text not null check (length(btrim(name)) between 1 and 200),
  brand              text not null check (brand in ('neuro_progeny', 'wnw')),
  type               text not null check (type in ('quiz', 'lead_magnet', 'webinar', 'tool', 'form', 'booking')),
  hosting            text not null check (hosting in ('hub', 'external')),
  -- html: an uploaded file in the framed player. form: the Hub lead form alone, with no file.
  content            text not null default 'html' check (content in ('html', 'form')),
  status             text not null default 'draft' check (status in ('draft', 'live', 'paused')),
  -- description, outcomes [{key,label}], questions [{key,label}], fields, email_consent_text,
  -- sms_consent_text, result_consent_text, asset_url, hot_lead_rule, script_allowlist, embed_origins
  manifest           jsonb not null default '{}' check (jsonb_typeof(manifest) = 'object'),
  pipeline_id        uuid references public.pipelines(id) on delete set null,
  live_version_id    uuid,
  -- What was created around the device: smart list and campaign ids, by outcome
  assets             jsonb not null default '{}' check (jsonb_typeof(assets) = 'object'),
  provisioned_at     timestamptz,
  provision_error    text,
  test_drive_passed_at timestamptz,
  test_drive_passed_by uuid,
  went_live_at       timestamptz,
  went_live_by       uuid,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint lead_devices_live_needs_who check (status <> 'live' or (went_live_at is not null and went_live_by is not null)),
  constraint lead_devices_external_has_no_file check (hosting = 'hub' or (content = 'form' and live_version_id is null))
);

create index lead_devices_org on public.lead_devices (org_id, created_at desc);

create trigger trg_updated_at before update on public.lead_devices
  for each row execute function public.update_updated_at();

create table public.lead_device_versions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  device_id       uuid not null references public.lead_devices(id) on delete cascade,
  version         integer not null check (version > 0),
  storage_path    text not null unique,
  file_name       text not null check (length(file_name) between 1 and 255),
  size_bytes      bigint not null check (size_bytes > 0 and size_bytes <= 2097152),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- what the uploader's inspection found in the file
  inspection      jsonb not null default '{}' check (jsonb_typeof(inspection) = 'object'),
  approved_at     timestamptz,
  approved_by     uuid,
  uploaded_by     uuid,
  created_at      timestamptz not null default now(),
  unique (device_id, version),
  unique (id, device_id)
);

-- A device can only go live on one of its own versions. Deferred so deleting a device can cascade.
alter table public.lead_devices
  add constraint lead_devices_live_version_fk foreign key (live_version_id, id)
  references public.lead_device_versions (id, device_id) deferrable initially deferred;

create table public.lead_device_submissions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  device_id       uuid not null references public.lead_devices(id) on delete cascade,
  version_id      uuid references public.lead_device_versions(id) on delete set null,
  contact_id      uuid references public.contacts(id) on delete set null,
  channel         text not null check (channel in ('hosted', 'form', 'external')),
  idempotency_key text not null check (length(idempotency_key) between 1 and 120),
  outcome         text check (outcome is null or length(outcome) <= 80),
  -- stored with the row, so renaming an outcome or a question later does not rewrite what was shown
  outcome_label   text check (outcome_label is null or length(outcome_label) <= 200),
  answers         jsonb not null default '{}' check (jsonb_typeof(answers) = 'object'),
  question_labels jsonb not null default '{}' check (jsonb_typeof(question_labels) = 'object'),
  -- [{channel, kind, granted, text}]: what was offered and given, with the exact text
  consents        jsonb not null default '[]' check (jsonb_typeof(consents) = 'array'),
  utm             jsonb check (utm is null or jsonb_typeof(utm) = 'object'),
  page_url        text check (page_url is null or length(page_url) <= 2000),
  ip_hash         text,
  -- true while the device is not live. A test submission never counts in a list or in conversion.
  is_test         boolean not null,
  status          text not null default 'received' check (status in ('received', 'accepted', 'contact_failed')),
  submitted_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (device_id, idempotency_key)
);

create index lead_device_submissions_device on public.lead_device_submissions (device_id, created_at desc);
create index lead_device_submissions_contact on public.lead_device_submissions (contact_id, created_at desc) where contact_id is not null;

create table public.lead_device_events (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  device_id   uuid not null references public.lead_devices(id) on delete cascade,
  version_id  uuid references public.lead_device_versions(id) on delete set null,
  -- view, start and author-named events from NPU.track; 'attempt' is written only by the server
  event       text not null check (event ~ '^[a-z0-9_]{1,40}$'),
  ip_hash     text,
  utm_source  text check (utm_source is null or length(utm_source) <= 200),
  is_test     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index lead_device_events_device on public.lead_device_events (device_id, event, created_at desc);
create index lead_device_events_rate on public.lead_device_events (ip_hash, created_at desc) where ip_hash is not null;

alter table public.lead_devices enable row level security;
alter table public.lead_device_versions enable row level security;
alter table public.lead_device_submissions enable row level security;
alter table public.lead_device_events enable row level security;
revoke all on public.lead_devices, public.lead_device_versions, public.lead_device_submissions, public.lead_device_events
  from public, anon, authenticated;
grant all on public.lead_devices, public.lead_device_versions, public.lead_device_submissions, public.lead_device_events
  to service_role;

-- The same match as hub_intake_contact: by email, or by phone when there is no email. An existing contact
-- is returned untouched, so it keeps its source.
create function public.hub_lead_device_contact(p_org uuid, p_email text, p_phone text, p_first text, p_last text, p_slug text, p_utm jsonb default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v uuid; e text := nullif(lower(btrim(p_email)), ''); ph text := nullif(btrim(p_phone), '');
begin
  if e is null and ph is null then raise exception 'hub: a lead device submission needs an email or a phone'; end if;
  select c.id into v from public.contacts c
   where c.org_id = p_org and c.merged_into_id is null and c.archived_at is null
     and ((e is not null and lower(btrim(c.email)) = e) or (e is null and ph is not null and btrim(c.phone) = ph))
   order by c.created_at limit 1;
  if v is not null then return v; end if;
  insert into public.contacts (org_id, first_name, last_name, email, phone, source, acquisition_source, acquisition_utm)
  values (p_org, coalesce(nullif(btrim(p_first), ''), 'Unknown'), coalesce(btrim(p_last), ''), e, ph,
          p_slug, 'lead_device:' || p_slug, p_utm)
  returning id into v;
  return v;
end $function$;

revoke all on function public.hub_lead_device_contact(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.hub_lead_device_contact(uuid, text, text, text, text, text, jsonb) to service_role;

-- The return type changes, so the function is dropped and recreated rather than replaced. The body is
-- the live definition read on 2026-11-06, with the two new columns and their two joins added.
drop function public.hub_contact_facts(uuid);

create function public.hub_contact_facts(p_org uuid)
 returns table(contact_id uuid, first_name text, last_name text, email text, phone text, tags text[], source text,
               contact_type text, partnership_type text, pipeline_id text, pipeline_name text, pipeline_stage text,
               brand text, created_at timestamp with time zone, last_activity_at timestamp with time zone,
               last_open_at timestamp with time zone, last_click_at timestamp with time zone,
               booked_at timestamp with time zone, booking_types text[], client_reasons text[],
               email_allowed boolean, texting_allowed boolean, purchases jsonb,
               lead_devices text[], quiz_archetypes text[])
 language sql
 stable security definer
 set search_path to ''
as $function$
  select c.id, c.first_name, c.last_name, c.email, c.phone,
         coalesce(c.tags, '{}') || coalesce(c.auto_tags, '{}'), c.source, c.contact_type, c.partnership_type,
         c.pipeline_id, pl.name, c.pipeline_stage,
         case when pl.name ~* 'waynesville' then 'wnw' else 'np' end,
         c.created_at,
         greatest(c.last_contacted_at, c.last_call_at, c.last_text_at, c.last_email_at, m.last_open, m.last_click, b.booked),
         m.last_open, m.last_click, b.booked, coalesce(b.types, '{}'),
         public.hub_current_client_reasons(c.id), public.hub_email_marketing_allowed(c.id),
         (public.hub_texting_allowed(c.id) ->> 'allowed')::boolean, coalesce(p.items, '[]'::jsonb),
         coalesce(ld.slugs, '{}'), coalesce(qa.archetypes, '{}')
    from public.contacts c
    left join public.pipelines pl on pl.org_id = c.org_id and pl.legacy_key = c.pipeline_id
    left join lateral (
      select max(ms.opened_at) as last_open, max(ms.clicked_at) as last_click from public.message_sends ms
       where ms.contact_id in (select public.hub_contact_family(c.id))) m on true
    left join lateral (
      select max(s.starts_at) as booked, array_agg(distinct s.appointment_type) filter (where s.appointment_type is not null) as types
        from public.hub_booking_syncs s where s.contact_id in (select public.hub_contact_family(c.id))) b on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('key', i.key, 'name', i.name, 'at', i.at)) as items from (
        select t.keyword as key, t.keyword as name, t.granted_at as at
          from public.entitlements t join public.profiles pr on pr.id = t.user_id
         where pr.id = c.mastermind_user_id or lower(btrim(pr.email)) = lower(btrim(c.email))
        union all
        select 'program:' || e.program_id, g.name, e.enrolled_at
          from public.enrollments e join public.profiles pr on pr.id = e.user_id
          join public.programs g on g.id = e.program_id
         where e.status not in ('cancelled','refunded')
           and (pr.id = c.mastermind_user_id or lower(btrim(pr.email)) = lower(btrim(c.email)))) i) p on true
    left join lateral (
      select array_agg(distinct d.slug) as slugs
        from public.lead_device_submissions s join public.lead_devices d on d.id = s.device_id
       where s.contact_id = c.id and s.status = 'accepted' and not s.is_test) ld on true
    left join lateral (
      select array_agg(distinct v.value) as archetypes
        from public.lead_device_submissions s join public.lead_devices d on d.id = s.device_id
        cross join lateral unnest(array[s.outcome, s.outcome_label]) as v(value)
       where s.contact_id = c.id and s.status = 'accepted' and not s.is_test
         and d.type = 'quiz' and v.value is not null) qa on true
   where c.org_id = p_org and c.merged_into_id is null and c.archived_at is null
     and not coalesce(c.tags, '{}') @> array['quarantine:test-record']
$function$;

revoke all on function public.hub_contact_facts(uuid) from public, anon, authenticated;
grant execute on function public.hub_contact_facts(uuid) to service_role;

commit;
