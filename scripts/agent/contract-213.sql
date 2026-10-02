-- Contract tests for hub_213 (Campaign Builder Agent and Hub Guide). REQUIRES_LIVE = 'database'
-- (a Supabase BRANCH, never the live project).
--
-- Runs the REAL hub_213 functions and trigger, and the REAL live triggers on public.tasks
-- (copied by supabase/branch-bootstrap/hub_213_dependencies.sql), against fixtures created
-- inside a block that always raises and rolls back, so a run leaves nothing behind. Each
-- selector plants one defect into the real function text (rolled back with the rest) and must
-- redden EXACTLY the declared set. `none` must be all green.
--
-- Selectors and the red set each must produce (declared from intent, not from a run):
--   none          {}
--   liveforce     {B_DRAFT_ONLY}                        agent_build takes live_enabled from the plan
--   activeroutes  {A_DRAFT_NO_EVENT,B_ROUTES_INACTIVE}  agent routes are created switched on
--   noidem        {B_REPLAY_SAME}                       a replay of a built run is not recognised
--   crossorg      {B_CROSS_ORG}                         the goal stage's org is not checked
--   noflag        {B_FLAG_OFF}                          agent_build ignores agent_enabled
--   kanban        {T_NO_BOARD_CARD}                     the Project Board guard is not set
--   notrigger     {A_ACTIVATE_ON,A_ACTIVE_RAISES,A_MARKER_ONLY}  activation does not switch agent routes on
--   anytransition {A_DRAFT_ONLY_TRANSITION}             activation fires from paused as well as draft
--   nomarker      {A_MARKER_ONLY}                       an armed route without the AI-draft marker is switched on
--   noclear       {A_SWITCHED_OFF_IN_DRAFT}             a person's switch-off does not disarm the route
--   swallow       {A_ATOMIC}                            the trigger swallows a failure, so the campaign
--                                                       goes active while its routes stay off
--   nocap         {U_CAP_REFUSES}                       agent_reserve ignores the monthly cap
create function pg_temp.hub_contract_213(p_tamper text) returns jsonb
language plpgsql as $f$
declare
  r jsonb := '[]'::jsonb;
  np uuid := '00000000-0000-0000-0000-000000000001';
  snw uuid := 'b9fd8b2e-ded6-468b-ab1e-10b50ca40629';
  u1 uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); cm uuid := gen_random_uuid();
  cp uuid := gen_random_uuid(); co uuid := gen_random_uuid();
  sess uuid; run1 uuid; run2 uuid; run3 uuid; run4 uuid; tm uuid; col uuid;
  pl uuid; st0 uuid; st2 uuid; snw_st uuid; camp uuid; res jsonb; res2 jsonb; plan jsonb;
  n int; n2 int; ok boolean; def text; newdef text; v_err boolean; v_st text; v_ra boolean; v_ra0 boolean;
  kb0 int; nt0 int; ob0 int; tl0 int; tasks0 int; camps0 int;
