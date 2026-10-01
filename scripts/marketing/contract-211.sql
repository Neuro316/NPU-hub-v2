-- Contract tests for hub_211. REQUIRES_LIVE = 'database' (a Supabase BRANCH, never the live project).
--
-- Runs the REAL functions from hub_211 against fixtures created inside a
-- subtransaction that is always rolled back, so a run leaves nothing behind.
-- Each selector plants one defect into the real function text (create or replace,
-- also rolled back) and the run must redden EXACTLY the declared set. `none` must
-- be all green. Output: one row per selector with its red set and the verdict.
--
-- Selectors and the red set each must produce (declared from intent, not a run):
--   none        {}
--   quiet       {G_QUIET_2000}          quiet-hours end boundary made inclusive
--   cap         {G_CAP_AT_LIMIT}        frequency cap compared with > instead of >=
--   dupactive   {E_ACTIVE_NO_2ND_SEQ, M_GOAL_ENDS_DRIP}  enroll no longer checks for an active
--               enrollment, so a second drip starts and the goal then ends two enrollments
--   revokeorder {C_STOP_SUPPRESSES, C_UNSUB_KEEPS_SERVICE, G_REVOKED_MID}  consent read takes
--               the OLDEST event, so every revoke that followed a grant is ignored
--   merge       {E_MERGED_TO_SURVIVOR, E_MERGED_DUP}   enroll stops resolving merges
create function pg_temp.hub_contract(p_tamper text) returns jsonb
language plpgsql as $f$
declare
  r jsonb := '[]'::jsonb;
  np uuid := '00000000-0000-0000-0000-000000000001';
  snw uuid := 'b9fd8b2e-ded6-468b-ab1e-10b50ca40629';
  c1 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); c4 uuid := gen_random_uuid();
  cx uuid := gen_random_uuid(); cs uuid := gen_random_uuid();
  seq uuid := gen_random_uuid(); f1 uuid := gen_random_uuid(); fx uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); asset uuid := gen_random_uuid();
  st0 uuid; st1 uuid; stwon uuid; res jsonb; n int; t text; def text; newdef text;
  day timestamptz := '2026-10-06 16:00:00+00';   -- noon in New York (EDT, UTC-4)
