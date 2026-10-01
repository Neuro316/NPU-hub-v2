-- 2026-10-01_enrolled_checkout_started.sql  (data fix, not a migration: no schema change)
--
-- STATUS: PROPOSED. Tested on the preview branch in a rolled-back transaction. Supersedes
-- 2026-10-01_enrolled_missing_stages.sql, which Cameron ruled must not be applied.
--
-- Cameron's ruling (2026-10-01):
--   * add ONLY "Checkout started" to the Enrolled pipeline (pipeline-1771530511407), in the
--     settings JSON plus the existing sync, with no stage emails;
--   * move the 6 contacts at "Signed up" to the pipeline's first stage,
--     "Signed up - add user email used to sign up in Circle; dependency has to be joined circle ";
--   * move the 1 contact at "Paid" to "Paid/ payment plan" (the stage's real name has a space
--     after the slash);
--   * leave contact 4cb236f6 at "Checkout started" and place it in the new stage.
--
-- SENDS NOTHING. Stage emails are sent only by POST /api/crm/stage-emails, which only the board
-- calls, from the browser, when a card is dragged. No database trigger, function or webhook
-- sends one (checked in pg_catalog: no trigger on contacts, contact_timeline,
-- contact_pipeline_positions or org_settings mentions stage emails; no supabase_functions hook).
-- The two target stages DO have stage emails configured; this write does not reach them, and
-- the final abort proves no stage_email_sends or message_sends row was written.
--
-- SIDE EFFECT, stated: trg_pipeline_timeline writes one "pipeline_changed" timeline row for
-- each of the 7 moved contacts. hub_contacts_entry_events fires and exits: 0 active stage or
-- tag routes (asserted).
--
-- ============================================================================
-- ROLLBACK (written first)
-- ============================================================================
-- begin;
-- delete from public.contact_pipeline_positions where source = 'stage_fix_2026_10_01b';
-- update public.contacts set pipeline_stage = 'Signed up'
--  where org_id = '00000000-0000-0000-0000-000000000001' and pipeline_id = 'pipeline-1771530511407'
--    and pipeline_stage = 'Signed up - add user email used to sign up in Circle; dependency has to be joined circle '
--    and id in ('186d3598-ab68-49b6-a127-1559f593e32b','1c4034e9-d580-4e2f-b5f8-57e081ea03c3','6c3f7e36-eabc-4f40-9c77-fbf14c39634d',
--               'c034efaa-4638-410f-89b5-206b4392ba75','d178fa96-cbec-4966-963e-989485c27e77','efc7eb2f-8cdb-48e5-ba76-144ec94581a4');
-- update public.contacts set pipeline_stage = 'Paid'
--  where id = '73790e4d-faf0-4fa1-af1c-ca4c640f1d00' and pipeline_stage = 'Paid/ payment plan';
-- update public.org_settings o
--    set setting_value = jsonb_set(o.setting_value, array['pipelines', x.idx::text, 'stages'],
--          (select coalesce(jsonb_agg(st order by ord), '[]'::jsonb)
--             from jsonb_array_elements(o.setting_value #> array['pipelines', x.idx::text, 'stages']) with ordinality as e(st, ord)
--            where st->>'id' <> 'stage-fix-checkout-started')),
--        updated_at = now()
--   from (select (p.ord - 1) as idx from public.org_settings s,
--           jsonb_array_elements(s.setting_value -> 'pipelines') with ordinality as p(v, ord)
--          where s.org_id = '00000000-0000-0000-0000-000000000001' and s.setting_key = 'crm_pipelines'
--            and p.v ->> 'id' = 'pipeline-1771530511407') x
--  where o.org_id = '00000000-0000-0000-0000-000000000001' and o.setting_key = 'crm_pipelines';
-- select public.sync_pipelines_from_settings('00000000-0000-0000-0000-000000000001');  -- archives the stage row
-- commit;
-- ============================================================================

begin;

-- ─── aborts before any write ─────────────────────────────────────────────────
do $$
declare
  np uuid := '00000000-0000-0000-0000-000000000001';
  pl text := 'pipeline-1771530511407';
  first_stage text := 'Signed up - add user email used to sign up in Circle; dependency has to be joined circle ';
  n int; got uuid[];
begin
  -- the pipeline exists exactly once
  select count(*) into n from public.org_settings s, jsonb_array_elements(s.setting_value -> 'pipelines') p
   where s.org_id = np and s.setting_key = 'crm_pipelines' and p ->> 'id' = pl;
  if n <> 1 then raise exception 'ABORT: Enrolled pipeline found % times', n; end if;

  -- nothing may listen for a stage or a tag
  select count(*) into n from public.campaign_routes where active and (source_key like 'stage:%' or source_key like 'tag:%');
  if n <> 0 then raise exception 'ABORT: % active stage or tag routes', n; end if;

  -- stage names exist exactly once: each target once, "Checkout started" not yet; in the JSON and in pipeline_stages
  select count(*) into n from public.org_settings s, jsonb_array_elements(s.setting_value -> 'pipelines') p, jsonb_array_elements(p -> 'stages') st
   where s.org_id = np and s.setting_key = 'crm_pipelines' and p ->> 'id' = pl and st ->> 'name' = first_stage;
  if n <> 1 then raise exception 'ABORT: first stage named % times in settings', n; end if;
  select count(*) into n from public.org_settings s, jsonb_array_elements(s.setting_value -> 'pipelines') p, jsonb_array_elements(p -> 'stages') st
   where s.org_id = np and s.setting_key = 'crm_pipelines' and p ->> 'id' = pl and st ->> 'name' = 'Paid/ payment plan';
  if n <> 1 then raise exception 'ABORT: "Paid/ payment plan" named % times in settings', n; end if;
  select count(*) into n from public.org_settings s, jsonb_array_elements(s.setting_value -> 'pipelines') p, jsonb_array_elements(p -> 'stages') st
   where s.org_id = np and s.setting_key = 'crm_pipelines' and p ->> 'id' = pl
     and (st ->> 'name' = 'Checkout started' or st ->> 'id' = 'stage-fix-checkout-started');
  if n <> 0 then raise exception 'ABORT: "Checkout started" already in settings % times', n; end if;
  select count(*) into n from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
   where p.org_id = np and p.legacy_key = pl and s.archived_at is null and s.name = first_stage;
  if n <> 1 then raise exception 'ABORT: first stage has % live stage rows', n; end if;
  select count(*) into n from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
   where p.org_id = np and p.legacy_key = pl and s.archived_at is null and s.name = 'Paid/ payment plan';
  if n <> 1 then raise exception 'ABORT: "Paid/ payment plan" has % live stage rows', n; end if;

  -- the exact contact set, by stage text, before anything moves
  select array_agg(id order by id) into got from public.contacts
   where org_id = np and pipeline_id = pl and merged_into_id is null and pipeline_stage = 'Signed up';
  if got is distinct from array['186d3598-ab68-49b6-a127-1559f593e32b','1c4034e9-d580-4e2f-b5f8-57e081ea03c3','6c3f7e36-eabc-4f40-9c77-fbf14c39634d',
     'c034efaa-4638-410f-89b5-206b4392ba75','d178fa96-cbec-4966-963e-989485c27e77','efc7eb2f-8cdb-48e5-ba76-144ec94581a4']::uuid[] then
    raise exception 'ABORT: contacts at "Signed up" are %', got;
  end if;
  select array_agg(id order by id) into got from public.contacts
   where org_id = np and pipeline_id = pl and merged_into_id is null and pipeline_stage = 'Paid';
  if got is distinct from array['73790e4d-faf0-4fa1-af1c-ca4c640f1d00']::uuid[] then raise exception 'ABORT: contacts at "Paid" are %', got; end if;
  select array_agg(id order by id) into got from public.contacts
   where org_id = np and pipeline_id = pl and merged_into_id is null and pipeline_stage = 'Checkout started';
  if got is distinct from array['4cb236f6-30c8-4d24-a91a-9db786425cee']::uuid[] then raise exception 'ABORT: contacts at "Checkout started" are %', got; end if;
end $$;

-- ─── 1. add "Checkout started" to the settings JSON, after the existing eight, no stage emails ──
update public.org_settings o
   set setting_value = jsonb_set(o.setting_value, array['pipelines', x.idx::text, 'stages'],
         (o.setting_value #> array['pipelines', x.idx::text, 'stages'])
           || '[{"id": "stage-fix-checkout-started", "name": "Checkout started", "color": "#94a3b8", "position": 8}]'::jsonb),
       updated_at = now()
  from (select (p.ord - 1) as idx from public.org_settings s,
          jsonb_array_elements(s.setting_value -> 'pipelines') with ordinality as p(v, ord)
         where s.org_id = '00000000-0000-0000-0000-000000000001' and s.setting_key = 'crm_pipelines'
           and p.v ->> 'id' = 'pipeline-1771530511407') x
 where o.org_id = '00000000-0000-0000-0000-000000000001' and o.setting_key = 'crm_pipelines';

-- ─── 2. its pipeline_stages row, through the existing sync ───────────────────
select public.sync_pipelines_from_settings('00000000-0000-0000-0000-000000000001');

-- ─── 3. move the 7 contacts, each update asserted to touch exactly its rows ──
do $$
declare n int;
begin
  update public.contacts set pipeline_stage = 'Signed up - add user email used to sign up in Circle; dependency has to be joined circle '
   where org_id = '00000000-0000-0000-0000-000000000001' and pipeline_id = 'pipeline-1771530511407' and pipeline_stage = 'Signed up'
     and id in ('186d3598-ab68-49b6-a127-1559f593e32b','1c4034e9-d580-4e2f-b5f8-57e081ea03c3','6c3f7e36-eabc-4f40-9c77-fbf14c39634d',
                'c034efaa-4638-410f-89b5-206b4392ba75','d178fa96-cbec-4966-963e-989485c27e77','efc7eb2f-8cdb-48e5-ba76-144ec94581a4');
  get diagnostics n = row_count;
  if n <> 6 then raise exception 'ABORT: moved % of 6 "Signed up" contacts', n; end if;
  update public.contacts set pipeline_stage = 'Paid/ payment plan'
   where org_id = '00000000-0000-0000-0000-000000000001' and pipeline_id = 'pipeline-1771530511407' and pipeline_stage = 'Paid'
     and id = '73790e4d-faf0-4fa1-af1c-ca4c640f1d00';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ABORT: moved % of 1 "Paid" contact', n; end if;
end $$;

-- ─── 4. place the 8 contacts in their stages ─────────────────────────────────
insert into public.contact_pipeline_positions (contact_id, org_id, pipeline_id, stage_id, source)
select c.id, c.org_id, p.id, s.id, 'stage_fix_2026_10_01b'
  from public.contacts c
  join public.pipelines p on p.org_id = c.org_id and p.legacy_key = c.pipeline_id
  join public.pipeline_stages s on s.pipeline_id = p.id and s.name = c.pipeline_stage and s.archived_at is null
 where c.id in ('186d3598-ab68-49b6-a127-1559f593e32b','1c4034e9-d580-4e2f-b5f8-57e081ea03c3','6c3f7e36-eabc-4f40-9c77-fbf14c39634d',
                'c034efaa-4638-410f-89b5-206b4392ba75','d178fa96-cbec-4966-963e-989485c27e77','efc7eb2f-8cdb-48e5-ba76-144ec94581a4',
                '73790e4d-faf0-4fa1-af1c-ca4c640f1d00','4cb236f6-30c8-4d24-a91a-9db786425cee')
   and c.pipeline_id = 'pipeline-1771530511407'
on conflict (contact_id, pipeline_id) do nothing;

-- ─── aborts after the writes ─────────────────────────────────────────────────
do $$
declare got uuid[]; n int;
begin
  -- exactly the 8 contacts were placed, each where it belongs
  select array_agg(cp.contact_id order by cp.contact_id) into got from public.contact_pipeline_positions cp where cp.source = 'stage_fix_2026_10_01b';
  if got is distinct from array['186d3598-ab68-49b6-a127-1559f593e32b','1c4034e9-d580-4e2f-b5f8-57e081ea03c3','4cb236f6-30c8-4d24-a91a-9db786425cee',
     '6c3f7e36-eabc-4f40-9c77-fbf14c39634d','73790e4d-faf0-4fa1-af1c-ca4c640f1d00','c034efaa-4638-410f-89b5-206b4392ba75',
     'd178fa96-cbec-4966-963e-989485c27e77','efc7eb2f-8cdb-48e5-ba76-144ec94581a4']::uuid[] then
    raise exception 'ABORT: placed %, expected the 8 named contacts', got;
  end if;
  select count(*) into n from public.contact_pipeline_positions cp join public.pipeline_stages s on s.id = cp.stage_id
   where cp.source = 'stage_fix_2026_10_01b' and s.name = (select c.pipeline_stage from public.contacts c where c.id = cp.contact_id);
  if n <> 8 then raise exception 'ABORT: % of 8 placements match the contact''s stage', n; end if;
  -- "Checkout started" now exists exactly once, live, and the pipeline has 9 live stages
  select count(*) into n from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
   where p.legacy_key = 'pipeline-1771530511407' and s.archived_at is null and s.name = 'Checkout started';
  if n <> 1 then raise exception 'ABORT: "Checkout started" has % live stage rows', n; end if;
  select count(*) into n from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
   where p.legacy_key = 'pipeline-1771530511407' and s.archived_at is null;
  if n <> 9 then raise exception 'ABORT: Enrolled has % live stages, expected 9', n; end if;
  -- nothing was raised or sent
  if exists (select 1 from public.entry_events where created_at >= now()) then raise exception 'ABORT: an entry event was raised'; end if;
  if exists (select 1 from public.stage_email_sends where claimed_at >= now()) then raise exception 'ABORT: a stage email row was written'; end if;
  if exists (select 1 from public.message_sends where claimed_at >= now()) then raise exception 'ABORT: a message row was written'; end if;
end $$;

commit;