begin
  begin
    if p_tamper <> 'none' then
      if p_tamper = 'liveforce' then
        def := pg_get_functiondef('public.agent_build(uuid)'::regprocedure);
        newdef := replace(def, 'coalesce(c -> ''goal'', ''{}''::jsonb), false, v_actor', 'coalesce(c -> ''goal'', ''{}''::jsonb), coalesce((c ->> ''live_enabled'')::boolean, false), v_actor');
      elsif p_tamper = 'activeroutes' then
        def := pg_get_functiondef('public.agent_build(uuid)'::regprocedure);
        newdef := replace(def, 'v_campaign, false, true, p_run)', 'v_campaign, true, true, p_run)');
      elsif p_tamper = 'noidem' then
        def := pg_get_functiondef('public.agent_build(uuid)'::regprocedure);
        newdef := replace(def, 'if v_run.outcome = ''built'' then return v_run.created_ids; end if;', '');
      elsif p_tamper = 'crossorg' then
        def := pg_get_functiondef('public.agent_build(uuid)'::regprocedure);
        newdef := replace(def, 'raise exception ''hub: goal stage not in org'';', 'null;');
      elsif p_tamper = 'noflag' then
        def := pg_get_functiondef('public.agent_build(uuid)'::regprocedure);
        newdef := replace(def, 'if public.hub_flag(v_org, ''agent_enabled'') <> ''on'' then raise exception ''hub: agent_disabled''; end if;', '');
      elsif p_tamper = 'kanban' then
        def := pg_get_functiondef('public.agent_build(uuid)'::regprocedure);
        newdef := replace(def, 'perform set_config(''app.is_syncing'', ''true'', true);', '');
      elsif p_tamper = 'notrigger' then
        def := pg_get_functiondef('public.hub_activate_agent_routes()'::regprocedure);
        newdef := replace(def, 'set active = true, activate_with_campaign = false', 'set active = r.active');
      elsif p_tamper = 'anytransition' then
        def := pg_get_functiondef('public.hub_activate_agent_routes()'::regprocedure);
        newdef := replace(def, 'and old.status = ''draft'' then', 'and old.status is distinct from ''active'' then');
      elsif p_tamper = 'nomarker' then
        def := pg_get_functiondef('public.hub_activate_agent_routes()'::regprocedure);
        newdef := replace(def, 'and r.activate_with_campaign and r.ai_run_id is not null;', 'and r.activate_with_campaign;');
      elsif p_tamper = 'noclear' then
        def := pg_get_functiondef('public.hub_campaign_routes_disarm()'::regprocedure);
        newdef := replace(def, 'new.activate_with_campaign := false;', 'null;');
      elsif p_tamper = 'swallow' then
        def := pg_get_functiondef('public.hub_activate_agent_routes()'::regprocedure);
        newdef := replace(replace(def,
          'if new.status = ''active'' and old.status = ''draft'' then', 'begin if new.status = ''active'' and old.status = ''draft'' then'),
          'end if;' || chr(10) || '  return null;', 'end if; exception when others then null; end;' || chr(10) || '  return null;');
      elsif p_tamper = 'nocap' then
        def := pg_get_functiondef('public.agent_reserve(uuid,text,numeric)'::regprocedure);
        newdef := replace(def, 'and u.spent_usd + u.reserved_usd + p_amount <= v_cap', '');
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
      (snw, 'crm_pipelines', '{"pipelines":[{"id":"p-snw","name":"SNW","is_default":true,"stages":[{"id":"stage-0","name":"Lead","position":0}]}]}'),
      (np, 'hub_marketing_flags', '{"engine":"on","agent_enabled":"on"}')
    on conflict (org_id, setting_key) do update set setting_value = excluded.setting_value;
    perform public.sync_pipelines_from_settings(np);
    perform public.sync_pipelines_from_settings(snw);
    select p.id into pl from public.pipelines p where p.org_id = np and p.legacy_key = 'p-sales';
    select s.id into st0 from public.pipeline_stages s where s.pipeline_id = pl and s.legacy_key = 'stage-0';
    select s.id into st2 from public.pipeline_stages s where s.pipeline_id = pl and s.legacy_key = 'stage-2';
    select s.id into snw_st from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.org_id = snw and p.legacy_key = 'p-snw';
    insert into auth.users (id, email) values (u1, 'agent-staff@test.example');
    insert into public.profiles (id, email, full_name, role) values (u1, 'agent-staff@test.example', 'Agent Staff', 'superadmin')
      on conflict (id) do nothing;
    insert into public.team_members (org_id, user_id, display_name, email) values (np, u1, 'Agent Staff', 'agent-staff@test.example') returning id into tm;
    insert into public.team_profiles (org_id, user_id, display_name, email, role, status) values (np, u1, 'Agent Staff', 'agent-staff@test.example', 'super_admin', 'active');
    -- a Project Board column exists, so the kanban trigger WOULD make a card if its guard were missing
    insert into public.kanban_columns (org_id, title, sort_order) values (np, 'To Do', 0) returning id into col;
    insert into public.contacts (id, org_id, first_name, last_name, email, phone) values (c1, np, 'Test', 'Lead', 'lead@test.example', '+18285550111');

    select count(*) into kb0 from public.kanban_tasks;  select count(*) into nt0 from public.notifications;
    select count(*) into ob0 from public.hub_sms_outbox; select count(*) into tl0 from public.contact_timeline;
    select count(*) into tasks0 from public.tasks;

    plan := jsonb_build_object(
      'campaign', jsonb_build_object('name', 'Agent test funnel', 'description', 'built by the contract', 'status', 'active', 'live_enabled', true,
                                     'entry_pipeline_id', pl, 'entry_stage_id', st0, 'goal_stage_id', st2),
      'sequence', jsonb_build_object('name', 'Agent test steps', 'steps', jsonb_build_array(
          jsonb_build_object('channel', 'email', 'kind', 'marketing', 'subject', 'Your guide', 'body', '<p>Hello.</p>', 'delay_minutes', 0),
          jsonb_build_object('channel', 'sms', 'kind', 'service', 'body', 'See you soon.', 'delay_minutes', 1440))),
      'routes', jsonb_build_array(jsonb_build_object('source_key', 'form:agent-test')),
      'forms', jsonb_build_array(jsonb_build_object('slug', 'agent-test-form', 'name', 'Agent test form', 'fields', '[]'::jsonb, 'consents', '[]'::jsonb)),
      'pages', jsonb_build_array(jsonb_build_object('slug', 'agent-test-page', 'title', 'Agent test page', 'blocks', '[]'::jsonb, 'form_slug', 'agent-test-form')),
      'tasks', jsonb_build_array(
          jsonb_build_object('title', 'Approve the email copy', 'detail', 'Read both messages.', 'kind', 'copy_review'),
          jsonb_build_object('title', 'Connect the booking source', 'kind', 'connect_source')));

    insert into public.agent_sessions (org_id, user_id, mode, surface) values (np, u1, 'builder', 'wizard') returning id into sess;
    insert into public.agent_runs (session_id, org_id, user_id, mode, prompt, model_id, plan, outcome)
      values (sess, np, u1, 'builder', 'Give away the guide, then nurture.', 'stub', plan, 'planned') returning id into run1;

    -- ── the build ──
    res := public.agent_build(run1);
    camp := (res ->> 'campaign')::uuid;
    r := r || jsonb_build_object('id', 'B_BUILT', 'ok', camp is not null and (select outcome from public.agent_runs where id = run1) = 'built', 'got', res);
    r := r || jsonb_build_object('id', 'B_DRAFT_ONLY', 'ok',
            (select status = 'draft' and not live_enabled and ai_run_id = run1 from public.funnel_campaigns where id = camp),
            'got', (select jsonb_build_object('status', status, 'live', live_enabled) from public.funnel_campaigns where id = camp));
    r := r || jsonb_build_object('id', 'B_ROUTES_INACTIVE', 'ok',
            (select count(*) = 1 and bool_and(not active and activate_with_campaign and ai_run_id = run1) from public.campaign_routes where campaign_id = camp),
            'got', (select jsonb_agg(jsonb_build_object('active', active, 'arm', activate_with_campaign)) from public.campaign_routes where campaign_id = camp));
    r := r || jsonb_build_object('id', 'B_STEPS', 'ok',
            (select count(*) = 2 from public.sequence_steps st where st.sequence_id = (res ->> 'sequence')::uuid and st.ai_run_id = run1)
            and (select sequence_id from public.funnel_campaigns where id = camp) = (res ->> 'sequence')::uuid, 'got', res -> 'steps');
    r := r || jsonb_build_object('id', 'B_FORM_PAGE_DRAFTS', 'ok',
            (select f.status = 'draft' from public.form_definitions f where f.slug = 'agent-test-form')
            and (select p.status = 'draft' and p.form_definition_id = (select f.id from public.form_definitions f where f.slug = 'agent-test-form')
                   from public.page_definitions p where p.slug = 'agent-test-page'), 'got', null);

    -- ── Client Tasks: labelled, linked, no contact, assigned to the runner, notifies nobody ──
    r := r || jsonb_build_object('id', 'T_CLIENT_TASK', 'ok',
            (select count(*) = 2 and bool_and(t.source = 'campaign_builder' and t.source_id = camp and t.contact_id is null
                       and t.assigned_to = tm and t.status = 'todo' and t.title like 'Campaign Builder: %'
                       and t.description like '%/campaigns?tab=funnels&funnel=' || camp || '%')
               from public.tasks t where t.source = 'campaign_builder')
            and (select count(*) = 2 and bool_and(ct.client_task_id is not null and ct.assignee_id = tm) from public.campaign_tasks ct where ct.run_id = run1),
            'got', (select jsonb_agg(jsonb_build_object('title', t.title, 'assigned', t.assigned_to)) from public.tasks t where t.source = 'campaign_builder'));
    select count(*) - kb0 into n from public.kanban_tasks;
    r := r || jsonb_build_object('id', 'T_NO_BOARD_CARD', 'ok', n = 0, 'got', n);
    r := r || jsonb_build_object('id', 'T_NO_NOTIFY', 'ok',
            (select count(*) from public.notifications) = nt0 and (select count(*) from public.hub_sms_outbox) = ob0
            and (select count(*) from public.contact_timeline) = tl0,
            'got', jsonb_build_array((select count(*) from public.notifications) - nt0, (select count(*) from public.hub_sms_outbox) - ob0,
                                     (select count(*) from public.contact_timeline) - tl0));
    update public.tasks set status = 'done' where source = 'campaign_builder';
    r := r || jsonb_build_object('id', 'T_ONE_WAY', 'ok', (select bool_and(status = 'open') from public.campaign_tasks where run_id = run1), 'got', null);

    -- ── replay ──
    begin
      res2 := public.agent_build(run1);
      r := r || jsonb_build_object('id', 'B_REPLAY_SAME', 'ok', res2 = res
              and (select count(*) from public.funnel_campaigns where ai_run_id = run1) = 1
              and (select count(*) from public.tasks where source = 'campaign_builder') = 2, 'got', res2);
    exception when others then
      r := r || jsonb_build_object('id', 'B_REPLAY_SAME', 'ok', false, 'got', sqlerrm);
    end;

    -- ── a failure part way through leaves nothing (the last task has a bad kind) ──
    insert into public.agent_runs (session_id, org_id, user_id, mode, prompt, model_id, plan, outcome)
      values (sess, np, u1, 'builder', 'atomic', 'stub',
              jsonb_set(jsonb_set(plan, '{forms}', '[]'::jsonb), '{pages}', '[]'::jsonb)
                || jsonb_build_object('tasks', jsonb_build_array(jsonb_build_object('title', 'fine', 'kind', 'other'),
                                                               jsonb_build_object('title', 'bad', 'kind', 'not_a_kind'))),
              'planned') returning id into run2;
    select count(*) into camps0 from public.funnel_campaigns;
    select count(*) into n2 from public.tasks;
    begin
      perform public.agent_build(run2);
      v_err := false;
    exception when check_violation then
      v_err := true;
    end;
    r := r || jsonb_build_object('id', 'B_ATOMIC_FAIL', 'ok', v_err
            and (select count(*) from public.funnel_campaigns) = camps0 and (select count(*) from public.tasks) = n2
            and (select count(*) from public.campaign_routes where ai_run_id = run2) = 0
            and (select outcome from public.agent_runs where id = run2) = 'planned', 'got', v_err);

    -- ── the goal stage must be in the run's org ──
    insert into public.agent_runs (session_id, org_id, user_id, mode, prompt, model_id, plan, outcome)
      values (sess, np, u1, 'builder', 'cross org', 'stub',
              jsonb_build_object('campaign', jsonb_build_object('name', 'Cross', 'entry_pipeline_id', pl, 'entry_stage_id', st0, 'goal_stage_id', snw_st)),
              'planned') returning id into run3;
    begin
      perform public.agent_build(run3);
      r := r || jsonb_build_object('id', 'B_CROSS_ORG', 'ok', false, 'got', 'built');
    exception when others then
      r := r || jsonb_build_object('id', 'B_CROSS_ORG', 'ok', sqlerrm like '%goal stage not in org%', 'got', sqlerrm);
    end;

    -- ── the agent_enabled flag ──
    insert into public.agent_runs (session_id, org_id, user_id, mode, prompt, model_id, plan, outcome)
      values (sess, np, u1, 'builder', 'flag', 'stub', jsonb_build_object('tasks', jsonb_build_array(jsonb_build_object('title', 'x', 'kind', 'other'))), 'planned')
      returning id into run4;
    update public.org_settings set setting_value = '{"engine":"on","agent_enabled":"off"}' where org_id = np and setting_key = 'hub_marketing_flags';
    begin
      perform public.agent_build(run4);
      r := r || jsonb_build_object('id', 'B_FLAG_OFF', 'ok', false, 'got', 'built');
    exception when others then
      r := r || jsonb_build_object('id', 'B_FLAG_OFF', 'ok', sqlerrm like '%agent_disabled%', 'got', sqlerrm);
    end;
    update public.org_settings set setting_value = '{"engine":"on","agent_enabled":"on"}' where org_id = np and setting_key = 'hub_marketing_flags';

    -- ── a draft with inactive routes raises nothing and enrolls nobody, with the engine ON ──
    ok := public.raise_entry_event(np, c1, 'form:agent-test', 'agent:ev1', 'call');
    perform public.route_and_enroll(np, c1, 'form:agent-test', 'agent:ev2');
    select count(*) into n from public.entry_events where source_key = 'form:agent-test';
    select count(*) into n2 from public.campaign_enrollments where campaign_id = camp;
    r := r || jsonb_build_object('id', 'A_DRAFT_NO_EVENT', 'ok', not ok and n = 0 and n2 = 0, 'got', jsonb_build_array(ok, n, n2));

    -- ── activation is atomic: a failure in the route update leaves the campaign a draft and its
    --    routes exactly as they were (compared with their state before, not with "off") ──
    select bool_or(active) into v_ra0 from public.campaign_routes where campaign_id = camp;
    begin
      -- created inside this block and rolled back with it
      execute 'create function public.hub_test_fail_route() returns trigger language plpgsql as $x$ begin raise exception ''planted route failure''; end $x$';
      execute 'create trigger hub_test_fail_route before update on public.campaign_routes for each row execute function public.hub_test_fail_route()';
      begin
        update public.funnel_campaigns set status = 'active', updated_at = now() where id = camp;
        v_err := false;
      exception when others then
        v_err := true;
      end;
      select status into v_st from public.funnel_campaigns where id = camp;
      select bool_or(active) into v_ra from public.campaign_routes where campaign_id = camp;
      raise exception 'A_ATOMIC_ROLLBACK';
    exception when others then
      if sqlerrm <> 'A_ATOMIC_ROLLBACK' then
        r := r || jsonb_build_object('id', 'CRASH_A_ATOMIC', 'ok', false, 'got', sqlstate || ' ' || sqlerrm);
      end if;
    end;
    r := r || jsonb_build_object('id', 'A_ATOMIC', 'ok', v_err and v_st = 'draft' and v_ra is not distinct from v_ra0, 'got', jsonb_build_array(v_err, v_st, v_ra0, v_ra));

    -- ── activation through the SAME statement the existing route issues ──
    insert into public.funnel_campaigns (id, org_id, name, status) values (cm, np, 'Manual funnel', 'draft');
    insert into public.campaign_routes (org_id, source_key, campaign_id, active) values (np, 'form:manual-off', cm, false), (np, 'form:manual-on', cm, true);
    update public.funnel_campaigns set status = 'active', updated_at = now() where id = camp;
    r := r || jsonb_build_object('id', 'A_ACTIVATE_ON', 'ok',
            (select bool_and(active) from public.campaign_routes where campaign_id = camp),
            'got', (select jsonb_agg(jsonb_build_object('active', active, 'arm', activate_with_campaign)) from public.campaign_routes where campaign_id = camp));
    ok := public.raise_entry_event(np, c1, 'form:agent-test', 'agent:ev3', 'call');
    r := r || jsonb_build_object('id', 'A_ACTIVE_RAISES', 'ok', ok, 'got', ok);   -- the positive control for A_DRAFT_NO_EVENT
    update public.funnel_campaigns set status = 'active' where id = cm;
    r := r || jsonb_build_object('id', 'A_NONAGENT_UNTOUCHED', 'ok',
            (select not active from public.campaign_routes where source_key = 'form:manual-off')
            and (select active from public.campaign_routes where source_key = 'form:manual-on'), 'got', null);
    -- ruling 2026-10-01, three cases. (1) only draft to active fires: an agent campaign that
    -- goes draft, paused, active keeps its armed routes off
    insert into public.funnel_campaigns (id, org_id, name, status, ai_run_id) values (cp, np, 'Paused first', 'draft', run1);
    insert into public.campaign_routes (org_id, source_key, campaign_id, active, activate_with_campaign, ai_run_id)
      values (np, 'form:paused-first', cp, false, true, run1);
    update public.funnel_campaigns set status = 'paused' where id = cp;
    update public.funnel_campaigns set status = 'active' where id = cp;
    r := r || jsonb_build_object('id', 'A_DRAFT_ONLY_TRANSITION', 'ok', (select not active from public.campaign_routes where source_key = 'form:paused-first'), 'got', null);
    -- (2) only routes carrying the AI-draft marker: an armed route with no marker stays off
    insert into public.funnel_campaigns (id, org_id, name, status) values (co, np, 'Marker check', 'draft');
    insert into public.campaign_routes (org_id, source_key, campaign_id, active, activate_with_campaign, ai_run_id)
      values (np, 'form:no-marker', co, false, true, null), (np, 'form:with-marker', co, false, true, run1),
             (np, 'form:switched-off', co, false, true, run1);
    -- (3) a person switches an agent route on and then off while the campaign is still a draft
    update public.campaign_routes set active = true where source_key = 'form:switched-off';
    update public.campaign_routes set active = false where source_key = 'form:switched-off';
    update public.funnel_campaigns set status = 'active' where id = co;
    r := r || jsonb_build_object('id', 'A_MARKER_ONLY', 'ok',
            (select not active from public.campaign_routes where source_key = 'form:no-marker')
            and (select active from public.campaign_routes where source_key = 'form:with-marker'), 'got', null);
    r := r || jsonb_build_object('id', 'A_SWITCHED_OFF_IN_DRAFT', 'ok', (select not active from public.campaign_routes where source_key = 'form:switched-off'), 'got', null);

    -- a person switches the agent route off, then pauses and resumes the campaign
    update public.campaign_routes set active = false where campaign_id = camp;
    update public.funnel_campaigns set status = 'paused' where id = camp;
    update public.funnel_campaigns set status = 'active' where id = camp;
    r := r || jsonb_build_object('id', 'A_RESUME_KEEPS_OFF', 'ok', (select bool_and(not active) from public.campaign_routes where campaign_id = camp), 'got', null);

    -- ── usage: the cap is read from org_settings and enforced in one UPDATE ──
    insert into public.org_settings (org_id, setting_key, setting_value) values (np, 'hub_agent_policy', '{"monthly_cap_usd": 1}')
      on conflict (org_id, setting_key) do update set setting_value = excluded.setting_value;
    res := public.agent_reserve(np, 'builder', 0.6);
    res2 := public.agent_reserve(np, 'builder', 0.6);
    r := r || jsonb_build_object('id', 'U_CAP_REFUSES', 'ok', (res ->> 'ok')::boolean and not (res2 ->> 'ok')::boolean, 'got', jsonb_build_array(res, res2));
    res2 := public.agent_reserve(np, 'guide', 0.6);
    r := r || jsonb_build_object('id', 'U_GUIDE_SEPARATE', 'ok', (res2 ->> 'ok')::boolean and (res2 ->> 'cap_usd')::numeric = 10, 'got', res2);
    select jsonb_build_object('r', reserved_usd, 's', spent_usd) into res2 from public.agent_usage where org_id = np and mode = 'builder';
    perform public.agent_settle(np, res ->> 'month', 'builder', 0.6, 0.2);
    r := r || jsonb_build_object('id', 'U_SETTLE', 'ok',
            (select reserved_usd = (res2 ->> 'r')::numeric - 0.6 and spent_usd = (res2 ->> 's')::numeric + 0.2
               from public.agent_usage where org_id = np and mode = 'builder'), 'got', res2);

    -- ── the control for T_NO_BOARD_CARD: an ordinary Client Task DOES get a board card here ──
    insert into public.tasks (org_id, title, status, priority) values (np, 'Ordinary task', 'todo', 'medium');
    select count(*) - kb0 into n from public.kanban_tasks;
    r := r || jsonb_build_object('id', 'C_BOARD_TRIGGER_LIVE', 'ok', n >= 1, 'got', n);

    -- ── a browser session: reads its org's campaign tasks and pages, nothing else, writes nothing ──
    perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := r || jsonb_build_object('id', 'R_IDENTITY', 'ok', current_user = 'authenticated' and auth.uid() = u1, 'got', current_user);
    r := r || jsonb_build_object('id', 'R_READS_TASKS', 'ok', (select count(*) from public.campaign_tasks where run_id = run1) = 2, 'got', null);
    begin
      perform 1 from public.agent_runs limit 1;
      r := r || jsonb_build_object('id', 'R_RUNS_CLOSED', 'ok', false, 'got', 'readable');
    exception when insufficient_privilege then
      r := r || jsonb_build_object('id', 'R_RUNS_CLOSED', 'ok', true, 'got', '42501');
    end;
    begin
      perform 1 from public.help_gaps limit 1;
      r := r || jsonb_build_object('id', 'R_GAPS_CLOSED', 'ok', false, 'got', 'readable');
    exception when insufficient_privilege then
      r := r || jsonb_build_object('id', 'R_GAPS_CLOSED', 'ok', true, 'got', '42501');
    end;
    begin
      insert into public.campaign_tasks (org_id, title, kind) values (np, 'forged', 'other');
      r := r || jsonb_build_object('id', 'R_NO_BROWSER_WRITE', 'ok', false, 'got', 'accepted');
    exception when insufficient_privilege then
      r := r || jsonb_build_object('id', 'R_NO_BROWSER_WRITE', 'ok', true, 'got', '42501');
    end;
    begin
      perform public.agent_build(run1);
      r := r || jsonb_build_object('id', 'R_NO_BROWSER_BUILD', 'ok', false, 'got', 'executed');
    exception when insufficient_privilege then
      r := r || jsonb_build_object('id', 'R_NO_BROWSER_BUILD', 'ok', true, 'got', '42501');
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
  select s.sel, s.want, pg_temp.hub_contract_213(s.sel) as res
  from (values ('none', '{}'::text[]),
               ('liveforce', '{B_DRAFT_ONLY}'),
               ('activeroutes', '{A_DRAFT_NO_EVENT,B_ROUTES_INACTIVE}'),
               ('noidem', '{B_REPLAY_SAME}'),
               ('crossorg', '{B_CROSS_ORG}'),
               ('noflag', '{B_FLAG_OFF}'),
               ('kanban', '{T_NO_BOARD_CARD}'),
               ('notrigger', '{A_ACTIVATE_ON,A_ACTIVE_RAISES,A_MARKER_ONLY}'),
               ('anytransition', '{A_DRAFT_ONLY_TRANSITION}'),
               ('nomarker', '{A_MARKER_ONLY}'),
               ('noclear', '{A_SWITCHED_OFF_IN_DRAFT}'),
               ('swallow', '{A_ATOMIC}'),
               ('nocap', '{U_CAP_REFUSES}')) as s(sel, want)
), red as (
  select sel, want, jsonb_array_length(res) as cases,
         coalesce((select array_agg(e ->> 'id' order by e ->> 'id') from jsonb_array_elements(res) e where not coalesce((e ->> 'ok')::boolean, false)), '{}') as got,
         res
  from runs
)
select sel, cases, got as red, want as declared, got = want as verdict_ok,
       case when sel = 'none' or got <> want then (select jsonb_agg(e) from jsonb_array_elements(res) e where not coalesce((e ->> 'ok')::boolean, false)) end as failures
from red order by sel = 'none' desc, sel;