begin
  begin
    -- ── tamper: rewrite the real function text, rolled back with everything else ──
    if p_tamper <> 'none' then
      if p_tamper = 'quiet' then
        def := pg_get_functiondef('public.gate_check(uuid,text,text,uuid,timestamptz)'::regprocedure);
        newdef := replace(def, 'v_local::time < v_end', 'v_local::time <= v_end');
      elsif p_tamper = 'cap' then
        def := pg_get_functiondef('public.gate_check(uuid,text,text,uuid,timestamptz)'::regprocedure);
        newdef := replace(def, 'if v_n >= (pol', 'if v_n > (pol');
      elsif p_tamper = 'dupactive' then
        def := pg_get_functiondef('public.enroll(uuid,uuid,text,text)'::regprocedure);
        newdef := replace(def, 'and ce.status = ''active'' limit 1;', 'and false limit 1;');
      elsif p_tamper = 'revokeorder' then
        def := pg_get_functiondef('public.consent_state(uuid,text,text)'::regprocedure);
        newdef := regexp_replace(def, 'order by ce\.occurred_at desc, ce\.seq desc limit 1;\s*if found then',
                                      'order by ce.occurred_at asc, ce.seq asc limit 1; if found then');
      elsif p_tamper = 'merge' then
        def := pg_get_functiondef('public.enroll(uuid,uuid,text,text)'::regprocedure);
        newdef := replace(def, 'v_id := public.hub_resolve_contact(p_contact);', 'v_id := p_contact;');
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
         {"id":"stage-0","name":"New Lead","position":0},{"id":"stage-1","name":"Booked","position":1},{"name":"Won"}]}]}'),
      (np, 'hub_marketing_flags', '{"engine":"off"}')
    on conflict (org_id, setting_key) do update set setting_value = excluded.setting_value;
    perform public.sync_pipelines_from_settings(np);
    select s.id into st0 from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
      where p.org_id = np and p.legacy_key = 'p-sales' and s.legacy_key = 'stage-0';
    select s.id into st1 from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
      where p.org_id = np and p.legacy_key = 'p-sales' and s.legacy_key = 'stage-1';
    select s.id into stwon from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
      where p.org_id = np and p.legacy_key = 'p-sales' and s.legacy_key = 'name:Won';

    insert into public.contacts (id, org_id, first_name, last_name, email, phone, timezone, pipeline_id, pipeline_stage) values
      (c1, np, 'Test', 'One', 'one@test.example', '+18285550101', 'America/New_York', 'p-sales', 'New Lead'),
      (c3, np, 'Test', 'Survivor', 'three@test.example', '+18285550103', 'America/New_York', null, null),
      (cx, np, 'Test', 'Flagged', 'dnc@test.example', '+18285550109', 'America/New_York', null, null),
      (cs, snw, 'Test', 'Other org', 'snw@test.example', null, null, null, null);
    insert into public.contacts (id, org_id, first_name, last_name, email, merged_into_id)
      values (c4, np, 'Test', 'Merged', 'four@test.example', c3);
    update public.contacts set do_not_contact = true where id = cx;
    insert into public.sequences (id, org_id, name) values (seq, np, 'Test drip');
    insert into public.sequence_steps (sequence_id, step_order, channel, delay_minutes, subject, body, kind)
      values (seq, 0, 'email', 0, 'Hello', 'Body', 'marketing');
    insert into public.funnel_campaigns (id, org_id, name, status, entry_pipeline_id, entry_stage_id, goal_stage_id, sequence_id)
      select f1, np, 'Test funnel', 'active', s.pipeline_id, st0, stwon, seq from public.pipeline_stages s where s.id = st0;
    insert into public.funnel_campaigns (id, org_id, name, status) values (fx, snw, 'Other org funnel', 'active');
    insert into public.campaign_routes (org_id, source_key, campaign_id) values (np, 'form:webinar', f1);

    -- ── enroll ──
    res := public.enroll(c1, f1, 'form:webinar', 'evt-1');
    r := r || jsonb_build_object('id', 'E_FLAG_OFF_NOOP', 'ok', res ->> 'reason' = 'engine_off'
            and not exists (select 1 from public.campaign_enrollments where contact_id = c1), 'got', res);
    update public.org_settings set setting_value = '{"engine":"on"}' where org_id = np and setting_key = 'hub_marketing_flags';

    res := public.enroll(c1, f1, 'form:webinar', 'evt-1');
    r := r || jsonb_build_object('id', 'E_ENROLLS', 'ok', (res ->> 'enrolled')::boolean
            and exists (select 1 from public.contact_pipeline_positions where contact_id = c1 and stage_id = st0)
            and (select count(*) from public.sequence_enrollments where contact_id = c1 and status = 'active') = 1
            and exists (select 1 from public.contact_timeline where contact_id = c1 and event_type = 'campaign_enrolled'), 'got', res);

    res := public.enroll(c1, f1, 'form:webinar', 'evt-1');
    r := r || jsonb_build_object('id', 'E_DUP_EVENT', 'ok', res ->> 'reason' = 'duplicate_event'
            and (select count(*) from public.campaign_enrollments where contact_id = c1) = 1, 'got', res);

    res := public.enroll(c1, f1, 'call:inbound', 'evt-2');
    r := r || jsonb_build_object('id', 'E_ACTIVE_NO_2ND_SEQ', 'ok', res ->> 'reason' = 'already_active'
            and (select count(*) from public.sequence_enrollments where contact_id = c1) = 1, 'got', res);

    begin
      perform public.enroll(c1, fx, 'form:webinar', 'evt-x');
      r := r || jsonb_build_object('id', 'E_CROSS_ORG_REFUSED', 'ok', false, 'got', 'accepted');
    exception when insufficient_privilege then
      r := r || jsonb_build_object('id', 'E_CROSS_ORG_REFUSED', 'ok', true, 'got', '42501');
    end;

    res := public.enroll(c4, f1, 'form:webinar', 'evt-m');
    r := r || jsonb_build_object('id', 'E_MERGED_TO_SURVIVOR', 'ok', res ->> 'contact_id' = c3::text
            and not exists (select 1 from public.campaign_enrollments where contact_id = c4), 'got', res);
    res := public.enroll(c3, f1, 'form:webinar', 'evt-m');
    r := r || jsonb_build_object('id', 'E_MERGED_DUP', 'ok', res ->> 'reason' = 'duplicate_event', 'got', res);

    res := public.route_and_enroll(np, c3, 'form:webinar', 'evt-r');
    r := r || jsonb_build_object('id', 'E_ROUTE', 'ok', jsonb_array_length(res) = 1, 'got', res);

    -- ── move_stage ──
    res := public.move_stage(c1, st1, null, 'test');
    r := r || jsonb_build_object('id', 'M_MOVES_NO_MIRROR', 'ok', (res ->> 'moved')::boolean
            and (select stage_id from public.contact_pipeline_positions where contact_id = c1) = st1
            and (select pipeline_stage from public.contacts where id = c1) = 'New Lead', 'got', res);
    update public.org_settings set setting_value = setting_value || '{"mirror_legacy_stage":"on"}'
      where org_id = np and setting_key = 'hub_marketing_flags';
    res := public.move_stage(c1, stwon, null, 'test');
    r := r || jsonb_build_object('id', 'M_GOAL_ENDS_DRIP', 'ok', (res ->> 'goals_met')::int = 1
            and (select pipeline_stage from public.contacts where id = c1) = 'Won'
            and not exists (select 1 from public.sequence_enrollments where contact_id = c1 and status = 'active'), 'got', res);

    update public.org_settings set setting_value = jsonb_set(setting_value, '{pipelines,0,stages,1,name}', '"Call booked"')
      where org_id = np and setting_key = 'crm_pipelines';
    perform public.sync_pipelines_from_settings(np);
    r := r || jsonb_build_object('id', 'M_RENAME_KEEPS_ID', 'ok',
            (select name from public.pipeline_stages where id = st1) = 'Call booked'
            and (select count(*) from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
                  where p.org_id = np and p.legacy_key = 'p-sales') = 3, 'got', (select name from public.pipeline_stages where id = st1));
    update public.org_settings set setting_value = jsonb_set(setting_value, '{pipelines,0,stages}',
             (setting_value #> '{pipelines,0,stages}') - 0) where org_id = np and setting_key = 'crm_pipelines';
    perform public.sync_pipelines_from_settings(np);
    r := r || jsonb_build_object('id', 'M_REMOVED_ARCHIVED', 'ok',
            (select archived_at is not null from public.pipeline_stages where id = st0), 'got', null);

    -- ── record_consent and the ledger ──
    begin
      perform public.record_consent(c3, 'email', 'marketing', 'granted', 'express_consent', 'form:x', null);
      r := r || jsonb_build_object('id', 'C_GRANT_NEEDS_TEXT', 'ok', false, 'got', 'accepted');
    exception when check_violation then
      r := r || jsonb_build_object('id', 'C_GRANT_NEEDS_TEXT', 'ok', true, 'got', '23514');
    end;
    perform public.record_consent(c3, 'email', 'marketing', 'granted', 'express_consent', 'form:x', 'Yes, email me news.');
    begin
      update public.consent_events set source = 'forged' where contact_id = c3;
      r := r || jsonb_build_object('id', 'C_APPEND_ONLY_UPDATE', 'ok', false, 'got', 'accepted');
    exception when insufficient_privilege then
      r := r || jsonb_build_object('id', 'C_APPEND_ONLY_UPDATE', 'ok', true, 'got', '42501');
    end;
    begin
      delete from public.consent_events where contact_id = c3;
      r := r || jsonb_build_object('id', 'C_APPEND_ONLY_DELETE', 'ok', false, 'got', 'accepted');
    exception when insufficient_privilege then
      r := r || jsonb_build_object('id', 'C_APPEND_ONLY_DELETE', 'ok', true, 'got', '42501');
    end;

    perform public.record_consent(c3, 'sms', 'all', 'granted', 'express_consent', 'form:x', 'Yes, text me.');
    n := public.record_consent(c3, 'sms', 'all', 'revoked', 'stop', 'sms_stop', null);
    r := r || jsonb_build_object('id', 'C_STOP_SUPPRESSES', 'ok', n = 2
            and exists (select 1 from public.suppressions where address = '+18285550103' and scope = 'all' and lifted_at is null)
            and not (public.consent_state(c3, 'sms', 'service') ->> 'allowed')::boolean, 'got', n);
    perform public.record_consent(c3, 'sms', 'marketing', 'granted', 'express_consent', 'sms_start', 'START');
    r := r || jsonb_build_object('id', 'C_REGRANT_AFTER_STOP', 'ok',
            (public.consent_state(c3, 'sms', 'marketing') ->> 'allowed')::boolean
            and not exists (select 1 from public.suppressions where address = '+18285550103' and lifted_at is null), 'got',
            public.consent_state(c3, 'sms', 'marketing'));

    perform public.record_consent(c1, 'email', 'service', 'granted', 'transactional', 'booking', 'We will email your booking confirmation.');
    perform public.record_consent(c1, 'email', 'marketing', 'granted', 'express_consent', 'form:x', 'Yes, email me news.');
    perform public.record_consent(c1, 'email', 'marketing', 'revoked', 'unsubscribe', 'unsubscribe_link', null);
    r := r || jsonb_build_object('id', 'C_UNSUB_KEEPS_SERVICE', 'ok',
            not (public.consent_state(c1, 'email', 'marketing') ->> 'allowed')::boolean
            and (select scope from public.suppressions where address = 'one@test.example' and lifted_at is null) = 'marketing'
            and (public.consent_state(c1, 'email', 'service') ->> 'allowed') = 'true', 'got', public.consent_state(c1, 'email', 'service'));

    -- ── gate ──
    -- c3 has email marketing consent (granted above), timezone New York, no sends yet
    res := public.gate_check(c3, 'email', 'marketing', f1, day);
    r := r || jsonb_build_object('id', 'G_ALLOW_DRY', 'ok', res ->> 'decision' = 'allow' and res ->> 'mode' = 'dry_run'
            and exists (select 1 from public.send_log where contact_id = c3 and decision = 'allow'), 'got', res);
    res := public.gate_check(c3, 'email', 'service', f1, day);
    r := r || jsonb_build_object('id', 'G_SERVICE_BY_MARKETING', 'ok', res ->> 'decision' = 'allow', 'got', res);
    res := public.gate_check(cx, 'email', 'marketing', f1, day);
    r := r || jsonb_build_object('id', 'G_NO_CONSENT', 'ok', res ->> 'step' = 'consent', 'got', res);
    perform public.record_consent(cx, 'email', 'marketing', 'granted', 'express_consent', 'form:x', 'Yes.');
    res := public.gate_check(cx, 'email', 'marketing', f1, day);
    r := r || jsonb_build_object('id', 'G_DNC_FLAG', 'ok', res ->> 'reason' = 'do_not_contact_flag', 'got', res);
    update public.contacts set do_not_contact = false where id = cx;
    insert into public.do_not_contact_list (org_id, email, reason) values (np, 'dnc@test.example', 'test');
    res := public.gate_check(cx, 'email', 'marketing', f1, day);
    r := r || jsonb_build_object('id', 'G_DNC_LIST', 'ok', res ->> 'reason' = 'do_not_contact_list', 'got', res);

    res := public.gate_check(c3, 'email', 'marketing', f1, '2026-10-06 11:59:59+00');
    r := r || jsonb_build_object('id', 'G_QUIET_0759', 'ok', res ->> 'decision' = 'defer'
            and (res ->> 'retry_at')::timestamptz = '2026-10-06 12:00:00+00', 'got', res);
    res := public.gate_check(c3, 'email', 'marketing', f1, '2026-10-06 12:00:00+00');
    r := r || jsonb_build_object('id', 'G_QUIET_0800', 'ok', res ->> 'decision' = 'allow', 'got', res);
    res := public.gate_check(c3, 'email', 'marketing', f1, '2026-10-06 23:59:59+00');
    r := r || jsonb_build_object('id', 'G_QUIET_1959', 'ok', res ->> 'decision' = 'allow', 'got', res);
    res := public.gate_check(c3, 'email', 'marketing', f1, '2026-10-07 00:00:00+00');
    r := r || jsonb_build_object('id', 'G_QUIET_2000', 'ok', res ->> 'decision' = 'defer'
            and (res ->> 'retry_at')::timestamptz = '2026-10-07 12:00:00+00', 'got', res);

    insert into public.message_sends (org_id, contact_id, channel, kind, source_kind, dedupe_key, to_address, status, dry_run, claimed_at)
    values (np, c3, 'email', 'marketing', 'campaign', 'old-edge', 'three@test.example', 'sent', false, day - interval '7 days'),
           (np, c3, 'email', 'marketing', 'campaign', 'd1', 'three@test.example', 'sent', false, day - interval '1 day'),
           (np, c4, 'sms',   'marketing', 'campaign', 'd2', '+18285550104', 'sent', false, day - interval '2 days');
    res := public.gate_check(c3, 'email', 'marketing', f1, day);
    r := r || jsonb_build_object('id', 'G_CAP_BELOW_LIMIT', 'ok', res ->> 'decision' = 'allow', 'got', res);
    insert into public.message_sends (org_id, contact_id, channel, kind, source_kind, dedupe_key, to_address, status, dry_run, claimed_at)
    values (np, c3, 'email', 'marketing', 'campaign', 'd3', 'three@test.example', 'sent', false, day - interval '3 days');
    res := public.gate_check(c3, 'email', 'marketing', f1, day);
    r := r || jsonb_build_object('id', 'G_CAP_AT_LIMIT', 'ok', res ->> 'step' = 'frequency_cap' and (res ->> 'count')::int = 3, 'got', res);
    res := public.gate_check(c3, 'email', 'service', f1, day);
    r := r || jsonb_build_object('id', 'G_CAP_IGNORES_SERVICE', 'ok', res ->> 'decision' = 'allow', 'got', res);

    -- revoked consent mid-sequence: allowed before, refused after, same contact, same step
    perform public.record_consent(c1, 'email', 'marketing', 'granted', 'express_consent', 'form:y', 'Yes, email me news.');
    res := public.gate_check(c1, 'email', 'marketing', f1, day);
    t := res ->> 'decision';
    perform public.record_consent(c1, 'email', 'marketing', 'revoked', 'unsubscribe', 'unsubscribe_link', null);
    res := public.gate_check(c1, 'email', 'marketing', f1, day);
    r := r || jsonb_build_object('id', 'G_REVOKED_MID', 'ok', t = 'allow' and res ->> 'step' = 'consent', 'got', res);

    -- live mode: only with the flag AND (allowlisted OR campaign switched live)
    update public.org_settings set setting_value = setting_value || '{"gate_live_sends":"on"}'
      where org_id = np and setting_key = 'hub_marketing_flags';
    res := public.gate_check(c3, 'email', 'service', f1, day);
    r := r || jsonb_build_object('id', 'G_LIVE_NEEDS_ALLOWLIST', 'ok', res ->> 'mode' = 'dry_run', 'got', res);
    insert into public.campaign_test_contacts (org_id, email, label) values (np, 'three@test.example', 'test');
    res := public.gate_check(c3, 'email', 'service', f1, day);
    r := r || jsonb_build_object('id', 'G_LIVE_ALLOWLISTED', 'ok', res ->> 'mode' = 'live', 'got', res);
    delete from public.campaign_test_contacts where org_id = np and email = 'three@test.example';
    update public.funnel_campaigns set live_enabled = true where id = f1;
    res := public.gate_check(c3, 'email', 'service', f1, day);
    r := r || jsonb_build_object('id', 'G_LIVE_CAMPAIGN_SWITCH', 'ok', res ->> 'mode' = 'live', 'got', res);

    -- claim-then-send
    res := to_jsonb(public.claim_send(c3, 'email', 'service', 'k1', 'campaign', f1::text, 's0', 'live', 'three@test.example', 's', 'b', null, '{}'));
    r := r || jsonb_build_object('id', 'S_CLAIM_ONCE', 'ok', res <> 'null'::jsonb
            and public.claim_send(c3, 'email', 'service', 'k1', 'campaign', f1::text, 's0', 'live', 'three@test.example', 's', 'b', null, '{}') is null,
            'got', res);
    r := r || jsonb_build_object('id', 'S_DRY_SEPARATE', 'ok',
            public.claim_send(c3, 'email', 'service', 'k1', 'campaign', f1::text, 's0', 'dry_run', 'three@test.example', 's', 'b', null, '{}') is not null
            and public.claim_send(c3, 'email', 'service', 'k1', 'campaign', f1::text, 's0', 'dry_run', 'three@test.example', 's', 'b', null, '{}') is null,
            'got', null);

    -- ── asset grants ──
    insert into public.university_assets (id, org_id, title, path) values (asset, np, 'Free guide', '/signup?asset=guide');
    r := r || jsonb_build_object('id', 'A_FLAG_OFF_NULL', 'ok',
            public.grant_asset(c3, asset, decode(md5('t0'), 'hex'), interval '7 days') is null, 'got', null);
    update public.org_settings set setting_value = setting_value || '{"deliver_asset":"on"}'
      where org_id = np and setting_key = 'hub_marketing_flags';
    perform public.grant_asset(c3, asset, decode(md5('t1'), 'hex'), interval '7 days');
    res := public.redeem_asset_grant(decode(md5('t1'), 'hex'));
    r := r || jsonb_build_object('id', 'A_REDEEM', 'ok', res ->> 'path' = '/signup?asset=guide' and res - 'ok' - 'path' = '{}'::jsonb, 'got', res);
    res := public.redeem_asset_grant(decode(md5('t1'), 'hex'), now() + interval '8 days');
    r := r || jsonb_build_object('id', 'A_EXPIRED', 'ok', res ->> 'reason' = 'expired', 'got', res);
    begin
      insert into public.university_assets (org_id, title, path) values (np, 'Bad', '//evil.example/x');
      r := r || jsonb_build_object('id', 'A_PATH_ONLY', 'ok', false, 'got', 'accepted');
    exception when check_violation then
      r := r || jsonb_build_object('id', 'A_PATH_ONLY', 'ok', true, 'got', '23514');
    end;

    -- ── RLS as a real authenticated staff member of NP only ──
    insert into auth.users (id, email) values (u1, 'staff@test.example');
    insert into public.team_profiles (org_id, user_id, display_name, email, role, status)
      values (np, u1, 'Staff', 'staff@test.example', 'team_member', 'active');
    perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := r || jsonb_build_object('id', 'R_IDENTITY', 'ok', current_user = 'authenticated' and auth.uid() = u1, 'got', current_user);
    r := r || jsonb_build_object('id', 'R_READS_OWN_ORG', 'ok',
            (select count(*) from public.funnel_campaigns where id in (f1, fx)) = 1
            and exists (select 1 from public.funnel_campaigns where id = f1), 'got', (select count(*) from public.funnel_campaigns where id in (f1, fx)));
    begin
      insert into public.funnel_campaigns (org_id, name) values (np, 'forged');
      r := r || jsonb_build_object('id', 'R_NO_BROWSER_WRITE', 'ok', false, 'got', 'accepted');
    exception when insufficient_privilege then
      r := r || jsonb_build_object('id', 'R_NO_BROWSER_WRITE', 'ok', true, 'got', '42501');
    end;
    begin
      perform public.enroll(c3, f1, 'x', 'y');
      r := r || jsonb_build_object('id', 'R_NO_BROWSER_ENROLL', 'ok', false, 'got', 'accepted');
    exception when insufficient_privilege then
      r := r || jsonb_build_object('id', 'R_NO_BROWSER_ENROLL', 'ok', true, 'got', '42501');
    end;
    begin
      perform count(*) from public.job_runs;
      r := r || jsonb_build_object('id', 'R_JOB_RUNS_CLOSED', 'ok', false, 'got', 'readable');
    exception when insufficient_privilege then
      r := r || jsonb_build_object('id', 'R_JOB_RUNS_CLOSED', 'ok', true, 'got', '42501');
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
  select s.sel, s.want, pg_temp.hub_contract(s.sel) as res
  from (values ('none', '{}'::text[]),
               ('quiet', '{G_QUIET_2000}'),
               ('cap', '{G_CAP_AT_LIMIT}'),
               ('dupactive', '{E_ACTIVE_NO_2ND_SEQ,M_GOAL_ENDS_DRIP}'),
               ('revokeorder', '{C_STOP_SUPPRESSES,C_UNSUB_KEEPS_SERVICE,G_REVOKED_MID}'),
               ('merge', '{E_MERGED_DUP,E_MERGED_TO_SURVIVOR}')) as s(sel, want)
), red as (
  select sel, want, jsonb_array_length(res) as cases,
         coalesce((select array_agg(e ->> 'id' order by e ->> 'id') from jsonb_array_elements(res) e where not coalesce((e ->> 'ok')::boolean, false)), '{}') as got,
         res
  from runs
)
select sel, cases, got as red, want as declared, got = want as verdict_ok,
       case when sel = 'none' then (select jsonb_agg(e) from jsonb_array_elements(res) e where not coalesce((e ->> 'ok')::boolean, false)) end as failures
from red order by sel = 'none' desc, sel;
