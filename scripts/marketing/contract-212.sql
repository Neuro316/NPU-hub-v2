-- Contract tests for hub_212 (entry events). REQUIRES_LIVE = 'database' (a Supabase BRANCH, never the live project).
--
-- Runs the REAL hub_211 and hub_212 functions and triggers against fixtures created
-- inside a block that always raises and rolls back, so a run leaves nothing behind.
-- Each selector plants one defect into the real function text (rolled back with the
-- rest) and must redden EXACTLY the declared set. `none` must be all green.
--
-- Selectors and the red set each must produce (declared from intent, not from a run):
--   none        {}
--   flagoff     {F_OFF_RAISE}                raise_entry_event stops checking the engine flag (the
--               stage trigger checks the flag too, so F_OFF_STAGE holds on that second check)
--   noidem      {D_SAME_EVENT_ONCE}          the same event id queues twice
--   noguard     {M_GUARD_SKIPS}              processing ignores merge and import guards
--   mergetags   {T_MERGE_UNION_SILENT}       the stage/tag trigger stops honouring the merge guard
--   enginemove  {E_ENGINE_MOVE_SILENT}       a stage move made by enroll raises a new event
--   nocap       {B_BULK_CAP}                 processing ignores the per-run cap
create function pg_temp.hub_contract_212(p_tamper text) returns jsonb
language plpgsql as $f$
declare
  r jsonb := '[]'::jsonb;
  np uuid := '00000000-0000-0000-0000-000000000001';
  snw uuid := 'b9fd8b2e-ded6-468b-ab1e-10b50ca40629';
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); c4 uuid := gen_random_uuid();
  c5 uuid := gen_random_uuid(); c6 uuid := gen_random_uuid(); c7 uuid := gen_random_uuid(); cs uuid := gen_random_uuid();
  fa uuid := gen_random_uuid(); fb uuid := gen_random_uuid(); ft uuid := gen_random_uuid(); fbulk uuid := gen_random_uuid();
  tagdef uuid := gen_random_uuid();
  pl uuid; st0 uuid; st1 uuid; st2 uuid; res jsonb; n int; n2 int; t text; def text; newdef text; ok boolean;
  consent0 int; sends0 int;
