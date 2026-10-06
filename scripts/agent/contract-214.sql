-- scripts/agent/contract-214.sql   BRANCH ONLY (hub-rls-214). Never run against htfrfaxlcuyawtlztxxm.
--
-- Part 1 (run once): the probe schema, the identities and the fixtures.
-- Part 2 (run per phase): select probe.matrix('<phase>'); then read probe.results.
--
-- Every probe runs inside a subtransaction that is always rolled back (it ends by raising), so no
-- fixture ever changes. Inside it the probe asserts current_user and auth.uid() are the identity it
-- claims and records PROBE_INVALID otherwise, so a run as postgres can never read as a result.
-- Outcomes: rows=N (a count read, or rows a write touched) or ERR <SQLSTATE>.

create schema if not exists probe;
create table probe.ids (name text primary key, uid uuid, dbrole text not null);
create table probe.results (phase text, ident text, tbl text, cmd text, scope text, outcome text, at timestamptz default clock_timestamp());

-- orgs A and B; fixed ids so the expected matrix is readable
--   OA aaaaaaaa-0000-0000-0000-00000000000a   OB bbbbbbbb-0000-0000-0000-00000000000b
insert into probe.ids values
  ('staff_a',          'a0000000-0000-0000-0000-000000000001', 'authenticated'),  -- admin team row in A, org member of A
  ('staff_a_no_om',    'a0000000-0000-0000-0000-000000000002', 'authenticated'),  -- team_member row in A, NOT an org member (2 such live rows)
  ('participant_a',    'a0000000-0000-0000-0000-000000000003', 'authenticated'),  -- org member of A only, profiles participant
  ('teamrow_partic_a', 'a0000000-0000-0000-0000-000000000004', 'authenticated'),  -- active team row in A with role participant: withStaff refuses
  ('super_no_team',    'a0000000-0000-0000-0000-000000000005', 'authenticated'),  -- profiles superadmin, org member of A, no team row: withStaff refuses
  ('anon',             null,                                   'anon');

insert into public.profiles (id, email, role) values
  ('a0000000-0000-0000-0000-000000000001', 'staff-a@probe.invalid', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'staff-a2@probe.invalid', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'partic-a@probe.invalid', 'participant'),
  ('a0000000-0000-0000-0000-000000000004', 'teamrow-a@probe.invalid', 'participant'),
  ('a0000000-0000-0000-0000-000000000005', 'super@probe.invalid', 'superadmin');
insert into public.org_members (user_id, organization_id) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a'),
  ('a0000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000000a'),
  ('a0000000-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-00000000000a');
insert into public.team_profiles (org_id, user_id, display_name, role, status) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'Staff A', 'admin', 'active'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'Staff A2', 'team_member', 'active'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000004', 'Teamrow participant', 'participant', 'active');

insert into public.sequences (id, org_id, name) values
  ('5a000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Seq A'),
  ('5b000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Seq B');
insert into public.sequence_steps (id, sequence_id, step_order, channel, subject, body) values
  ('1a000000-0000-0000-0000-00000000000a', '5a000000-0000-0000-0000-00000000000a', 1, 'email', 'Step A', 'Body A'),
  ('1b000000-0000-0000-0000-00000000000b', '5b000000-0000-0000-0000-00000000000b', 1, 'email', 'Step B', 'Body B');
insert into public.sequence_enrollments (id, sequence_id, contact_id) values
  ('ea000000-0000-0000-0000-00000000000a', '5a000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a'),
  ('eb000000-0000-0000-0000-00000000000b', '5b000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000b');
insert into public.email_campaigns (id, org_id, name, subject, body_text) values
  ('ca000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Camp A', 'SUBJECT-A', 'SECRET-CONTENT-A'),
  ('cb000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Camp B', 'SUBJECT-B', 'SECRET-CONTENT-B');
insert into public.email_sends (id, campaign_id, contact_id) values
  ('da000000-0000-0000-0000-00000000000a', 'ca000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a'),
  ('db000000-0000-0000-0000-00000000000b', 'cb000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000b');

