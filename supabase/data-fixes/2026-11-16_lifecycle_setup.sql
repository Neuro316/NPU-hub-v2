-- 2026-11-16_lifecycle_setup.sql  (data fix, not a migration: no schema change)
--
-- STATUS: PROPOSED 2026-11-16. NOT RUN. Needs a go. Run AFTER hub_237, nonprod first only if nonprod has the same
-- Neuro Progeny org rows (it does not today; this file names production ids and refuses to run where they differ).
--
-- Neuro Progeny org (00000000-0000-0000-0000-000000000001) only. Everything stays in DRY RUN:
--   * org_settings 'hub_lifecycle' is created with mode 'dry_run': the engine records what it would do in
--     hub_lifecycle_events and writes nothing else (no stage move, tag, timeline row, campaign entry or task);
--   * every campaign below is status 'draft', live_enabled false; every route is active = false and
--     activate_with_campaign = false, so raise_entry_event queues nothing;
--   * the booking sync only uses the Hub routes once mode is 'live'. Until then the University's two route rows
--     keep deciding, exactly as today.
--
-- WHAT IT WRITES
--   1. Enrolled pipeline (pipeline-1771530511407): six stages appended after the existing ones, in order:
--      Purchased, Consent signed, Onboarded, Active, Drop-off risk, Completed. Existing stages are untouched.
--      The org_settings trigger hub_org_settings_pipeline_sync mirrors them into pipeline_stages.
--   2. org_settings 'hub_booking_type_routes': the routing table (appointment type id to kind, brand, pipeline, stage).
--   3. org_settings 'hub_lifecycle': mode dry_run; follow-up tasks assigned to Cameron; the WNW org's University
--      data lands on Neuro Progeny contacts; Sales = 'default'; Enrolled = 'pipeline-1771530511407'.
--   4. org_settings 'booking_completed_stages': WNW Discovery Call added, held calls move to Sales / Discovery Call.
--   5. Campaign drafts: Discovery no-show, Client onboarding, Drop-off nudge (new), each with one inactive
--      lifecycle:* route; and one inactive lifecycle:* route on each of the three existing drafts the engine
--      enrolls or exits (Checkout recovery, Discovery booked, Post-discovery follow-up).
--
-- ROLLBACK:
--   begin;
--   delete from public.campaign_routes where org_id = '00000000-0000-0000-0000-000000000001' and source_key like 'lifecycle:%';
--   delete from public.sequence_steps where sequence_id in (select sequence_id from public.funnel_campaigns
--     where org_id = '00000000-0000-0000-0000-000000000001' and description like '%[lifecycle-2026-11-16]%');
--   delete from public.sequences where campaign_id in (select id from public.funnel_campaigns
--     where org_id = '00000000-0000-0000-0000-000000000001' and description like '%[lifecycle-2026-11-16]%');
--   delete from public.funnel_campaigns where org_id = '00000000-0000-0000-0000-000000000001' and description like '%[lifecycle-2026-11-16]%';
--   delete from public.org_settings where org_id = '00000000-0000-0000-0000-000000000001' and setting_key in ('hub_lifecycle', 'hub_booking_type_routes');
--   update public.org_settings set setting_value = setting_value - 'eeeb4aac-4991-4785-a505-0c40a930c366'
--    where org_id = '00000000-0000-0000-0000-000000000001' and setting_key = 'booking_completed_stages';
--   -- the six Enrolled stages: remove them on the board (Settings, Pipelines) only once no card sits in them
--   commit;

begin;