begin
  begin
    if p_tamper <> 'none' then
      if p_tamper = 'flagoff' then
        def := pg_get_functiondef('public.raise_entry_event(uuid,uuid,text,text,text)'::regprocedure);
        newdef := replace(def, 'if public.hub_flag(p_org, ''engine'') <> ''on'' then return false; end if;', '');
      elsif p_tamper = 'noidem' then
        def := pg_get_functiondef('public.raise_entry_event(uuid,uuid,text,text,text)'::regprocedure);
        newdef := replace(def, 'left(p_event_id, 200)', 'left(p_event_id || gen_random_uuid()::text, 200)');
      elsif p_tamper = 'noguard' then
        def := pg_get_functiondef('public.process_entry_events(integer)'::regprocedure);
        newdef := replace(def, 'and e.created_at between x.starts_at and x.ends_at', 'and false');
      elsif p_tamper = 'mergetags' then
        def := pg_get_functiondef('public.hub_contacts_entry_events()'::regprocedure);
        newdef := replace(def, 'if coalesce(current_setting(''app.suppress_enrollment_trigger'', true), '''') = ''on''', 'if false');
      elsif p_tamper = 'enginemove' then
        def := pg_get_functiondef('public.process_entry_events(integer)'::regprocedure);
        newdef := replace(def, 'perform set_config(''app.hub_engine_write'', ''on'', true);', '');
      elsif p_tamper = 'nocap' then
        def := pg_get_functiondef('public.process_entry_events(integer)'::regprocedure);
        newdef := replace(def, 'limit greatest(1, least(coalesce(p_limit, 100), 500))', 'limit 500');
      else
        raise exception 'unknown selector %', p_tamper;
      end if;
      if newdef = def then
        r := r || jsonb_build_object('id', 'TAMPER_DEAD', 'ok', false, 'got', 'substitution matched nothing');
      end if;
      execute newdef;
    end if;

    -- ── fixtures ──
    insert into public.org_settings (org_id, setting_key, setting_value) values
      (np, 'crm_pipelines', '{"pipelines":[{"id":"p-sales","name":"Sales","is_default":true,"stages":[
         {"id":"stage-0","name":"New Lead","position":0},{"id":"stage-1","name":"Booked","position":1},{"id":"stage-2","name":"Onboarding","position":2}]}]}'),
      (np, 'hub_marketing_flags', '{"engine":"off","mirror_legacy_stage":"on"}')
    on conflict (org_id, setting_key) do update set setting_value = excluded.setting_value;
    perform public.sync_pipelines_from_settings(np);
    select p.id into pl from public.pipelines p where p.org_id = np and p.legacy_key = 'p-sales';
    select s.id into st0 from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.org_id = np and p.legacy_key = 'p-sales' and s.legacy_key = 'stage-0';
    select s.id into st1 from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.org_id = np and p.legacy_key = 'p-sales' and s.legacy_key = 'stage-1';
    select s.id into st2 from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.org_id = np and p.legacy_key = 'p-sales' and s.legacy_key = 'stage-2';

    insert into public.contacts (id, org_id, first_name, last_name, email, pipeline_id, pipeline_stage, tags) values
      (c1, np, 'Test', 'One',   'one@test.example',   'p-sales', 'New Lead', '{}'),
      (c2, np, 'Test', 'Two',   'two@test.example',   'p-sales', 'New Lead', '{}'),
      (c3, np, 'Test', 'Three', 'three@test.example', null, null, '{}'),
      (c5, np, 'Test', 'Five',  'five@test.example',  'p-sales', 'New Lead', '{}'),
      (c6, np, 'Test', 'Six',   'six@test.example',   'p-sales', 'New Lead', '{}'),
      (c7, np, 'Test', 'Seven', 'seven@test.example', 'p-sales', 'New Lead', '{}'),
      (cs, snw, 'Test', 'Other', 'snw@test.example',  null, null, '{}');
    insert into public.contacts (id, org_id, first_name, last_name, email, merged_into_id) values (c4, np, 'Test', 'Merged', 'four@test.example', c3);
    insert into public.funnel_campaigns (id, org_id, name, status, entry_pipeline_id, entry_stage_id) values
      (fa, np, 'Booked funnel', 'active', pl, st2),
      (fb, np, 'Onboarding funnel', 'active', null, null),
      (ft, np, 'Tag funnel', 'active', null, null),
      (fbulk, np, 'Bulk funnel', 'draft', null, null);
    insert into public.campaign_routes (org_id, source_key, campaign_id) values
      (np, 'stage:' || st1, fa), (np, 'stage:' || st2, fb), (np, 'tag:vip', ft), (np, 'tag:hot-lead', ft), (np, 'call:missed', ft);
    insert into public.contact_tag_definitions (id, org_id, name) values (tagdef, np, 'Hot Lead');
    select count(*) into consent0 from public.consent_events where org_id = np;
    select count(*) into sends0 from public.message_sends;

    -- ── engine OFF: nothing is queued, nothing enrolls ──
    update public.contacts set pipeline_stage = 'Booked' where id = c2;
    select count(*) into n from public.entry_events where contact_id = c2;
    r := r || jsonb_build_object('id', 'F_OFF_STAGE', 'ok', n = 0, 'got', n);
    ok := public.raise_entry_event(np, c2, 'call:missed', 'call:CAOFF', 'call');
    select count(*) into n from public.entry_events where event_id = 'call:CAOFF';
    r := r || jsonb_build_object('id', 'F_OFF_RAISE', 'ok', not ok and n = 0, 'got', n);
    insert into public.entry_events (org_id, contact_id, source_key, event_id, origin) values (np, c2, 'call:missed', 'call:CAPROC', 'call');
    perform public.process_entry_events(500);
    select count(*) into n from public.campaign_enrollments where contact_id = c2;
    select count(*) into n2 from public.entry_events where event_id = 'call:CAPROC' and status = 'skipped';
    r := r || jsonb_build_object('id', 'F_OFF_PROCESS', 'ok', n = 0 and n2 = 1, 'got', jsonb_build_array(n, n2));

    -- ── engine ON ──
    update public.org_settings set setting_value = '{"engine":"on","mirror_legacy_stage":"on"}' where org_id = np and setting_key = 'hub_marketing_flags';

    -- a stage change on the board, the drawer, the bulk action or the API is one UPDATE
    update public.contacts set pipeline_stage = 'Booked' where id = c1;
    select count(*) into n from public.entry_events where contact_id = c1 and source_key = 'stage:' || st1 and origin = 'stage' and status = 'pending';
    r := r || jsonb_build_object('id', 'S_STAGE_RAISED', 'ok', n = 1, 'got', n);
    update public.contacts set pipeline_stage = 'New Lead' where id = c5;  -- back into a stage nobody listens for
    update public.contacts set pipeline_stage = 'New Lead', first_name = 'Five' where id = c5;  -- no change of stage at all
    select count(*) into n from public.entry_events where contact_id = c5;
    r := r || jsonb_build_object('id', 'S_NO_ROUTE_NO_EVENT', 'ok', n = 0, 'got', n);
    insert into public.contacts (org_id, first_name, last_name, email, pipeline_id, pipeline_stage) values (np, 'Inserted', 'Row', 'ins@test.example', 'p-sales', 'Booked');
    select count(*) into n from public.entry_events e join public.contacts c on c.id = e.contact_id where c.email = 'ins@test.example';
    r := r || jsonb_build_object('id', 'I_INSERT_SILENT', 'ok', n = 0, 'got', n);

    res := public.process_entry_events(500);
    select count(*) into n from public.campaign_enrollments where contact_id = c1 and campaign_id = fa and status = 'active';
    r := r || jsonb_build_object('id', 'S_PROCESS_ENROLLS', 'ok', n = 1 and exists (select 1 from public.entry_events where contact_id = c1 and status = 'enrolled'), 'got', res);
    -- enroll moved c1 into fa's entry stage (st2), which another campaign listens for; that move is the engine's, not a person's
    select count(*) into n from public.entry_events where contact_id = c1 and source_key = 'stage:' || st2;
    r := r || jsonb_build_object('id', 'E_ENGINE_MOVE_SILENT', 'ok', n = 0 and (select pipeline_stage from public.contacts where id = c1) = 'Onboarding', 'got', n);

    -- ── duplicates ──
    ok := public.raise_entry_event(np, c1, 'call:missed', 'call:CA111', 'call');
    ok := ok and not public.raise_entry_event(np, c1, 'call:missed', 'call:CA111', 'call');
    select count(*) into n from public.entry_events where event_id like 'call:CA111%';
    r := r || jsonb_build_object('id', 'D_SAME_EVENT_ONCE', 'ok', ok and n = 1, 'got', n);
    insert into public.entry_events (org_id, contact_id, source_key, event_id, origin) values (np, c1, 'stage:' || st1, 'stage_change:later', 'stage');
    perform public.process_entry_events(500);
    select count(*) into n from public.campaign_enrollments where contact_id = c1 and campaign_id = fa and status = 'duplicate';
    select count(*) into n2 from public.campaign_enrollments where contact_id = c1 and campaign_id = fa and status = 'active';
    r := r || jsonb_build_object('id', 'D_SECOND_EVENT_DUPLICATE', 'ok', n = 1 and n2 = 1, 'got', jsonb_build_array(n, n2));
    res := public.process_entry_events(500);
    r := r || jsonb_build_object('id', 'D_REPROCESS_NOOP', 'ok', (res ->> 'processed')::int = 0, 'got', res);

    -- ── tags ──
    update public.contacts set tags = array['VIP'] where id = c6;
    select count(*) into n from public.entry_events where contact_id = c6 and source_key = 'tag:vip' and origin = 'tag';
    r := r || jsonb_build_object('id', 'T_TAG_ARRAY', 'ok', n = 1, 'got', n);
    insert into public.contact_tags (contact_id, tag_definition_id, org_id) values (c7, tagdef, np);
    select count(*) into n from public.entry_events where contact_id = c7 and source_key = 'tag:hot-lead' and origin = 'contact_tag';
    r := r || jsonb_build_object('id', 'T_CONTACT_TAGS', 'ok', n = 1, 'got', n);
    perform public.merge_union_tags(c3, array['VIP']);
    select count(*) into n from public.entry_events where contact_id = c3;
    r := r || jsonb_build_object('id', 'T_MERGE_UNION_SILENT', 'ok', n = 0, 'got', n);
    -- merge_union_tags (075) sets its guard for the rest of the transaction. A real merge is
    -- its own transaction; clear it here so the cases below run as later transactions would.
    perform set_config('app.suppress_enrollment_trigger', '', true);

    -- ── merges ──
    perform public.guard_entry_events(np, array[c5], 'contact_merge', 10);
    update public.contacts set pipeline_stage = 'Booked' where id = c5;
    perform public.process_entry_events(500);
    select count(*) into n from public.campaign_enrollments where contact_id = c5;
    r := r || jsonb_build_object('id', 'M_GUARD_SKIPS', 'ok', n = 0 and exists (select 1 from public.entry_events where contact_id = c5 and status = 'skipped' and result ->> 'reason' = 'contact_merge'), 'got', n);
    -- an event for a contact merged away during enrollment lands on the survivor
    ok := public.raise_entry_event(np, c4, 'call:missed', 'call:CA444', 'call');
    perform public.process_entry_events(500);
    select count(*) into n from public.campaign_enrollments where contact_id = c3 and source_key = 'call:missed';
    select count(*) into n2 from public.campaign_enrollments where contact_id = c4;
    r := r || jsonb_build_object('id', 'M_MERGED_TO_SURVIVOR', 'ok', ok and n = 1 and n2 = 0, 'got', jsonb_build_array(n, n2));
    -- marking a contact merged in the same statement as a stage change raises nothing
    update public.contacts set merged_into_id = c3, pipeline_stage = 'Booked' where id = c2;
    select count(*) into n from public.entry_events where contact_id = c2 and source_key = 'stage:' || st1;
    r := r || jsonb_build_object('id', 'M_LOSER_MARK_SILENT', 'ok', n = 0, 'got', n);

    -- ── other org: a contact cannot be enrolled into another org's campaign ──
    insert into public.entry_events (org_id, contact_id, source_key, event_id, origin) values (np, cs, 'call:missed', 'call:CAXORG', 'call');
    perform public.process_entry_events(500);
    select count(*) into n from public.campaign_enrollments where contact_id = cs;
    r := r || jsonb_build_object('id', 'X_CROSS_ORG', 'ok', n = 0 and exists (select 1 from public.entry_events where event_id = 'call:CAXORG' and status in ('failed','skipped')), 'got', n);

    -- ── bulk: 150 contacts moved in one statement, capped per run ──
    update public.funnel_campaigns set status = 'active' where id = fbulk;
    insert into public.campaign_routes (org_id, source_key, campaign_id) values (np, 'stage:' || st0, fbulk);
    insert into public.contacts (org_id, first_name, last_name, email, pipeline_id, pipeline_stage)
      select np, 'Bulk', 'Row', 'bulk' || g || '@test.example', 'p-sales', 'Booked' from generate_series(1, 150) g;
    update public.contacts set pipeline_stage = 'New Lead' where email like 'bulk%@test.example';
    select count(*) into n from public.entry_events where source_key = 'stage:' || st0 and status = 'pending';
    res := public.process_entry_events(100);
    r := r || jsonb_build_object('id', 'B_BULK_CAP', 'ok', n = 150 and (res ->> 'processed')::int = 100 and (res ->> 'waiting')::int = 50, 'got', jsonb_build_array(n, res));

    -- ── nothing here creates or changes consent, and nothing is sent ──
    select count(*) into n from public.consent_events where org_id = np;
    select count(*) into n2 from public.message_sends;
    r := r || jsonb_build_object('id', 'C_NO_CONSENT_NO_SENDS', 'ok', n = consent0 and n2 = sends0, 'got', jsonb_build_array(n - consent0, n2 - sends0));

    -- ── a browser session cannot queue or process events ──
    execute 'set local role authenticated';
    begin
      perform public.raise_entry_event(np, c1, 'call:missed', 'call:RLS', 'call');
      r := r || jsonb_build_object('id', 'R_RAISE_CLOSED', 'ok', false, 'got', 'executed');
    exception when insufficient_privilege then
      r := r || jsonb_build_object('id', 'R_RAISE_CLOSED', 'ok', true, 'got', '42501');
    end;
    begin
      insert into public.entry_events (org_id, contact_id, source_key, event_id, origin) values (np, c1, 'call:missed', 'call:RLS2', 'call');
      r := r || jsonb_build_object('id', 'R_INSERT_CLOSED', 'ok', false, 'got', 'inserted');
    exception when insufficient_privilege then
      r := r || jsonb_build_object('id', 'R_INSERT_CLOSED', 'ok', true, 'got', '42501');
    end;
    execute 'reset role';

    raise exception 'HUB_TEST_ROLLBACK';
  exception when others then
    if sqlerrm <> 'HUB_TEST_ROLLBACK' then
      r := r || jsonb_build_object('id', 'CRASH', 'ok', false, 'got', sqlstate || ' ' || sqlerrm);
    end if;
  end;
  return r;
end $f$;

with runs as (
  select s.sel, s.want, pg_temp.hub_contract_212(s.sel) as res
  from (values ('none', '{}'::text[]),
               ('flagoff', '{F_OFF_RAISE}'),
               ('noidem', '{D_SAME_EVENT_ONCE}'),
               ('noguard', '{M_GUARD_SKIPS}'),
               ('mergetags', '{T_MERGE_UNION_SILENT}'),
               ('enginemove', '{E_ENGINE_MOVE_SILENT}'),
               ('nocap', '{B_BULK_CAP}')) as s(sel, want)
), red as (
  select sel, want, jsonb_array_length(res) as cases,
         coalesce((select array_agg(e ->> 'id' order by e ->> 'id') from jsonb_array_elements(res) e where not coalesce((e ->> 'ok')::boolean, false)), '{}') as got,
         res
  from runs
)
select sel, cases, got as red, want as declared, got = want as verdict_ok,
       case when sel = 'none' or got <> want then (select jsonb_agg(e) from jsonb_array_elements(res) e where not coalesce((e ->> 'ok')::boolean, false)) end as failures
from red order by sel = 'none' desc, sel;
