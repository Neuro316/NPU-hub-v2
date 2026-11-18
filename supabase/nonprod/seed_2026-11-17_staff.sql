-- supabase/nonprod/seed_2026-11-17_staff.sql   (Running List q27: Hub previews on nonprod)
--
-- STATUS: PROPOSED, NOT APPLIED. NONPROD ONLY (cpasntagxhxitavivwlb). Applied from the Hub chat on Shane's or
-- Cameron's go. It refuses to run on production (htfrfaxlcuyawtlztxxm): see THE GUARD below.
--
-- PURPOSE: the minimum a staff member needs to sign in to a Hub preview pointed at nonprod and use it without
-- touching a real person: the Neuro Progeny org, Shane's and Cameron's memberships and team profiles, the Sales
-- and Enrolled pipelines with their stages, the org_settings the pages read (every sending switch off), and five
-- obviously fake contacts. No real contact, message, mail or payment data is copied from production. Pipeline
-- and stage ids, names, colours and order are copied from production so links and walkthrough steps match.
--
-- BEFORE RUNNING: both logins must exist in nonprod Authentication (dashboard, Add user). The seed looks each one
-- up by email and stops with a clear error if either is missing. It never hard-codes a nonprod user id.
--
-- THE GUARD (the first statement of the block): the seed refuses unless every one of three markers says nonprod.
--   1. an organizations row other than Neuro Progeny and Waynesville Neuro Wellness exists.
--      Production has 4 such orgs on 17 Nov; nonprod has none.
--   2. more than 100 contacts. Production has 406; nonprod has 11.
--   3. more than 50 auth users. Production has 80; nonprod has 23.
--   Any one marker present refuses the whole run. Three independent markers mean production would have to lose
--   its extra orgs, most contacts and most logins at once before the guard let it through. On nonprod the guard
--   fails closed: if nonprod ever grows past a marker, the seed refuses and a person raises the number on purpose.
--   (The database name and project ref are not visible from SQL, and both projects are called "postgres".)
--
-- ONE BLOCK: everything is a single DO block, so the guard really is the first statement and any error leaves
-- nonprod unchanged in every runner (SQL editor, psql with or without ON_ERROR_STOP, MCP execute_sql).
--
-- IDEMPOTENT: every insert is "on conflict do nothing" or "where not exists", and the one update (Slack off) only
-- matches while Slack is on. A second run writes nothing, and no trigger fires (an insert skipped by on conflict
-- fires no AFTER INSERT trigger). An org_settings key that already exists is left as it is; the block prints a
-- NOTICE for each one so a person can check it.
--
-- TRIGGERS THIS FIRES (first run only):
--   org_settings insert  -> hub_org_settings_pipeline_sync -> sync_pipelines_from_settings(NP). The pipelines and
--                           stages are inserted first with production's ids, and the crm_pipelines setting lists
--                           the same legacy keys, so the sync updates those rows in place and creates nothing new.
--   contacts insert      -> hub_contacts_entry_events (entry events for the five fakes; the lifecycle engine is in
--                           dry_run and the marketing engine is off, so nothing is sent), identity, outreach score.
--   org_members insert   -> enforce_membership_role_agreement (role 'member' passes).
--
-- ROLLBACK (nonprod only, one transaction):
--   begin;
--   delete from public.entry_events where contact_id in (select id from public.contacts where source = 'nonprod_seed');
--   delete from public.contact_timeline where contact_id in (select id from public.contacts where source = 'nonprod_seed');
--   delete from public.contacts where id in ('00000000-0000-4000-8000-0000000c0001','00000000-0000-4000-8000-0000000c0002',
--     '00000000-0000-4000-8000-0000000c0003','00000000-0000-4000-8000-0000000c0004','00000000-0000-4000-8000-0000000c0005');
--     -- contact_pipeline_positions go with them (on delete cascade). If another table now references one of
--     -- the five, this delete fails and the transaction changes nothing: delete those rows first.
--   delete from public.org_settings where org_id = '00000000-0000-0000-0000-000000000001' and setting_key in
--     ('crm_pipelines','enabled_modules','hidden_modules','sidebar_order','hub_marketing_flags','hub_notifications',
--      'hub_lifecycle','hub_send_policy','click_to_call','hub_lead_alerts','hub_booking_type_routes',
--      'booking_completed_stages','crm_notifications');
--     -- only the keys this seed created: compare with the NOTICEs from the run (a key that existed before the
--     -- seed was not written by it and should stay).
--   delete from public.pipeline_stages where pipeline_id in ('d2aa430f-84fb-45e1-be3c-95958403d4d6','51cab093-2b0a-4652-a9c0-9fb10ccf282d');
--   delete from public.pipelines where id in ('d2aa430f-84fb-45e1-be3c-95958403d4d6','51cab093-2b0a-4652-a9c0-9fb10ccf282d');
--   delete from public.team_profiles where org_id = '00000000-0000-0000-0000-000000000001'
--     and lower(email) in ('shane@neuroprogeny.com','cameron@neuroprogeny.com');
--   delete from public.org_members where organization_id = '00000000-0000-0000-0000-000000000001'
--     and user_id = (select id from auth.users where lower(email) = 'shane@neuroprogeny.com');
--     -- Cameron's NP membership existed on nonprod before this seed (owner, active): leave it.
--   delete from public.profiles where id = (select id from auth.users where lower(email) = 'shane@neuroprogeny.com');
--     -- only if the seed created it (nonprod had no profile for this login on 17 Nov).
--   -- slack_config: the seed turned "enabled" off and left the webhook as it was. Turning it back on lets a
--   -- preview post to that real Slack webhook, so the rollback leaves it off on purpose.
--   commit;
--   The two logins are removed, if wanted, in the dashboard (Authentication, Users), never by SQL.