do $fix$
declare
  v_org      constant uuid := '00000000-0000-0000-0000-000000000001';
  v_wnw_org  constant uuid := '806e0330-2c18-4afb-91f5-090906eaa20b';
  v_actor    constant uuid := '22456608-5f7d-495e-af02-7037fea125cc';  -- Cameron's user id (tasks.assigned_to, funnel_campaigns.created_by)
  v_member   constant uuid := 'e3019576-1fcf-4e07-8004-59ff121af990';  -- Cameron's team_members id (sequences.created_by FK)
  c_enrolled constant text := 'pipeline-1771530511407';
  c_tag      constant text := ' [lifecycle-2026-11-16]';
  v_cfg      jsonb;
  v_pipes    jsonb;
  v_idx      int;
  v_stages   jsonb;
  v_pos      int;
  v_names    text[] := array['Purchased', 'Consent signed', 'Onboarded', 'Active', 'Drop-off risk', 'Completed'];
  v_active   uuid;
  v_done     uuid;
  def jsonb; c jsonb; st jsonb; v_camp uuid; v_seq uuid; i int;
  n_camp int := 0; n_step int := 0; n_route int := 0;
begin
  -- the ids this file names must be the production ones
  if not exists (select 1 from public.organizations where id = v_wnw_org) or not exists (select 1 from public.team_members where id = v_member) then
    raise exception 'lifecycle setup: not the production org rows; stop';
  end if;
  if exists (select 1 from public.org_settings where org_id = v_org and setting_key in ('hub_lifecycle', 'hub_booking_type_routes')) then
    raise exception 'lifecycle setup: already run';
  end if;

  -- 1. Enrolled stages
  select setting_value into v_cfg from public.org_settings where org_id = v_org and setting_key = 'crm_pipelines';
  v_pipes := v_cfg -> 'pipelines';
  select ord - 1 into v_idx from jsonb_array_elements(v_pipes) with ordinality as x(p, ord) where p ->> 'id' = c_enrolled;
  if v_idx is null then raise exception 'lifecycle setup: Enrolled pipeline not found'; end if;
  v_stages := v_pipes -> v_idx -> 'stages';
  if exists (select 1 from jsonb_array_elements(v_stages) s where s ->> 'name' = any (v_names)) then
    raise exception 'lifecycle setup: an Enrolled stage with one of the six names already exists; stop and look';
  end if;
  select coalesce(max((s ->> 'position')::int), -1) + 1 into v_pos from jsonb_array_elements(v_stages) s;
  for i in 1 .. array_length(v_names, 1) loop
    v_stages := v_stages || jsonb_build_array(jsonb_build_object(
      'id', 'stage-lifecycle-' || lower(regexp_replace(v_names[i], '[^A-Za-z]+', '-', 'g')),
      'name', v_names[i], 'color', (array['#2A9D8F','#3B82F6','#8B5CF6','#22C55E','#F59E0B','#64748B'])[i], 'position', v_pos + i - 1));
  end loop;
  v_pipes := jsonb_set(v_pipes, array[v_idx::text, 'stages'], v_stages);
  update public.org_settings set setting_value = jsonb_set(v_cfg, '{pipelines}', v_pipes), updated_at = now()
   where org_id = v_org and setting_key = 'crm_pipelines';
  if (select count(*) from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
       where p.org_id = v_org and p.legacy_key = c_enrolled and s.archived_at is null and s.name = any (v_names)) <> 6 then
    raise exception 'lifecycle setup: the board mirror did not create the six stages';
  end if;
  select s.id into v_active from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
   where p.org_id = v_org and p.legacy_key = c_enrolled and s.name = 'Active' and s.archived_at is null;
  select s.id into v_done from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
   where p.org_id = v_org and p.legacy_key = c_enrolled and s.name = 'Completed' and s.archived_at is null;

  -- 2. routing table. Discovery calls are leads into Sales; coaching sessions are activity on a client.
  --    Interesting meeting keeps its University route (not listed here).
  insert into public.org_settings (org_id, setting_key, setting_value) values (v_org, 'hub_booking_type_routes', $routes${
    "e93799e2-4340-494c-881a-94b8792d0ee5": {"kind": "lead", "brand": "np",  "pipeline": "default", "stage": "Discovery call Scheduled"},
    "eeeb4aac-4991-4785-a505-0c40a930c366": {"kind": "lead", "brand": "wnw", "pipeline": "default", "stage": "Discovery call Scheduled"},
    "cd83bf43-7678-4052-bd4e-41c2f34e8e8a": {"kind": "activity", "brand": "np"},
    "f6ef2b40-10f7-4070-b85d-24f3afaa0716": {"kind": "activity", "brand": "np"},
    "7b36929c-0df2-45c4-addf-391daac89ab4": {"kind": "activity", "brand": "np"},
    "6f95dca0-4f63-4e33-a1b0-c0ddc1baf891": {"kind": "activity", "brand": "np"},
    "123e83ff-45d1-4739-9d70-cef17ec34342": {"kind": "activity", "brand": "np"},
    "1b5414be-ad6c-4906-a034-ba22a468781d": {"kind": "activity", "brand": "np"},
    "5b7a3ab8-d68d-4149-b64a-fdcb99f93071": {"kind": "activity", "brand": "np"},
    "748b8b3e-f524-4541-9151-4eabf8d65175": {"kind": "activity", "brand": "np"},
    "7e912212-f457-4ae6-bb00-87246c989905": {"kind": "activity", "brand": "np"},
    "1da5ec42-ac3d-4c2a-993e-c043651f5074": {"kind": "activity", "brand": "np"},
    "8c107b06-a6fd-4866-bc7d-f26ad457f17d": {"kind": "activity", "brand": "np"},
    "88aafcbb-1074-4ea8-9c26-4927f91094b6": {"kind": "activity", "brand": "np"},
    "c4086283-c6f3-4df0-bfb6-46a21890b961": {"kind": "activity", "brand": "wnw"},
    "9bf8f561-0058-4ad5-9287-064b8872cc65": {"kind": "activity", "brand": "wnw"},
    "c9dd6c38-40ec-4738-949b-1e456cbf5d4a": {"kind": "activity", "brand": "wnw"}
  }$routes$::jsonb);
  if (select count(*) from public.nr_appointment_types t, jsonb_object_keys((select setting_value from public.org_settings
        where org_id = v_org and setting_key = 'hub_booking_type_routes')) k where t.id = k::uuid and t.retired_at is null) <> 17 then
    raise exception 'lifecycle setup: a routed appointment type is missing or retired; stop and look';
  end if;

  -- 3. the engine's own setting, in dry run
  insert into public.org_settings (org_id, setting_key, setting_value) values (v_org, 'hub_lifecycle', jsonb_build_object(
    'mode', 'dry_run', 'assignee', v_actor, 'source_orgs', jsonb_build_array(v_wnw_org), 'wnw_org', v_wnw_org,
    'sales_pipeline', 'default', 'enrolled_pipeline', c_enrolled));

  -- 4. a held WNW discovery call moves to Sales / Discovery Call, as the Neuro Progeny one does
  update public.org_settings set setting_value = setting_value || jsonb_build_object('eeeb4aac-4991-4785-a505-0c40a930c366', 'Discovery Call'), updated_at = now()
   where org_id = v_org and setting_key = 'booking_completed_stages';

  -- 5. campaigns. Copy in Cameron's voice: short, warm, capacity language, never framing a gap as failure.
  def := $copy$[
 {
  "name": "Discovery no-show",
  "source": "lifecycle:discovery_no_show",
  "description": "A discovery call time passed without us connecting. Two short notes offering a new time. Ends when they book again, buy or reply.",
  "exit": {"payment": "since_entry", "reply": true},
  "steps": [
   {"delay": 30, "subject": "We missed each other today",
    "body": "<p>Hi {{first_name}},</p><p>Looks like we missed each other for our call today. Days get full, and that's okay.</p><p>If you'd still like to talk, pick whatever time works best for you.</p><p><a href=\"{{discovery_booking_url}}\">Pick a new time</a></p><p>Cameron</p>"},
   {"delay": 4320, "subject": "Still here when you're ready",
    "body": "<p>Hi {{first_name}},</p><p>Just a quick note. The conversation is still open whenever the timing feels right. It's a relaxed call about what you'd like more of in your days.</p><p><a href=\"{{discovery_booking_url}}\">Book a time</a></p><p>Cameron</p>"}
  ]
 },
 {
  "name": "Client onboarding",
  "source": "lifecycle:client_onboarding",
  "description": "A new client. A welcome, then gentle first steps: the first lesson, the first practice session, finding a rhythm. Ends when they are Active or Completed in Enrolled.",
  "exit": {"stages": ["__ACTIVE__", "__DONE__"]},
  "steps": [
   {"delay": 10, "subject": "Welcome, I'm so glad you're here",
    "body": "<p>Hi {{first_name}},</p><p>Welcome. I'm really glad you're here.</p><p>Everything in this training is built to grow your capacity a little at a time, so there's more of you available for the days you care about. You don't need to do it all at once.</p><p>A good first step is to open your first lesson. It takes just a few minutes.</p><p><a href=\"https://university.neuroprogeny.com\">Open your first lesson</a></p><p>Cameron</p>"},
   {"delay": 2880, "subject": "Your first practice session",
    "body": "<p>Hi {{first_name}},</p><p>When you have a few quiet minutes, try your first practice session. There's nothing to get right. It's simply time for your nervous system to settle and stretch a little.</p><p>Small, regular practice is how capacity builds.</p><p><a href=\"https://university.neuroprogeny.com\">Start a practice session</a></p><p>Cameron</p>"},
   {"delay": 4320, "subject": "Finding a rhythm that fits your days",
    "body": "<p>Hi {{first_name}},</p><p>The people who get the most from this work find a rhythm that fits real life. For some that's a few minutes in the morning, for others it's winding down at night.</p><p>Whatever you pick, it counts. Build from where you are.</p><p><a href=\"https://university.neuroprogeny.com\">Continue your training</a></p><p>Cameron</p>"},
   {"delay": 7200, "subject": "Checking in",
    "body": "<p>Hi {{first_name}},</p><p>I wanted to check in and see how things are feeling so far. If anything would make this easier to fit into your week, just reply and tell me. I read every message.</p><p>Cameron</p>"}
  ]
 },
 {
  "name": "Drop-off nudge",
  "source": "lifecycle:dropoff_nudge",
  "description": "An enrolled client has had a quiet few days. Warm notes that make it easy to pick back up. Ends when they are active again, finish, or reply.",
  "exit": {"stages": ["__ACTIVE__", "__DONE__"], "reply": true},
  "steps": [
   {"delay": 60, "subject": "Pick up right where you are",
    "body": "<p>Hi {{first_name}},</p><p>Life gets full, and the training is designed for that. You can pick up right where you are. Nothing is lost.</p><p>Even five minutes today builds capacity.</p><p><a href=\"https://university.neuroprogeny.com\">Open your training</a></p><p>Cameron</p>"},
   {"delay": 4320, "subject": "A small step counts",
    "body": "<p>Hi {{first_name}},</p><p>A small step still counts. One short practice session is enough to reconnect with the work and give your nervous system a little more room.</p><p><a href=\"https://university.neuroprogeny.com\">Start a short session</a></p><p>Cameron</p>"},
   {"delay": 5760, "subject": "Here if you want a hand",
    "body": "<p>Hi {{first_name}},</p><p>If it would help to talk through how to fit this into your week, I'm happy to. Just reply to this note, or grab a time that suits you.</p><p><a href=\"{{discovery_booking_url}}\">Book a time to talk</a></p><p>Cameron</p>"}
  ]
 }
]$copy$;

  def := replace(replace(def::text, '__ACTIVE__', v_active::text), '__DONE__', v_done::text)::jsonb;

  for c in select * from jsonb_array_elements(def) loop
    insert into public.funnel_campaigns (org_id, name, description, status, entry_pipeline_id, entry_stage_id, goal, live_enabled, created_by)
    values (v_org, c ->> 'name', (c ->> 'description') || c_tag, 'draft', null, null, jsonb_build_object('exit', c -> 'exit'), false, v_actor)
    returning id into v_camp;
    n_camp := n_camp + 1;

    insert into public.sequences (org_id, name, campaign_id, created_by, is_active)
    values (v_org, c ->> 'name', v_camp, v_member, true) returning id into v_seq;
    update public.funnel_campaigns set sequence_id = v_seq where id = v_camp;

    i := 0;
    for st in select * from jsonb_array_elements(c -> 'steps') loop
      i := i + 1;
      if (st ->> 'body') ~ (chr(8212) || '|&mdash;') or (st ->> 'subject') ~ (chr(8212) || '|&mdash;') then
        raise exception 'lifecycle setup: an em dash in % step %', c ->> 'name', i;
      end if;
      if strpos(st ->> 'body', '[[') > 0 or strpos(st ->> 'body', 'leadconnector') > 0 or strpos(st ->> 'body', '__') > 0 then
        raise exception 'lifecycle setup: a placeholder or a hard-coded booking link in % step %', c ->> 'name', i;
      end if;
      insert into public.sequence_steps (sequence_id, step_order, channel, delay_minutes, subject, body, kind, step_type)
      values (v_seq, i, 'email', (st ->> 'delay')::int, st ->> 'subject', st ->> 'body', 'marketing', 'message');
      n_step := n_step + 1;
    end loop;

    insert into public.campaign_routes (org_id, source_key, campaign_id, active, activate_with_campaign)
    values (v_org, c ->> 'source', v_camp, false, false);
    n_route := n_route + 1;
  end loop;

  -- the existing drafts the engine enrolls into or exits from get an inactive lifecycle route each
  insert into public.campaign_routes (org_id, source_key, campaign_id, active, activate_with_campaign)
  select v_org, x.key, f.id, false, false
    from (values ('Checkout recovery', 'lifecycle:checkout_recovery'), ('Discovery booked', 'lifecycle:discovery_booked'),
                 ('Post-discovery follow-up', 'lifecycle:post_discovery')) as x(name, key)
    join public.funnel_campaigns f on f.org_id = v_org and f.name = x.name and f.status = 'draft' and f.description like '%[launch-2026-11-07]%';
  get diagnostics i = row_count;
  n_route := n_route + i;

  if n_camp <> 3 or n_step <> 9 or n_route <> 6 then
    raise exception 'lifecycle setup: made % campaigns, % steps, % routes; expected 3, 9, 6', n_camp, n_step, n_route;
  end if;
  if exists (select 1 from public.campaign_routes where org_id = v_org and source_key like 'lifecycle:%' and (active or activate_with_campaign)) then
    raise exception 'lifecycle setup: a lifecycle route is armed';
  end if;
  if exists (select 1 from public.funnel_campaigns where org_id = v_org and description like '%' || btrim(c_tag) || '%' and (status <> 'draft' or live_enabled)) then
    raise exception 'lifecycle setup: a draft is not a draft';
  end if;
end $fix$;

-- report
select setting_key, setting_value ->> 'mode' as mode from public.org_settings
 where org_id = '00000000-0000-0000-0000-000000000001' and setting_key in ('hub_lifecycle', 'hub_booking_type_routes', 'booking_completed_stages');
select s.position, s.name from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
 where p.org_id = '00000000-0000-0000-0000-000000000001' and p.legacy_key = 'pipeline-1771530511407' and s.archived_at is null order by s.position;
select f.name, f.status, f.live_enabled, r.source_key, r.active as route_active
  from public.funnel_campaigns f join public.campaign_routes r on r.campaign_id = f.id
 where f.org_id = '00000000-0000-0000-0000-000000000001' and r.source_key like 'lifecycle:%' order by f.name;

commit;