create or replace function probe.one(p_phase text, p_ident text, p_tbl text, p_cmd text, p_scope text, p_sql text)
returns void language plpgsql as $$
declare v_role text; v_uid uuid; n bigint; o text; cu text; au uuid;
begin
  select dbrole, uid into v_role, v_uid from probe.ids where name = p_ident;
  begin
    perform set_config('request.jwt.claims',
      case when v_uid is null then '{"role":"anon"}' else json_build_object('sub', v_uid, 'role', 'authenticated')::text end, true);
    execute format('set local role %I', v_role);
    cu := current_user; au := auth.uid();
    if cu <> v_role or au is distinct from v_uid then raise exception 'PROBE_INVALID role=% uid=%', cu, au; end if;
    if p_cmd in ('select', 'content') or p_scope = 'app-read' then execute p_sql into n;
    else execute p_sql; get diagnostics n = row_count; end if;
    raise exception 'PROBE_DONE' using detail = coalesce(n, 0)::text;
  exception when others then
    if sqlerrm = 'PROBE_DONE' then get stacked diagnostics o = pg_exception_detail; o := 'rows=' || o;
    elsif sqlerrm like 'PROBE_INVALID%' then o := sqlerrm;
    else o := 'ERR ' || sqlstate; end if;
  end;
  if current_user <> 'postgres' then raise exception 'the role did not revert after a probe: %', current_user; end if;
  insert into probe.results (phase, ident, tbl, cmd, scope, outcome) values (p_phase, p_ident, p_tbl, p_cmd, p_scope, o);
end $$;

