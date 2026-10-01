-- Branch only: the objects hub_212 reads that hub_211_dependencies.sql does not create.
-- Load AFTER hub_211_dependencies.sql and hub_211_marketing_engine.sql, BEFORE hub_212.
-- Copied by hand from the live catalog (pg_catalog, 2026-10-01). Never run against live.
--   contact_tag_definitions, contact_tags, contact_import_batches: columns and keys as live.
--   merge_union_tags: the live body from migration 075, verbatim.
--   trg_contact_tag_change is NOT copied: it creates participants from tags (stripe_product_tag_map),
--   which hub_212 does not touch; hub_212 honours the same merge guard it does.

create table public.contact_tag_definitions (
  id uuid not null default gen_random_uuid() primary key,
  org_id uuid, category_id uuid, name text not null, description text,
  is_active boolean default true, sort_order integer default 0, created_at timestamptz default now(),
  unique (org_id, category_id, name)
);
create table public.contact_tags (
  id uuid not null default gen_random_uuid() primary key,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tag_definition_id uuid not null references public.contact_tag_definitions(id) on delete cascade,
  org_id uuid not null, created_at timestamptz not null default now(),
  unique (contact_id, tag_definition_id)
);
create table public.contact_import_batches (
  id uuid not null default gen_random_uuid() primary key,
  org_id uuid not null, imported_by uuid, filename text, total_rows integer default 0,
  imported_rows integer default 0, skipped_rows integer default 0, status text default 'pending',
  column_mapping jsonb default '{}'::jsonb, notes text, created_at timestamptz default now()
);
grant select, insert, update, delete on public.contact_tag_definitions, public.contact_tags, public.contact_import_batches to service_role;

create or replace function public.merge_union_tags(p_winner uuid, p_tags text[])
 returns void
 language plpgsql
 security definer
 set search_path = public
as $$
begin
  perform set_config('app.suppress_enrollment_trigger', 'on', true);
  update contacts set tags = p_tags where id = p_winner;
end;
$$;
revoke all on function public.merge_union_tags(uuid, text[]) from public, anon, authenticated;
grant execute on function public.merge_union_tags(uuid, text[]) to service_role;
