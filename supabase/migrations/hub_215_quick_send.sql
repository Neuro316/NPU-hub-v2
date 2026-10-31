-- hub_215_quick_send.sql
--
-- STATUS: APPLIED to production (htfrfaxlcuyawtlztxxm) on 2026-10-31 after Cameron's
-- go, ledger version 20261031160805. The Hub has no nonprod.
--
-- Hub band (200+). Checked 2026-10-31: files stop at hub_214, no hub_215 or 215.
--
-- PURPOSE: Quick Send, emailing documents from the existing Media Library to a
-- contact during or after a call.
--
-- No new library and no new bucket. The documents ARE media_assets rows, with their
-- files in the existing 'media-library' bucket. media_assets is shared with the
-- platform (npu-platform-v2 reads it through its own use-media-data.ts), so it stays
-- byte-identical, the same rule as contacts (ruling A2). Quick Send's fields live in a
-- Hub-owned side table keyed by the media asset, one row per asset, so the same file
-- can never be listed twice.
--
--   hub_quick_send_categories  Programs, Office Services, Supplements and Techniques
--                              (seeded for each org with active Hub staff), plus
--                              admin-added ones. Archived, never deleted, so old send
--                              records keep their meaning.
--   hub_quick_send_items       media_asset_id (PK) -> category, "Available to send",
--                              one-line description, archived_at. A row exists once an
--                              asset is put in Quick Send (from CRM Settings or from the
--                              Media Library toggle); available = false keeps it on the
--                              Quick Send Resources page without offering it.
--   hub_quick_send_sends       one row per resource per send (batch_id groups one
--                              email). The Sends column counts these; the contact's
--                              conversation thread reads them, because crm_messages
--                              only allows sms / mms (crm_messages_msg_type_check).
--                              asset_name is a snapshot, so a renamed or deleted asset
--                              still reads correctly in history.
--
-- ACCESS: RLS on all three. anon has nothing. authenticated has SELECT only, for orgs
-- where the user is active Hub staff (hub_team_org_ids, as hub_211 and hub_214).
-- Every write is service_role, through staff-guarded API routes that check the asset,
-- category and contact all belong to the caller's org.
--
-- ROLLBACK:
--   begin;
--   drop table if exists public.hub_quick_send_sends;
--   drop table if exists public.hub_quick_send_items;
--   drop table if exists public.hub_quick_send_categories;
--   delete from supabase_migrations.schema_migrations where name = 'hub_215_quick_send';
--   commit;

begin;

-- ─── categories ──────────────────────────────────────────────────────────────
create table public.hub_quick_send_categories (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  sort_order  integer not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
-- One live category per name per org, case-insensitive.
create unique index hub_quick_send_categories_org_name
  on public.hub_quick_send_categories (org_id, lower(btrim(name))) where archived_at is null;
create index hub_quick_send_categories_org on public.hub_quick_send_categories (org_id, sort_order);

-- ─── items: Quick Send fields of a media asset ───────────────────────────────
create table public.hub_quick_send_items (
  media_asset_id uuid primary key references public.media_assets(id) on delete cascade,
  org_id         uuid not null references public.organizations(id) on delete cascade,
  category_id    uuid not null references public.hub_quick_send_categories(id) on delete restrict,
  available      boolean not null default false,
  description    text check (description is null or length(description) <= 200),
  archived_at    timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_by     uuid,
  updated_at     timestamptz not null default now()
);
create index hub_quick_send_items_org on public.hub_quick_send_items (org_id, category_id) where archived_at is null;

-- ─── send records ────────────────────────────────────────────────────────────
create table public.hub_quick_send_sends (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  batch_id          uuid not null,
  contact_id        uuid not null references public.contacts(id) on delete cascade,
  media_asset_id    uuid references public.media_assets(id) on delete set null,
  category_id       uuid references public.hub_quick_send_categories(id) on delete set null,
  asset_name        text not null,
  file_size         bigint,
  to_email          text not null,
  note              text check (note is null or length(note) <= 5000),
  sent_by           uuid not null,
  sender_email      text,
  status            text not null check (status in ('sent', 'failed')),
  resend_message_id text,
  error             text,
  sent_at           timestamptz not null default now()
);
create index hub_quick_send_sends_asset on public.hub_quick_send_sends (org_id, media_asset_id) where status = 'sent';
create index hub_quick_send_sends_contact on public.hub_quick_send_sends (contact_id, sent_at desc);
create index hub_quick_send_sends_batch on public.hub_quick_send_sends (batch_id);

-- ─── access ──────────────────────────────────────────────────────────────────
alter table public.hub_quick_send_categories enable row level security;
alter table public.hub_quick_send_items      enable row level security;
alter table public.hub_quick_send_sends      enable row level security;

revoke all on public.hub_quick_send_categories, public.hub_quick_send_items, public.hub_quick_send_sends from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.hub_quick_send_categories, public.hub_quick_send_items, public.hub_quick_send_sends from authenticated;
grant select on public.hub_quick_send_categories, public.hub_quick_send_items, public.hub_quick_send_sends to authenticated;
grant all on public.hub_quick_send_categories, public.hub_quick_send_items, public.hub_quick_send_sends to service_role;

create policy hub_quick_send_categories_staff_read on public.hub_quick_send_categories for select to authenticated
  using (org_id in (select public.hub_team_org_ids()));
create policy hub_quick_send_items_staff_read on public.hub_quick_send_items for select to authenticated
  using (org_id in (select public.hub_team_org_ids()));
create policy hub_quick_send_sends_staff_read on public.hub_quick_send_sends for select to authenticated
  using (org_id in (select public.hub_team_org_ids()));

-- ─── default categories ──────────────────────────────────────────────────────
-- Each org with active Hub staff (on 2026-10-31: Neuro Progeny and Sensorium).
insert into public.hub_quick_send_categories (org_id, name, sort_order)
select o.org_id, d.name, d.sort_order
  from (select distinct tp.org_id from public.team_profiles tp
         where tp.status = 'active' and tp.role in ('super_admin', 'admin', 'team_member')) o
 cross join (values ('Programs', 0), ('Office Services', 1), ('Supplements and Techniques', 2)) d(name, sort_order)
 where not exists (
   select 1 from public.hub_quick_send_categories c
    where c.org_id = o.org_id and lower(btrim(c.name)) = lower(d.name) and c.archived_at is null);

comment on table public.hub_quick_send_categories is
  'Quick Send categories per org (Programs, Office Services, Supplements and Techniques, plus admin-added). Archived, never deleted.';
comment on table public.hub_quick_send_items is
  'Quick Send fields of an existing media_assets row (one row per asset): category, available to send, description. media_assets itself is shared with the platform and unchanged.';
comment on table public.hub_quick_send_sends is
  'One row per resource per Quick Send email; batch_id groups one email. Sends counts and the contact thread read these.';

commit;
