-- hub_214_pipeline_deals.sql
--
-- STATUS: APPLIED 2026-10-30 to production (htfrfaxlcuyawtlztxxm) only, through the
-- Supabase connector as migration name hub_214_pipeline_deals.
-- Ledger version: 20261030090453. Backfilled rows: 296 (4 won, 0 lost).
-- Read back after apply: RLS on; anon has no grants; authenticated has SELECT only.
-- Not applied to npu-platform-nonprod: it mirrors the platform, not the Hub, and
-- the Hub has no nonprod.
--
-- Hub band (200+). Checked 2026-10-30: files stop at hub_213, no hub_214 or 214.
--
-- PURPOSE: lead value and close timing for a card on the CRM pipeline board.
-- One row per deal, meaning one contact's placement in one pipeline
-- (contact_id + pipeline_key).
--
-- pipeline_key is the pipeline's stable id from org_settings.crm_pipelines
-- (pipelines[].id, e.g. 'default', 'pipeline-1773312953082', or a uuid), the same
-- value the board writes to contacts.pipeline_id. It is NOT the name: names are a
-- separate field and are not unique (two pipelines in one org are both named
-- 'Enrolled'). Renaming a pipeline changes only its name, so rows are unaffected.
-- Deleting a pipeline removes it from the JSON; its rows stay in this table,
-- unreferenced, and no board or summary shows or counts them (the board filters
-- by the active pipeline's id). Deleting a contact deletes its rows (cascade).
--
--   value             USD, NULL means "no value" (not $0)
--   entered_at        when the card entered this pipeline (Avg Close start)
--   stage_changed_at  last stage move inside this pipeline (Stale 14d+)
--   won_at / lost_at  set when the card enters a won / lost stage, cleared when it
--                     moves back to an open stage (Avg Close end, Win Rate)
--
-- Won/lost is NOT stored on stages here: the board already has is_closed_won /
-- is_closed_lost on each stage in org_settings.crm_pipelines (mirrored into
-- public.pipeline_stages), editable in Edit Stages. This table reuses that.
--
-- contacts stays byte-identical (shared with the platform and NeuroReport, ruling
-- A2 in docs/plans/hub-marketing-build-rulings.md). The legacy, never-populated
-- contacts.custom_fields.value is left alone (0 rows hold it on 2026-10-30).
--
-- ACCESS: RLS on. anon has no privileges. authenticated has SELECT only, filtered
-- by the staff policy. Writes are service_role only, through
-- POST /api/crm/pipeline-deals, which checks staff + membership in the CONTACT's
-- org and derives won/lost from the authoritative stage config.
--
-- ROLLBACK:
--   begin;
--   drop table if exists public.hub_pipeline_deals;
--   delete from supabase_migrations.schema_migrations where name = 'hub_214_pipeline_deals';
--   commit;

begin;

create table public.hub_pipeline_deals (
  org_id           uuid not null,
  contact_id       uuid not null references public.contacts(id) on delete cascade,
  pipeline_key     text not null check (length(pipeline_key) between 1 and 200),
  value            numeric(12,2) check (value is null or (value >= 0 and value < 10000000000)),
  entered_at       timestamptz not null default now(),
  stage_changed_at timestamptz not null default now(),
  won_at           timestamptz,
  lost_at          timestamptz,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  primary key (contact_id, pipeline_key),
  check (won_at is null or lost_at is null)
);

create index hub_pipeline_deals_org_pipeline on public.hub_pipeline_deals (org_id, pipeline_key);

alter table public.hub_pipeline_deals enable row level security;
revoke all on public.hub_pipeline_deals from anon;
revoke insert, update, delete, truncate, references, trigger on public.hub_pipeline_deals from authenticated;
grant select on public.hub_pipeline_deals to authenticated;
create policy hub_pipeline_deals_staff_read on public.hub_pipeline_deals for select to authenticated
  using (org_id in (select public.hub_team_org_ids()));
grant all on public.hub_pipeline_deals to service_role;

-- ─── backfill: one row per contact currently placed in a pipeline ─────────────
-- Only placements whose pipeline_id exists in the contact's own org config
-- (3 contacts on 2026-10-30 point at a deleted or other-org pipeline id; no board
-- shows them, so they get no row).
--
-- contact_timeline 'pipeline_changed' events carry only {from, to} stage names,
-- no pipeline id. An event counts as "into this pipeline" when its `to` matches a
-- stage name of this pipeline. entered_at is the earliest such event after the
-- contact's last event into a stage NOT in this pipeline (or a removal, to = null),
-- so an earlier stint elsewhere does not count. Falls back to contacts.created_at
-- when there is no such event.
--
-- stage_changed_at = latest 'pipeline_changed' event, else entered_at
-- won_at / lost_at = stage_changed_at when the current stage is flagged won / lost
-- value            = NULL for everyone (nothing to carry over)
with cfg as (
  select o.org_id,
         p->>'id' as pkey,
         lower(trim(s->>'name')) as sname,
         coalesce((s->>'is_closed_won')::boolean, false)  as w,
         coalesce((s->>'is_closed_lost')::boolean, false) as l
    from public.org_settings o
   cross join lateral jsonb_array_elements(o.setting_value->'pipelines') p
   cross join lateral jsonb_array_elements(p->'stages') s
   where o.setting_key = 'crm_pipelines'
), ev as (
  select t.contact_id, t.occurred_at, lower(trim(t.metadata->>'to')) as to_s
    from public.contact_timeline t
   where t.event_type = 'pipeline_changed'
), placed as (
  select c.org_id, c.id as contact_id, c.pipeline_id as pkey, lower(trim(c.pipeline_stage)) as cur_s, c.created_at
    from public.contacts c
   where c.pipeline_id is not null
     and c.org_id is not null
     and c.merged_into_id is null
     and exists (select 1 from cfg where cfg.org_id = c.org_id and cfg.pkey = c.pipeline_id)
), timed as (
  select pl.*,
         (select max(e.occurred_at) from ev e where e.contact_id = pl.contact_id) as last_move,
         (select min(e.occurred_at) from ev e
           where e.contact_id = pl.contact_id
             and e.to_s in (select cfg.sname from cfg where cfg.org_id = pl.org_id and cfg.pkey = pl.pkey)
             and e.occurred_at > coalesce((
                   select max(x.occurred_at) from ev x
                    where x.contact_id = pl.contact_id
                      and (x.to_s is null
                           or x.to_s not in (select cfg.sname from cfg where cfg.org_id = pl.org_id and cfg.pkey = pl.pkey))
                 ), '-infinity'::timestamptz)) as first_in
    from placed pl
), final as (
  select t.org_id, t.contact_id, t.pkey,
         coalesce(t.first_in, t.created_at) as entered_at,
         greatest(coalesce(t.first_in, t.created_at), coalesce(t.last_move, t.created_at)) as stage_changed_at,
         st.w, st.l
    from timed t
    left join lateral (
      select cfg.w, cfg.l from cfg
       where cfg.org_id = t.org_id and cfg.pkey = t.pkey and cfg.sname = t.cur_s
       limit 1
    ) st on true
)
insert into public.hub_pipeline_deals (org_id, contact_id, pipeline_key, entered_at, stage_changed_at, won_at, lost_at)
select f.org_id, f.contact_id, f.pkey, f.entered_at, f.stage_changed_at,
       case when f.w then f.stage_changed_at end,
       case when f.l and not f.w then f.stage_changed_at end
  from final f
on conflict (contact_id, pipeline_key) do nothing;

comment on table public.hub_pipeline_deals is
  'Lead value and close timing for one contact''s placement in one CRM pipeline (pipeline_key = '
  'stable pipeline id from org_settings.crm_pipelines = contacts.pipeline_id). value NULL means no value. '
  'won_at/lost_at follow the stage''s is_closed_won/is_closed_lost flags. Staff read by org; '
  'writes are service_role only via POST /api/crm/pipeline-deals.';

commit;
