-- hub_240_resource_links.sql
--
-- STATUS: PROPOSED 2026-11-18, NOT APPLIED. Needs a go. Applied by the Hub chat: nonprod (cpasntagxhxitavivwlb)
-- first, then production (htfrfaxlcuyawtlztxxm), then NOTIFY pgrst and a read-back.
--
-- Hub band (200+). Production's ledger stops at hub_239_brief_runs (checked 2026-11-18); hub_234 is held by the
-- open scheduling-agent branch (PR #46). This is 240.
--
-- PURPOSE: Running List q33, the resource and link database, built on the Resource Library (hub_222).
--   hub_resources       gains link rows beside the file rows: a kind, a URL, an owner and "where used".
--                       A row is EITHER a file (storage_path, file_name, mime_type, size_bytes; no url) OR a
--                       link (url; no file columns). The four file columns become nullable for link rows; a
--                       CHECK keeps every row one or the other. Retired = archived_at set, as before. Nothing
--                       is ever deleted.
--   hub_resource_links  one row per tracked short link made for one contact ("Share a resource" on the contact
--                       card): its random 12-character code, the resource, the contact, who made it, and the
--                       first click, latest click and click count. No IP address, user agent or other
--                       fingerprint is stored anywhere.
--
-- EXISTING ROWS: production holds 4 file rows (all Neuro Progeny, all active). They get kind 'pdf' when their
--   mime_type is application/pdf, else 'other'. Their other values are unchanged.
--
-- ACCESS, matching hub_222: RLS on, no policies, no privileges for anon or authenticated, so both tables are
--   reachable only with the service role. Staff reach them through the Hub routes (withStaff and the Resource
--   Library's superadmin rule); the public redirect /r/<code> reaches hub_resource_links through the service
--   role and accepts only an existing, unrevoked code whose resource is active.
--
-- ROLLBACK (link rows must be removed first, since the file columns become NOT NULL again):
--   begin;
--   drop table if exists public.hub_resource_links;
--   delete from public.hub_resources where url is not null;
--   drop index if exists public.hub_resources_org_url;
--   alter table public.hub_resources
--     drop constraint if exists hub_resources_file_or_link,
--     drop constraint if exists hub_resources_kind_check,
--     drop constraint if exists hub_resources_url_check,
--     drop constraint if exists hub_resources_where_used_check,
--     drop column if exists kind, drop column if exists url, drop column if exists owner_id,
--     drop column if exists where_used;
--   alter table public.hub_resources
--     alter column file_name set not null, alter column storage_path set not null,
--     alter column mime_type set not null, alter column size_bytes set not null;
--   delete from supabase_migrations.schema_migrations where name = 'hub_240_resource_links';
--   commit;
--   (The delete of link rows also removes the resources the seed file 2026-11-18_seed_resources.sql adds.)

begin;

alter table public.hub_resources
  alter column file_name drop not null,
  alter column storage_path drop not null,
  alter column mime_type drop not null,
  alter column size_bytes drop not null,
  add column kind text,
  add column url text,
  add column owner_id uuid,
  add column where_used text;

update public.hub_resources set kind = case when mime_type = 'application/pdf' then 'pdf' else 'other' end where kind is null;

alter table public.hub_resources
  alter column kind set default 'other',
  alter column kind set not null,
  add constraint hub_resources_kind_check check (kind in
    ('booking_link', 'checkout_link', 'quiz', 'program_page', 'video', 'pdf', 'artifact', 'other')),
  add constraint hub_resources_url_check check (url is null or (url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$' and length(url) <= 2000)),
  add constraint hub_resources_where_used_check check (where_used is null or length(where_used) <= 2000),
  add constraint hub_resources_file_or_link check (
    (url is null and storage_path is not null and file_name is not null and mime_type is not null and size_bytes is not null)
    or
    (url is not null and storage_path is null and file_name is null and mime_type is null and size_bytes is null));

-- one row per link URL in an org, so the same link is never listed twice
create unique index hub_resources_org_url on public.hub_resources (org_id, url) where url is not null;

create table public.hub_resource_links (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  resource_id       uuid not null references public.hub_resources(id) on delete cascade,
  contact_id        uuid not null references public.contacts(id) on delete cascade,
  code              text not null unique check (code ~ '^[A-Za-z0-9]{12}$'),
  created_by        uuid not null,
  created_at        timestamptz not null default now(),
  first_clicked_at  timestamptz,
  last_clicked_at   timestamptz,
  click_count       integer not null default 0 check (click_count >= 0),
  revoked_at        timestamptz
);

create index hub_resource_links_contact on public.hub_resource_links (contact_id, created_at desc);
create index hub_resource_links_resource on public.hub_resource_links (resource_id);

alter table public.hub_resource_links enable row level security;
revoke all on public.hub_resource_links from public, anon, authenticated;
grant all on public.hub_resource_links to service_role;

commit;
