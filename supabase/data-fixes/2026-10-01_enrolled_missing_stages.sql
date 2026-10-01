-- 2026-10-01_enrolled_missing_stages.sql  (data fix, not a migration: no schema change)
--
-- STATUS: PROPOSED. Tested on the preview branch inside a rolled-back transaction.
--
-- Adds the stages "Signed up", "Checkout started" and "Paid" to the Enrolled pipeline
-- (pipeline-1771530511407) of Neuro Progeny, as Cameron asked, and places the 8 contacts
-- whose stage text names one of them and therefore renders in no column today.
--
-- WHERE A STAGE LIVES. The board reads org_settings.crm_pipelines (JSON); pipelines and
-- pipeline_stages (hub_211) are synced FROM that JSON by sync_pipelines_from_settings, which
-- archives any stage missing from the JSON. So a stage added only to pipeline_stages would be
-- archived by the next save of the pipeline editor. The stages are therefore appended to the
-- JSON, and the sync then creates their pipeline_stages rows.
--
-- ADDITIVE. Appends three stage objects to one pipeline's stages array; no existing stage,
-- name, position, colour or stage email changes. No stage email is configured on the new
-- stages. Inserts position rows only for contacts that have none in this pipeline. Updates no
-- contact. No entry event can be raised: no contacts row is updated, and there are 0 active
-- stage or tag routes (asserted below).
--
-- ============================================================================
-- ROLLBACK (written first)
-- ============================================================================
-- begin;
-- delete from public.contact_pipeline_positions where source = 'stage_fix_2026_10_01';
-- update public.org_settings o
--    set setting_value = jsonb_set(o.setting_value, array['pipelines', x.idx::text, 'stages'],
--          (select coalesce(jsonb_agg(st order by ord), '[]'::jsonb)
--             from jsonb_array_elements(o.setting_value #> array['pipelines', x.idx::text, 'stages']) with ordinality as e(st, ord)
--            where st->>'id' not in ('stage-fix-signed-up', 'stage-fix-checkout-started', 'stage-fix-paid'))),
--        updated_at = now()
--   from (select (p.ord - 1) as idx from public.org_settings s,
--           jsonb_array_elements(s.setting_value -> 'pipelines') with ordinality as p(v, ord)
--          where s.org_id = '00000000-0000-0000-0000-000000000001' and s.setting_key = 'crm_pipelines'
--            and p.v ->> 'id' = 'pipeline-1771530511407') x
--  where o.org_id = '00000000-0000-0000-0000-000000000001' and o.setting_key = 'crm_pipelines';
-- select public.sync_pipelines_from_settings('00000000-0000-0000-0000-000000000001');  -- archives the three stage rows
-- commit;
-- ============================================================================

begin;

do $$
declare
  np uuid := '00000000-0000-0000-0000-000000000001';
  n int;
begin
  -- the pipeline exists exactly once, and none of the three names or ids is already in it
  select count(*) into n from public.org_settings s, jsonb_array_elements(s.setting_value -> 'pipelines') p
   where s.org_id = np and s.setting_key = 'crm_pipelines' and p ->> 'id' = 'pipeline-1771530511407';
  if n <> 1 then raise exception 'ABORT: Enrolled pipeline found % times', n; end if;
  select count(*) into n from public.org_settings s, jsonb_array_elements(s.setting_value -> 'pipelines') p,
         jsonb_array_elements(p -> 'stages') st
   where s.org_id = np and s.setting_key = 'crm_pipelines' and p ->> 'id' = 'pipeline-1771530511407'
     and (st ->> 'name' in ('Signed up', 'Checkout started', 'Paid') or st ->> 'id' like 'stage-fix-%');
  if n <> 0 then raise exception 'ABORT: % of the three stages already exist', n; end if;
  -- nothing may listen for a stage while this runs
  select count(*) into n from public.campaign_routes where active and (source_key like 'stage:%' or source_key like 'tag:%');
  if n <> 0 then raise exception 'ABORT: % active stage or tag routes', n; end if;
end $$;

-- 1. append the three stages to the Enrolled pipeline's JSON, after the existing eight
update public.org_settings o
   set setting_value = jsonb_set(o.setting_value, array['pipelines', x.idx::text, 'stages'],
         (o.setting_value #> array['pipelines', x.idx::text, 'stages']) || '[
           {"id": "stage-fix-signed-up",        "name": "Signed up",        "color": "#94a3b8", "position": 8},
           {"id": "stage-fix-checkout-started", "name": "Checkout started", "color": "#94a3b8", "position": 9},
           {"id": "stage-fix-paid",             "name": "Paid",             "color": "#2A9D8F", "position": 10}
         ]'::jsonb),
       updated_at = now()
  from (select (p.ord - 1) as idx from public.org_settings s,
          jsonb_array_elements(s.setting_value -> 'pipelines') with ordinality as p(v, ord)
         where s.org_id = '00000000-0000-0000-0000-000000000001' and s.setting_key = 'crm_pipelines'
           and p.v ->> 'id' = 'pipeline-1771530511407') x
 where o.org_id = '00000000-0000-0000-0000-000000000001' and o.setting_key = 'crm_pipelines';

-- 2. create their pipeline_stages rows (the hub_212 trigger also does this while the engine is
--    on; called explicitly so the result does not depend on the flag)
select public.sync_pipelines_from_settings('00000000-0000-0000-0000-000000000001');

-- 3. place the 8 contacts, by their own stage text, in this pipeline only
insert into public.contact_pipeline_positions (contact_id, org_id, pipeline_id, stage_id, source)
select c.id, c.org_id, p.id, s.id, 'stage_fix_2026_10_01'
  from public.contacts c
  join public.pipelines p on p.org_id = c.org_id and p.legacy_key = c.pipeline_id
  join public.pipeline_stages s on s.pipeline_id = p.id and s.name = c.pipeline_stage and s.archived_at is null
 where c.org_id = '00000000-0000-0000-0000-000000000001'
   and c.pipeline_id = 'pipeline-1771530511407'
   and c.merged_into_id is null
   and c.pipeline_stage in ('Signed up', 'Checkout started', 'Paid')
on conflict (contact_id, pipeline_id) do nothing;

-- 4. the exact set, or nothing
do $$
declare got uuid[]; want uuid[] := array[
  '186d3598-ab68-49b6-a127-1559f593e32b','1c4034e9-d580-4e2f-b5f8-57e081ea03c3','4cb236f6-30c8-4d24-a91a-9db786425cee',
  '6c3f7e36-eabc-4f40-9c77-fbf14c39634d','73790e4d-faf0-4fa1-af1c-ca4c640f1d00','c034efaa-4638-410f-89b5-206b4392ba75',
  'd178fa96-cbec-4966-963e-989485c27e77','efc7eb2f-8cdb-48e5-ba76-144ec94581a4']::uuid[];
begin
  select array_agg(contact_id order by contact_id) into got from public.contact_pipeline_positions where source = 'stage_fix_2026_10_01';
  if got is distinct from (select array_agg(x order by x) from unnest(want) x) then
    raise exception 'ABORT: placed % , expected the 8 named contacts', got;
  end if;
  if (select count(*) from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
       where p.legacy_key = 'pipeline-1771530511407' and s.archived_at is null) <> 11 then
    raise exception 'ABORT: Enrolled does not have 11 live stages';
  end if;
  if exists (select 1 from public.entry_events where created_at >= now()) then
    raise exception 'ABORT: an entry event was raised';
  end if;
end $$;

commit;
