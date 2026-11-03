-- hub_222_resource_library.sql
--
-- STATUS: APPLIED to production (htfrfaxlcuyawtlztxxm) on 2026-11-03, ledger version
-- 20261103125315, migration name hub_222_resource_library. Amended before the apply so
-- hub_resource_sends.mailbox_id is nullable with on delete set null: deleting a Hub user
-- cascades to hub_mail_connections, and a plain foreign key would block that.
-- Verified after the apply: the bucket is private with no storage policies; both tables
-- have RLS on, no policies, and no anon or authenticated grants.
--
-- Hub band (200+). Checked 2026-11-02: the ledger stops at hub_221. This is 222.
--
-- PURPOSE: Build 2, the Resource Library (docs/plans/hub-resource-library-rulings.md).
--   storage bucket hub-resources  private; PDF, DOCX and images; 50 MB per file
--   hub_resources                 one row per file: name, description, order, the
--                                 "default for discovery follow-up" box, archived_at
--   hub_resource_sends            one row per "Send resources" email: who, from which
--                                 mailbox, to whom, the subject, which files went as
--                                 attachments and which as signed links, the Gmail id.
--                                 The note (the email's body) and file contents are
--                                 never stored.
--
-- ACCESS:
--   - Both tables have RLS on with no policies. anon and authenticated have no
--     privileges, so they are service_role only.
--   - The bucket is private and has no storage.objects policies. Every existing policy
--     names its own bucket (checked 2026-11-02), so only the service role reaches it.
--   - Files leave only as attachments, or as time-limited signed URLs minted
--     server-side. There is never a public URL.
--
-- ROLLBACK (the bucket must be emptied first, through the Storage API or dashboard):
--   begin;
--   drop table if exists public.hub_resource_sends;
--   drop table if exists public.hub_resources;
--   delete from storage.buckets where id = 'hub-resources';
--   delete from supabase_migrations.schema_migrations where name = 'hub_222_resource_library';
--   commit;

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hub-resources', 'hub-resources', false, 52428800, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp'
]);

create table public.hub_resources (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  name                  text not null check (length(btrim(name)) between 1 and 200),
  description           text check (description is null or length(description) <= 2000),
  file_name             text not null check (length(file_name) between 1 and 255),
  storage_path          text not null unique,
  mime_type             text not null check (mime_type in (
                          'application/pdf',
                          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                          'image/jpeg', 'image/png', 'image/gif', 'image/webp')),
  size_bytes            bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  is_default_followup   boolean not null default false,
  sort_order            integer not null default 0,
  archived_at           timestamptz,
  created_by            uuid not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index hub_resources_org_order on public.hub_resources (org_id, sort_order) where archived_at is null;

create table public.hub_resource_sends (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  contact_id        uuid references public.contacts(id) on delete set null,
  sent_by           uuid not null,
  mailbox_id        uuid references public.hub_mail_connections(id) on delete set null,  -- nullable: deleting a Hub user cascades to hub_mail_connections
  from_address      text not null,
  to_address        text not null,
  subject           text not null check (length(subject) between 1 and 250),
  attached          jsonb not null default '[]' check (jsonb_typeof(attached) = 'array'),  -- [{id, name, size_bytes}]
  linked            jsonb not null default '[]' check (jsonb_typeof(linked) = 'array'),    -- [{id, name, size_bytes, expires_at}]
  gmail_message_id  text,
  sent_at           timestamptz not null default now()
);

create index hub_resource_sends_contact on public.hub_resource_sends (contact_id, sent_at desc);

alter table public.hub_resources enable row level security;
alter table public.hub_resource_sends enable row level security;
revoke all on public.hub_resources, public.hub_resource_sends from public, anon, authenticated;
grant all on public.hub_resources, public.hub_resource_sends to service_role;

commit;
