-- scripts/scheduling/check-tests.sql
-- Tests for public.hub_sched_check against Cameron's seeded rules (hub_218).
--
-- Run it as ONE statement (Supabase SQL editor, or the connector's execute_sql). It
-- ALWAYS ends by raising an exception, so the fixtures it creates (a one-off block,
-- an activated Cormac block with an override) are rolled back and nothing persists.
-- Read the result from the error text:
--   HUB_SCHED_TESTS PASS n/n            every case passed
--   HUB_SCHED_TESTS FAIL k/n: ...       the failing cases, expected vs actual
-- All times are America/New_York. 2026-11-04 and 2026-11-05 are ordinary school days.
do $tests$
declare
  v_owner uuid;
  v_block uuid;
  v_total int := 0;
  v_fail  text[] := '{}';
  r       record;

  -- name, category, local start, local end, expected allowed, expected reason
  c record;
begin
  select u.id into v_owner from auth.users u where lower(u.email) = 'cameron@neuroprogeny.com';
  if v_owner is null then raise exception 'HUB_SCHED_TESTS ERROR: Cameron not found'; end if;

  -- fixtures (rolled back by the final raise)
  insert into public.hub_sched_one_off_blocks (owner_user_id, starts_at, ends_at, label, source, created_by)
  values (v_owner, '2026-11-05 15:00 America/New_York', '2026-11-05 16:00 America/New_York', 'test block', 'page', 'check-tests');

  update public.hub_sched_recurring_blocks
     set active = true, anchor_date = '2026-11-04', start_time = '15:00', end_time = '17:00'
   where owner_user_id = v_owner and name = 'Cormac'
  returning id into v_block;
  insert into public.hub_sched_recurring_overrides (block_id, owner_user_id, date, kind)
  values (v_block, v_owner, '2026-12-16', 'skip');

  for c in
    select * from (values
      -- the eight required cases
      ('podcast at 12:00 on a school day is refused (pickup)',      'podcast',        '2026-11-04 12:00', '2026-11-04 12:30', false, 'blocked_window'),
      ('discovery call on 2026-11-11 is refused (kids home)',       'one_on_one',     '2026-11-11 10:00', '2026-11-11 10:30', false, 'kids_home'),
      ('group coaching at 14:00 on 2026-11-11 is allowed',          'group_coaching', '2026-11-11 14:00', '2026-11-11 14:30', true,  'ok'),
      ('one_on_one at 7:30 is refused',                             'one_on_one',     '2026-11-04 07:30', '2026-11-04 08:00', false, 'before_earliest_start'),
      ('team_familiar at 7:30 is refused',                          'team_familiar',  '2026-11-04 07:30', '2026-11-04 08:00', false, 'before_earliest_start'),
      ('group_coaching at 7:30 on a kids-home day is refused',      'group_coaching', '2026-11-11 07:30', '2026-11-11 08:00', false, 'before_earliest_start'),
      ('one_on_one at 14:00 on 2027-02-25 is refused',              'one_on_one',     '2027-02-25 14:00', '2027-02-25 14:30', false, 'kids_home'),
      ('one_on_one on 2027-06-02 is refused (summer)',              'one_on_one',     '2027-06-02 10:00', '2027-06-02 10:30', false, 'summer_rules_undefined'),
      ('team_familiar on 2027-06-02 is refused (summer)',           'team_familiar',  '2027-06-02 15:00', '2027-06-02 15:30', false, 'summer_rules_undefined'),
      ('a one-off block refuses a time it covers',                  'one_on_one',     '2026-11-05 15:15', '2026-11-05 15:45', false, 'one_off_block'),
      -- controls
      ('one_on_one at 9:00 on a school day is allowed',             'one_on_one',     '2026-11-04 09:00', '2026-11-04 10:00', true,  'ok'),
      ('one_on_one at 13:30 on 2026-11-05 is allowed',              'one_on_one',     '2026-11-05 13:30', '2026-11-05 14:30', true,  'ok'),
      ('one_on_one ending at 11:30 is allowed',                     'one_on_one',     '2026-11-04 11:00', '2026-11-04 11:30', true,  'ok'),
      ('one_on_one crossing 11:30 is refused (pickup)',             'one_on_one',     '2026-11-04 11:00', '2026-11-04 12:00', false, 'blocked_window'),
      ('podcast at 14:00 on a school day is refused',               'podcast',        '2026-11-05 14:00', '2026-11-05 14:30', false, 'outside_window'),
      ('team_familiar at 12:00 on a school day is refused',         'team_familiar',  '2026-11-05 12:00', '2026-11-05 12:30', false, 'blocked_window'),
      ('team_familiar at 12:00 on 2026-11-11 is allowed',           'team_familiar',  '2026-11-11 12:00', '2026-11-11 12:30', true,  'ok'),
      ('group_coaching at 10:00 on 2026-11-11 is refused',          'group_coaching', '2026-11-11 10:00', '2026-11-11 10:30', false, 'outside_window'),
      ('one_on_one at 9:00 on half day 2027-02-25 is allowed',      'one_on_one',     '2027-02-25 09:00', '2027-02-25 10:00', true,  'ok'),
      ('team_familiar on a Saturday is refused',                    'team_familiar',  '2026-11-07 10:00', '2026-11-07 10:30', false, 'weekend'),
      ('a one-off block leaves the next hour alone',                'one_on_one',     '2026-11-05 16:00', '2026-11-05 16:30', true,  'ok'),
      ('Cormac (every other Wed from 11-04) refuses 2026-11-18',    'team_familiar',  '2026-11-18 15:30', '2026-11-18 16:00', false, 'recurring_block'),
      ('Cormac does not fall on 2026-12-09 (odd week)',             'team_familiar',  '2026-12-09 15:30', '2026-12-09 16:00', true,  'ok'),
      ('Cormac skip override frees 2026-12-16',                     'team_familiar',  '2026-12-16 15:30', '2026-12-16 16:00', true,  'ok'),
      ('ending after midnight is refused',                          'team_familiar',  '2026-11-04 16:30', '2026-11-05 00:30', false, 'spans_days'),
      ('unknown category is refused',                               'board_meeting',  '2026-11-04 09:00', '2026-11-04 09:30', false, 'invalid_request')
    ) t(name, category, s, e, want_allowed, want_reason)
  loop
    v_total := v_total + 1;
    select * into r from public.hub_sched_check(
      v_owner, c.category,
      (c.s || ' America/New_York')::timestamptz, (c.e || ' America/New_York')::timestamptz);
    if r.allowed is distinct from c.want_allowed or r.reason is distinct from c.want_reason then
      v_fail := v_fail || format('%s: want %s/%s, got %s/%s', c.name, c.want_allowed, c.want_reason, r.allowed, r.reason);
    end if;
  end loop;

  -- a user with no rules: every check is no_rules_set
  v_total := v_total + 1;
  select * into r from public.hub_sched_check(gen_random_uuid(), 'team_familiar',
    '2026-11-04 10:00 America/New_York', '2026-11-04 10:30 America/New_York');
  if r.allowed or r.reason is distinct from 'no_rules_set' then
    v_fail := v_fail || format('user with no rules: want false/no_rules_set, got %s/%s', r.allowed, r.reason);
  end if;

  if cardinality(v_fail) = 0 then
    raise exception 'HUB_SCHED_TESTS PASS %/%', v_total, v_total;
  end if;
  raise exception 'HUB_SCHED_TESTS FAIL %/%: %', cardinality(v_fail), v_total, array_to_string(v_fail, ' | ');
end
$tests$;
