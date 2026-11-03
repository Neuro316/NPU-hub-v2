-- hub_221_booking_routes_seed.sql
--
-- STATUS: APPLIED to production (htfrfaxlcuyawtlztxxm) on 2026-11-02 as
-- hub_221_booking_routes_seed, ledger version 20261103015905, after hub_220. Ruled at the
-- go: the sales pipeline is Waynesville Neuro Wellness (pipeline-1790143608575) with its
-- EXISTING stage "Scheduled discovery call"; no stage was created. Read back: both routes
-- present, create_contact_if_missing and move_earlier_stages_only on.
--
-- DATA ONLY, no schema change:
--   1. In org_settings.crm_pipelines (Neuro Progeny org), add the stage "Discovery Call
--      Booked" to the chosen sales pipeline right after its first stage, unless a stage
--      of that name already exists. Positions after it shift by one. The existing
--      trigger hub_org_settings_pipeline_sync mirrors it into public.pipeline_stages,
--      as for a stage added in Edit Stages.
--   2. Upsert two rows in nr_booking_pipeline_routes (shared booking-link-to-pipeline
--      config, which the Hub may write; ruled 2026-11-02):
--        WNW Discovery Call  -> <sales pipeline> / Discovery Call Booked
--        Interesting meeting -> Neuro Progeny Email Meetings / Meeting Booked (first stage)
--      Both: create_contact_if_missing = true, move_earlier_stages_only = true.
--      Appointment types and pipelines are found by name inside the Neuro Progeny org;
--      the other org's "Interesting meeting" is not touched.
--
-- pipeline_id holds the board's pipeline id from org_settings.crm_pipelines (the value
-- contacts.pipeline_id holds), not the public.pipelines mirror uuid.
--
-- ROLLBACK:
--   begin;
--   delete from public.nr_booking_pipeline_routes r using public.nr_appointment_types t
--    where r.appointment_type_id = t.id and t.org_id = '00000000-0000-0000-0000-000000000001'
--      and t.name in ('WNW Discovery Call', 'Interesting meeting');
--   -- the stage stays: remove it in Edit Stages once no contact sits in it
--   delete from supabase_migrations.schema_migrations where name = 'hub_221_booking_routes_seed';
--   commit;

begin;

do $seed$
declare
  c_org      constant uuid := '00000000-0000-0000-0000-000000000001';
  -- ruled at the go (2026-11-02): Waynesville Neuro Wellness, its existing stage
  c_sales    constant text := 'pipeline-1790143608575';
  c_stage    constant text := 'Scheduled discovery call';
  v_cfg      jsonb;
  v_pipes    jsonb;
  v_pipe     jsonb;
  v_idx      int;
  v_stages   jsonb;
  v_new      jsonb := '[]';
  v_sales    jsonb;
  v_meet     jsonb;
  v_wnw      uuid;
  v_int      uuid;
  i          int;
begin
  select setting_value into v_cfg from public.org_settings
   where org_id = c_org and setting_key = 'crm_pipelines' for update;
  v_pipes := v_cfg->'pipelines';

  select p, o::int - 1 into v_pipe, v_idx
    from jsonb_array_elements(v_pipes) with ordinality t(p, o) where p->>'id' = c_sales;
  if v_pipe is null then raise exception 'hub_221: sales pipeline % not found', c_sales; end if;

  -- 1. the stage, after the first stage, unless it exists (it does: nothing is created)
  v_stages := coalesce(v_pipe->'stages', '[]');
  if not exists (select 1 from jsonb_array_elements(v_stages) s where lower(trim(s->>'name')) = lower(c_stage)) then
    for i in 0 .. jsonb_array_length(v_stages) - 1 loop
      v_new := v_new || jsonb_set(v_stages->i, '{position}', to_jsonb(case when i = 0 then 0 else i + 1 end));
      if i = 0 then
        v_new := v_new || jsonb_build_object(
          'id', 'stage-discovery-booked', 'name', c_stage, 'color', '#228DC4', 'position', 1,
          'is_closed_won', false, 'is_closed_lost', false);
      end if;
    end loop;
    v_pipes := jsonb_set(v_pipes, array[v_idx::text, 'stages'], v_new);
    update public.org_settings set setting_value = jsonb_set(v_cfg, '{pipelines}', v_pipes)
     where org_id = c_org and setting_key = 'crm_pipelines';
  end if;

  select p into v_sales from jsonb_array_elements(v_pipes) p where p->>'id' = c_sales;
  select p into v_meet from jsonb_array_elements(v_pipes) p where p->>'name' = 'Neuro Progeny Email Meetings';
  if v_meet is null then raise exception 'hub_221: Neuro Progeny Email Meetings not found'; end if;

  select id into v_wnw from public.nr_appointment_types where org_id = c_org and name = 'WNW Discovery Call';
  select id into v_int from public.nr_appointment_types where org_id = c_org and name = 'Interesting meeting';
  if v_wnw is null or v_int is null then raise exception 'hub_221: appointment type not found'; end if;

  -- 2. the routes
  insert into public.nr_booking_pipeline_routes
    (appointment_type_id, org_id, pipeline_id, pipeline_name, stage_name, move_earlier_stages_only, create_contact_if_missing)
  values
    (v_wnw, c_org, v_sales->>'id', v_sales->>'name', c_stage, true, true),
    (v_int, c_org, v_meet->>'id', v_meet->>'name', v_meet->'stages'->0->>'name', true, true)
  on conflict (appointment_type_id) do update
    set pipeline_id = excluded.pipeline_id, pipeline_name = excluded.pipeline_name,
        stage_name = excluded.stage_name, move_earlier_stages_only = excluded.move_earlier_stages_only,
        create_contact_if_missing = excluded.create_contact_if_missing, updated_at = now();
end
$seed$;

commit;