do $seed$
declare
  np   constant uuid := '00000000-0000-0000-0000-000000000001';
  wnw  constant uuid := '806e0330-2c18-4afb-91f5-090906eaa20b';
  sales    constant uuid := 'd2aa430f-84fb-45e1-be3c-95958403d4d6';
  enrolled constant uuid := '51cab093-2b0a-4652-a9c0-9fb10ccf282d';
  shane_email  constant text := 'shane@neuroprogeny.com';
  cameron_email constant text := 'cameron@neuroprogeny.com';
  shane uuid;
  cameron uuid;
  k text;
  n_pipes int;
  n_stages int;
begin
  -- THE GUARD. Nothing above this line writes.
  if exists (select 1 from public.organizations where id not in (np, wnw))
     or (select count(*) from public.contacts) > 100
     or (select count(*) from auth.users) > 50 then
    raise exception 'nonprod seed refused: this database has production markers (orgs beyond NP and WNW, more than 100 contacts, or more than 50 logins). It runs on nonprod (cpasntagxhxitavivwlb) only.';
  end if;

  -- The logins, by email. Created in the dashboard first (docs/plans/nonprod-previews.md).
  select id into shane from auth.users where lower(email) = shane_email;
  select id into cameron from auth.users where lower(email) = cameron_email;
  if shane is null then
    raise exception 'nonprod seed stopped: no nonprod login for %. Create it in the nonprod dashboard (Authentication, Users, Add user) and run the seed again.', shane_email;
  end if;
  if cameron is null then
    raise exception 'nonprod seed stopped: no nonprod login for %. Create it in the nonprod dashboard (Authentication, Users, Add user) and run the seed again.', cameron_email;
  end if;

  -- The org (same id, name and slug as production).
  insert into public.organizations (id, name, slug) values (np, 'Neuro Progeny', 'neuro-progeny')
  on conflict do nothing;

  -- Platform profiles. Nonprod has no trigger on auth.users, so a login made in the dashboard has no profile.
  insert into public.profiles (id, email, full_name, role)
  values (shane, shane_email, 'Shane Granau', 'superadmin'), (cameron, cameron_email, 'Cameron Allen', 'superadmin')
  on conflict (id) do nothing;

  -- Org membership (roles as on production: Cameron owner, Shane member; both superadmin profiles).
  insert into public.org_members (user_id, organization_id, role, status)
  values (cameron, np, 'owner', 'active'), (shane, np, 'member', 'active')
  on conflict (user_id, organization_id) do nothing;

  -- Hub team profiles (what withStaff and the pages trust).
  insert into public.team_profiles (org_id, user_id, display_name, email, role, status)
  select np, v.uid, v.name, v.email, 'super_admin', 'active'
  from (values (shane, 'Shane Granau', shane_email), (cameron, 'Cameron Allen', cameron_email)) v(uid, name, email)
  where not exists (select 1 from public.team_profiles t where t.org_id = np and (t.user_id = v.uid or lower(t.email) = v.email));

  -- Pipelines and stages: production's ids, legacy keys, names, colours and order. Inserted before crm_pipelines
  -- so the settings sync below finds them by legacy key and keeps these ids.
  insert into public.pipelines (id, org_id, legacy_key, name, is_default, position) values
    (sales, np, 'default', 'Sales Pipeline', true, 0),
    (enrolled, np, 'pipeline-1771530511407', 'Enrolled', false, 1)
  on conflict do nothing;

  insert into public.pipeline_stages (id, org_id, pipeline_id, legacy_key, name, position, color, is_closed_won, is_closed_lost) values
    ('1c45635a-bac8-42c0-9a5e-26982cd635f5', np, sales, 'stage-0', 'New Lead', 0, '#228DC4', false, false),
    ('22675e26-60f7-4aa0-8915-730bc23ba038', np, sales, 'stage-1', 'Discovery call Scheduled', 1, '#2A9D8F', false, false),
    ('e922e1ba-e304-4c5f-989d-892139705295', np, sales, 'stage-2', 'Discovery Call', 2, '#3DB5A6', false, false),
    ('ac06b5d8-38de-494d-b853-a96262dc3fc9', np, sales, 'stage-3', 'Price quoted', 3, '#FBBF24', false, false),
    ('da2c2d0e-432b-436a-a566-ada2c0e86336', np, sales, 'stage-4', 'Follow up', 4, '#E76F51', false, false),
    ('64be93a2-feed-418d-a2d1-9849473d7e2d', np, sales, 'stage-5', 'Clarity Phase 1', 5, '#34D399', true, false),
    ('b9a71d88-8258-475b-af51-f77b43159d5c', np, sales, 'stage-6', 'Clarity Phase 2', 6, '#F87171', true, false),
    ('bc6f643a-b51e-484c-b13d-20b987810d85', np, sales, 'stage-1793350612069', 'Clarity Phase 3', 7, '#84CC16', true, false),
    ('fe8ce1da-059d-4f87-9a2c-7b19875351af', np, sales, 'stage-1793350631617', 'Home Neuro Program', 8, '#14B8A6', true, false),
    ('9e238608-c023-4253-b5c5-5a96727456e6', np, sales, 'stage-1793350649377', 'Office Neuro Program', 9, '#FBBF24', true, false),
    ('1dd7da62-ce19-4257-8928-ac6af4d6398b', np, sales, 'stage-1794239502656', 'Fresh Air Only', 10, '#94a3b8', true, false),
    ('ccce3871-11fc-4421-82bb-921c400c05fb', np, sales, 'stage-1794239524332', 'Expand App Only', 11, '#94a3b8', true, false),
    ('f2a6f234-4831-41bf-ae84-2d80a03f7afd', np, sales, 'stage-1794239539820', 'Drip Marketing', 12, '#94a3b8', false, false),
    ('b8ca425b-f02e-4131-a8e2-3a58b2e7aa8e', np, enrolled, 'stage-1772022700334', 'Signed up - add user email used to sign up in Circle; dependency has to be joined circle ', 0, '#94a3b8', false, false),
    ('090d4bdf-fec8-4772-94e2-86fc5daafd6a', np, enrolled, 's2', 'Paid/ payment plan', 1, '#2A9D8F', false, false),
    ('0b1c37ac-76b2-4574-a796-9ca0c9be7993', np, enrolled, 's6', 'Equipment is shipped or Picked up - trigger auto email with tracking ', 2, '#34D399', false, false),
    ('0b1d76f0-3650-43c4-a4a5-4325b7f872e2', np, enrolled, 'stage-1771627199202', 'Onboarding Email Sent', 3, '#6366F1', false, false),
    ('5e21dfd1-dff2-4434-a155-e94c130352b7', np, enrolled, 'stage-1782412301707', 'RSVP''d for Kickoff call ', 4, '#94a3b8', false, false),
    ('51af167b-7576-47fa-8268-3ebfd0a88b4d', np, enrolled, 's4', 'Started course', 5, '#FBBF24', false, false),
    ('14c33933-f115-4c0b-80c7-0ddcc79c80d1', np, enrolled, 's5', 'Completed Course moving to nurture', 6, '#E76F51', false, false),
    ('c4810bd4-7fc8-4f5c-8d23-15098c62dd13', np, enrolled, 's7', 'Completed course Joined Alumni Membership ', 7, '#F87171', false, false),
    ('a623ec21-0bae-45b7-80da-b22d944f03bf', np, enrolled, 'stage-fix-checkout-started', 'Checkout started', 8, '#94a3b8', false, false),
    ('a23c2b84-20b1-42e5-acfd-971f63f1d47c', np, enrolled, 'stage-lifecycle-purchased', 'Purchased', 9, '#2A9D8F', false, false),
    ('9d4a1673-ae0d-40fb-b7f2-b62f69fe3cc3', np, enrolled, 'stage-lifecycle-consent-signed', 'Consent signed', 10, '#3B82F6', false, false),
    ('75c7f2fe-671c-4dbd-8144-4faab706556f', np, enrolled, 'stage-lifecycle-onboarded', 'Onboarded', 11, '#8B5CF6', false, false),
    ('bf692763-fdc9-439e-8c42-35a9f96ec686', np, enrolled, 'stage-lifecycle-active', 'Active', 12, '#22C55E', false, false),
    ('3bcde5bc-afaf-4d40-a4c1-2953e97c4ec2', np, enrolled, 'stage-lifecycle-drop-off-risk', 'Drop-off risk', 13, '#F59E0B', false, false),
    ('0640b2a1-cba6-4423-a375-f71e1e9ecbe0', np, enrolled, 'stage-lifecycle-completed', 'Completed', 14, '#64748B', false, false)
  on conflict do nothing;

  -- Report keys that already exist; they are left untouched.
  for k in select s.setting_key from public.org_settings s where s.org_id = np and s.setting_key in
    ('crm_pipelines','enabled_modules','hidden_modules','sidebar_order','hub_marketing_flags','hub_notifications',
     'hub_lifecycle','hub_send_policy','click_to_call','hub_lead_alerts','hub_booking_type_routes',
     'booking_completed_stages','crm_notifications')
  loop
    raise notice 'nonprod seed: org_settings % already exists on NP and was left as it is', k;
  end loop;

  -- org_settings with SAFE values. Nothing here can send, call or text.
  insert into public.org_settings (org_id, setting_key, setting_value) values
    -- the pipeline editor's source of truth; stage emails are left out on purpose (no stage automations)
    (np, 'crm_pipelines', (
      select jsonb_build_object('active', 'default', 'pipelines', jsonb_agg(p order by p_pos))
      from (
        select pl.position as p_pos,
               jsonb_build_object('id', pl.legacy_key, 'name', pl.name, 'is_default', pl.is_default,
                 'stages', (select jsonb_agg(jsonb_build_object('id', s.legacy_key, 'name', s.name, 'color', s.color,
                              'position', s.position, 'is_closed_won', s.is_closed_won, 'is_closed_lost', s.is_closed_lost)
                              order by s.position)
                            from public.pipeline_stages s where s.pipeline_id = pl.id)) as p
        from public.pipelines pl where pl.id in (sales, enrolled)
      ) x)),
    (np, 'enabled_modules', '["ehr"]'),
    (np, 'hidden_modules', '["analytics","social","ideas","tickets","finance_suite","np_financial"]'),
    (np, 'sidebar_order', '{"items":{"create":["/social","/media","/library","/calendar","/shipit","/ideas"],"operate":["/meetings","/tasks","/journeys","/tasks/my-tasks","/crm/tasks","/sops","/rocks","/tickets"]},"categories":["grow","operate","create","intelligence","finance"]}'),
    -- every marketing flag off: no engine, no live sends, no providers, no intake, no landing pages
    (np, 'hub_marketing_flags', '{"engine":"off","gate_live_sends":"off","provider_email":"off","provider_sms":"off","intake":"off","deliver_asset":"off","mirror_legacy_stage":"off","agent_enabled":"off","help_bot_enabled":"off","pages":"off"}'),
    -- the brief and urgent alerts: off (nothing built, nothing sent)
    (np, 'hub_notifications', '{"mode":"off","rules":{}}'),
    -- lifecycle routing in dry run: records what it would do, moves and sends nothing
    (np, 'hub_lifecycle', jsonb_build_object('mode', 'dry_run', 'wnw_org', wnw, 'source_orgs', jsonb_build_array(wnw),
       'sales_pipeline', 'default', 'enrolled_pipeline', 'pipeline-1771530511407', 'assignee', cameron)),
    -- sending identity on a domain no provider will accept, so even a mistaken live send fails
    (np, 'hub_send_policy', '{"cap_days":7,"cap_count":3,"quiet_start":"08:00","quiet_end":"20:00","default_timezone":"America/New_York","from_domain":"example.com","from_address":"Hub Nonprod <nonprod@example.com>","reply_to":"nonprod@example.com"}'),
    (np, 'click_to_call', '{"enabled":"off","live":"off"}'),
    (np, 'hub_lead_alerts', '{"enabled":"off"}'),
    -- no booking types exist on nonprod, so no routes
    (np, 'hub_booking_type_routes', '{}'),
    (np, 'booking_completed_stages', '{}'),
    (np, 'crm_notifications', '{"new_lead":false,"missed_call":false,"task_overdue":false,"campaign_complete":false}')
  on conflict (org_id, setting_key) do nothing;

  -- Slack: nonprod NP already has slack_config with a webhook set and enabled. Turn it off so a preview cannot
  -- post to a real Slack channel. The webhook value itself is not read or changed.
  update public.org_settings set setting_value = jsonb_set(setting_value, '{enabled}', 'false'::jsonb), updated_at = now()
  where org_id = np and setting_key = 'slack_config' and coalesce(setting_value ->> 'enabled', 'false') <> 'false';

  -- Five obviously fake contacts. example.com mail, +1555 numbers (no such area code), no consent, tagged.
  insert into public.contacts (id, org_id, first_name, last_name, email, phone, source, tags) values
    ('00000000-0000-4000-8000-0000000c0001', np, 'Test', 'Lead One',     'test.lead.one@example.com',     '+15555550101', 'nonprod_seed', array['nonprod-test']),
    ('00000000-0000-4000-8000-0000000c0002', np, 'Test', 'Lead Two',     'test.lead.two@example.com',     '+15555550102', 'nonprod_seed', array['nonprod-test']),
    ('00000000-0000-4000-8000-0000000c0003', np, 'Test', 'Lead Three',   'test.lead.three@example.com',   '+15555550103', 'nonprod_seed', array['nonprod-test']),
    ('00000000-0000-4000-8000-0000000c0004', np, 'Test', 'Client Four',  'test.client.four@example.com',  '+15555550104', 'nonprod_seed', array['nonprod-test']),
    ('00000000-0000-4000-8000-0000000c0005', np, 'Test', 'Client Five',  'test.client.five@example.com',  '+15555550105', 'nonprod_seed', array['nonprod-test'])
  on conflict (id) do nothing;

  -- Their places: three in Sales, two in Enrolled.
  insert into public.contact_pipeline_positions (contact_id, org_id, pipeline_id, stage_id, source) values
    ('00000000-0000-4000-8000-0000000c0001', np, sales,    '1c45635a-bac8-42c0-9a5e-26982cd635f5', 'nonprod_seed'),  -- New Lead
    ('00000000-0000-4000-8000-0000000c0002', np, sales,    '22675e26-60f7-4aa0-8915-730bc23ba038', 'nonprod_seed'),  -- Discovery call Scheduled
    ('00000000-0000-4000-8000-0000000c0003', np, sales,    'da2c2d0e-432b-436a-a566-ada2c0e86336', 'nonprod_seed'),  -- Follow up
    ('00000000-0000-4000-8000-0000000c0004', np, enrolled, 'a23c2b84-20b1-42e5-acfd-971f63f1d47c', 'nonprod_seed'),  -- Purchased
    ('00000000-0000-4000-8000-0000000c0005', np, enrolled, 'bf692763-fdc9-439e-8c42-35a9f96ec686', 'nonprod_seed')   -- Active
  on conflict (contact_id, pipeline_id) do nothing;

  -- Read back inside the block: a short result stops here and changes nothing.
  select count(*) into n_pipes from public.pipelines where org_id = np and id in (sales, enrolled) and archived_at is null;
  select count(*) into n_stages from public.pipeline_stages where pipeline_id in (sales, enrolled) and archived_at is null;
  if n_pipes <> 2 or n_stages <> 28 then
    raise exception 'nonprod seed stopped: expected 2 pipelines and 28 stages after the sync, found % and %', n_pipes, n_stages;
  end if;
  if (select count(*) from public.team_profiles where org_id = np and user_id in (shane, cameron) and status = 'active'
        and role = 'super_admin') <> 2 then
    raise exception 'nonprod seed stopped: a team profile for one of the two logins is missing or not an active super_admin';
  end if;
  raise notice 'nonprod seed: done (2 pipelines, 28 stages, 2 staff, 5 test contacts)';
end
$seed$;