create or replace function probe.matrix(p_phase text) returns void language plpgsql as $$
declare i record; s record; o record;
begin
  delete from probe.results where phase = p_phase;
  for i in select name from probe.ids order by name loop
    -- own = org A (every identity's own org), other = org B
    for o in select * from (values
      ('own',   'aaaaaaaa-0000-0000-0000-00000000000a'::uuid, '5a000000-0000-0000-0000-00000000000a'::uuid, '1a000000-0000-0000-0000-00000000000a'::uuid,
                'ea000000-0000-0000-0000-00000000000a'::uuid, 'ca000000-0000-0000-0000-00000000000a'::uuid, 'da000000-0000-0000-0000-00000000000a'::uuid),
      ('other', 'bbbbbbbb-0000-0000-0000-00000000000b'::uuid, '5b000000-0000-0000-0000-00000000000b'::uuid, '1b000000-0000-0000-0000-00000000000b'::uuid,
                'eb000000-0000-0000-0000-00000000000b'::uuid, 'cb000000-0000-0000-0000-00000000000b'::uuid, 'db000000-0000-0000-0000-00000000000b'::uuid)
    ) v(scope, org, seq, step, enr, camp, send) loop
      for s in select * from (values
        ('sequences', 'select', format('select count(*) from public.sequences where id = %L', o.seq)),
        ('sequences', 'insert', format('insert into public.sequences (org_id, name) values (%L, %L)', o.org, 'probe')),
        ('sequences', 'update', format('update public.sequences set name = %L where id = %L', 'probe', o.seq)),
        ('sequences', 'delete', format('delete from public.sequences where id = %L', o.seq)),
        ('sequence_steps', 'select', format('select count(*) from public.sequence_steps where id = %L', o.step)),
        ('sequence_steps', 'insert', format('insert into public.sequence_steps (sequence_id, step_order, channel, body) values (%L, 99, %L, %L)', o.seq, 'email', 'probe')),
        ('sequence_steps', 'update', format('update public.sequence_steps set body = %L where id = %L', 'probe', o.step)),
        ('sequence_steps', 'delete', format('delete from public.sequence_steps where id = %L', o.step)),
        ('sequence_enrollments', 'select', format('select count(*) from public.sequence_enrollments where id = %L', o.enr)),
        ('sequence_enrollments', 'insert', format('insert into public.sequence_enrollments (sequence_id, contact_id) values (%L, gen_random_uuid())', o.seq)),
        ('sequence_enrollments', 'update', format('update public.sequence_enrollments set status = %L where id = %L', 'probe', o.enr)),
        ('sequence_enrollments', 'delete', format('delete from public.sequence_enrollments where id = %L', o.enr)),
        ('email_campaigns', 'select', format('select count(*) from public.email_campaigns where id = %L', o.camp)),
        ('email_campaigns', 'insert', format('insert into public.email_campaigns (org_id, name, subject) values (%L, %L, %L)', o.org, 'probe', 'probe')),
        ('email_campaigns', 'update', format('update public.email_campaigns set subject = %L where id = %L', 'probe', o.camp)),
        ('email_campaigns', 'delete', format('delete from public.email_campaigns where id = %L', o.camp)),
        ('email_sends', 'select', format('select count(*) from public.email_sends where id = %L', o.send)),
        ('email_sends', 'insert', format('insert into public.email_sends (campaign_id, contact_id) values (%L, gen_random_uuid())', o.camp)),
        ('email_sends', 'update', format('update public.email_sends set status = %L where id = %L', 'probe', o.send)),
        ('email_sends', 'delete', format('delete from public.email_sends where id = %L', o.send)),
        -- the assertion: can this identity read the MESSAGE CONTENT behind a send (subject or body)?
        ('email_sends', 'content', format('select count(*) from public.email_sends es join public.email_campaigns ec on ec.id = es.campaign_id where es.id = %L and (ec.subject is not null or ec.body_text is not null)', o.send))
      ) t(tbl, cmd, sql) loop
        perform probe.one(p_phase, i.name, s.tbl, s.cmd, o.scope, s.sql);
      end loop;
    end loop;
  end loop;

  -- the application paths, as staff of org A, against org A (the queries the code sends)
  for i in select name from probe.ids where name in ('staff_a', 'staff_a_no_om') loop
    perform probe.one(p_phase, i.name, 'app', 'crm-client fetchCampaigns', 'app-read', 'select count(*) from public.email_campaigns');
    perform probe.one(p_phase, i.name, 'app', 'crm-client createCampaign', 'app-write', $q$insert into public.email_campaigns (org_id, name, subject) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'n', 's')$q$);
    perform probe.one(p_phase, i.name, 'app', 'crm-client updateCampaign', 'app-write', $q$update public.email_campaigns set subject = 'x' where id = 'ca000000-0000-0000-0000-00000000000a'$q$);
    perform probe.one(p_phase, i.name, 'app', 'crm-client fetchSequences (with steps)', 'app-read', 'select count(*) from public.sequences s join public.sequence_steps st on st.sequence_id = s.id');
    perform probe.one(p_phase, i.name, 'app', 'crm-client fetchEnrollments', 'app-read', 'select count(*) from public.sequence_enrollments e join public.sequences s on s.id = e.sequence_id');
    perform probe.one(p_phase, i.name, 'app', 'crm-client createSequence', 'app-write', $q$insert into public.sequences (org_id, name) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'n')$q$);
    perform probe.one(p_phase, i.name, 'app', 'crm-client createSequenceStep', 'app-write', $q$insert into public.sequence_steps (sequence_id, step_order, channel) values ('5a000000-0000-0000-0000-00000000000a', 5, 'email')$q$);
    perform probe.one(p_phase, i.name, 'app', 'sequences page toggle active', 'app-write', $q$update public.sequences set is_active = false where id = '5a000000-0000-0000-0000-00000000000a'$q$);
    perform probe.one(p_phase, i.name, 'app', 'backup sequences', 'app-read', $q$select count(*) from public.sequences where org_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$q$);
    perform probe.one(p_phase, i.name, 'app', 'contact drawer active sequences', 'app-read', 'select count(*) from public.sequences where is_active');
    perform probe.one(p_phase, i.name, 'app', 'campaigns page email campaigns', 'app-read', $q$select count(*) from public.email_campaigns where org_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$q$);
    perform probe.one(p_phase, i.name, 'app', 'enroll: read sequence', 'app-read', $q$select count(*) from public.sequences where id = '5a000000-0000-0000-0000-00000000000a'$q$);
    perform probe.one(p_phase, i.name, 'app', 'enroll: AI review read', 'app-read', $q$select count(*) from public.sequence_steps where sequence_id = '5a000000-0000-0000-0000-00000000000a' and ai_run_id is not null and ai_reviewed_at is null$q$);
    perform probe.one(p_phase, i.name, 'app', 'enroll: existing enrollment', 'app-read', $q$select count(*) from public.sequence_enrollments where sequence_id = '5a000000-0000-0000-0000-00000000000a'$q$);
    perform probe.one(p_phase, i.name, 'app', 'enroll: first step', 'app-read', $q$select count(*) from public.sequence_steps where sequence_id = '5a000000-0000-0000-0000-00000000000a' and step_order = 1$q$);
    perform probe.one(p_phase, i.name, 'app', 'enroll: insert enrollment', 'app-write', $q$insert into public.sequence_enrollments (sequence_id, contact_id, current_step, status) values ('5a000000-0000-0000-0000-00000000000a', gen_random_uuid(), 1, 'active')$q$);
    perform probe.one(p_phase, i.name, 'app', 'email/send insert (as written)', 'app-write', $q$insert into public.email_sends (contact_id, to_email, status) values (gen_random_uuid(), 'x@probe.invalid', 'sending')$q$);
    perform probe.one(p_phase, i.name, 'app', 'email/send update (as written)', 'app-write', $q$update public.email_sends set status = 'sent', provider_message_id = 'p', error_message = null, sent_at = now() where id = 'da000000-0000-0000-0000-00000000000a'$q$);
    -- the same update without the column the code names wrongly: what RLS alone allows
    perform probe.one(p_phase, i.name, 'app', 'email/send update (status only)', 'app-write', $q$update public.email_sends set status = 'sent' where id = 'da000000-0000-0000-0000-00000000000a'$q$);
  end loop;
end $$;
