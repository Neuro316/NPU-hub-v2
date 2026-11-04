-- scripts/scheduling/check-tests.sql
-- Tests for public.hub_sched_check against Cameron's rules (hub_218, recurring spans hub_219).
--
-- Run it as ONE statement (Supabase SQL editor, or the connector's execute_sql). It
-- ALWAYS ends by raising an exception, so every fixture it creates or changes is rolled
-- back and nothing persists. Read the result from the error text:
--   HUB_SCHED_TESTS PASS n/n            every case passed
--   HUB_SCHED_TESTS FAIL k/n: ...       the failing cases, expected vs actual
-- All times are America/New_York. 2026-11-04 and 2026-11-05 are ordinary school days.
--
-- Phases (each sets its fixtures, then runs its cases):
--   0  the migrated Cormac row as stored: its fields, and that it blocks exactly as before
--   1  the original hub_218 cases (one-off block, Cormac moved to 15:00-17:00, a skip)
--   2  span model: every other week, Wed..Wed from 2026-11-04, Mon-Fri 15:00-16:00
--   3  different first-day and last-day times on an 8-day span
--   4  skip_span and add_span
do $tests$
declare
  v_owner  uuid;
  v_cormac uuid;
  v_x      uuid;
  v_y      uuid;
  v_total  int := 0;
  v_fail   text[] := '{}';
  v_phase  int;
  r        record;
  c        record;
  cm       record;
begin
  select u.id into v_owner from auth.users u where lower(u.email) = 'cameron@neuroprogeny.com';
  if v_owner is null then raise exception 'HUB_SCHED_TESTS ERROR: Cameron not found'; end if;
  select * into cm from public.hub_sched_recurring_blocks where owner_user_id = v_owner and name = 'Cormac';
  v_cormac := cm.id;

  for v_phase in 0 .. 4 loop

    -- ── fixtures ──
    if v_phase = 0 then
      v_total := v_total + 1;
      if not (cm.active and cm.anchor_date = '2026-11-04' and cm.repeat = 'every_other_week' and cm.interval_weeks = 2
              and cm.from_weekday = 3 and cm.to_weekday = 2 and cm.days = array[3]::smallint[]
              and cm.start_time = '14:00' and cm.end_time = '15:30' and not cm.all_day and not cm.per_day_times
              and cm.categories is null) then
        v_fail := v_fail || format('migrated Cormac fields: got active=%s anchor=%s repeat=%s every=%s from=%s to=%s days=%s %s-%s all_day=%s per_day=%s',
          cm.active, cm.anchor_date, cm.repeat, cm.interval_weeks, cm.from_weekday, cm.to_weekday, cm.days,
          cm.start_time, cm.end_time, cm.all_day, cm.per_day_times);
      end if;
    elsif v_phase = 1 then
      insert into public.hub_sched_one_off_blocks (owner_user_id, starts_at, ends_at, label, source, created_by)
      values (v_owner, '2026-11-05 15:00 America/New_York', '2026-11-05 16:00 America/New_York', 'test block', 'page', 'check-tests');
      update public.hub_sched_recurring_blocks
         set active = true, anchor_date = '2026-11-04', start_time = '15:00', end_time = '17:00'
       where id = v_cormac;
      insert into public.hub_sched_recurring_overrides (block_id, owner_user_id, date, kind)
      values (v_cormac, v_owner, '2026-12-16', 'skip');
    elsif v_phase = 2 then
      delete from public.hub_sched_one_off_blocks where owner_user_id = v_owner and created_by = 'check-tests';
      insert into public.hub_sched_recurring_blocks
        (owner_user_id, name, active, anchor_date, repeat, interval_weeks, from_weekday, to_weekday, days, start_time, end_time, categories)
      values (v_owner, 'test span X', true, '2026-11-04', 'every_other_week', 2, 3, 3, array[1,2,3,4,5]::smallint[], '15:00', '16:00', array['team_familiar'])
      returning id into v_x;
    elsif v_phase = 3 then
      insert into public.hub_sched_recurring_blocks
        (owner_user_id, name, active, anchor_date, repeat, interval_weeks, from_weekday, to_weekday, days, per_day_times, categories)
      values (v_owner, 'test span Y', true, '2026-12-09', 'every_other_week', 2, 3, 3, array[3]::smallint[], true, array['group_coaching'])
      returning id into v_y;
      insert into public.hub_sched_recurring_block_days (block_id, owner_user_id, span_offset, all_day, start_time, end_time) values
        (v_y, v_owner, 0, false, '13:30', '14:30'),
        (v_y, v_owner, 7, false, '16:00', '17:00');
    elsif v_phase = 4 then
      insert into public.hub_sched_recurring_overrides (block_id, owner_user_id, date, kind) values
        (v_x, v_owner, '2026-11-18', 'skip_span'),
        (v_x, v_owner, '2026-11-11', 'add_span');
    end if;

    -- ── cases ──
    for c in
      select * from (values
        -- phase 0: migrated Cormac, every other Wednesday from 2026-11-04, 14:00-15:30
        (0, 'migrated Cormac blocks Wed 2026-11-04 14:00',        'team_familiar',  '2026-11-04 14:00', '2026-11-04 14:30', false, 'recurring_block'),
        (0, 'migrated Cormac blocks Wed 2026-11-18 14:30',        'team_familiar',  '2026-11-18 14:30', '2026-11-18 15:00', false, 'recurring_block'),
        (0, 'migrated Cormac leaves Wed 2026-11-11 (off week)',   'team_familiar',  '2026-11-11 14:30', '2026-11-11 15:00', true,  'ok'),
        (0, 'migrated Cormac leaves Wed 2026-11-25 (off week)',   'team_familiar',  '2026-11-25 14:30', '2026-11-25 15:00', true,  'ok'),
        (0, 'migrated Cormac leaves 2026-11-18 15:30 (after it)', 'team_familiar',  '2026-11-18 15:30', '2026-11-18 16:00', true,  'ok'),
        (0, 'migrated Cormac leaves Thu 2026-11-05',              'team_familiar',  '2026-11-05 14:30', '2026-11-05 15:00', true,  'ok'),
        -- phase 1: the original hub_218 cases
        (1, 'podcast at 12:00 on a school day is refused (pickup)',      'podcast',        '2026-11-04 12:00', '2026-11-04 12:30', false, 'blocked_window'),
        (1, 'discovery call on 2026-11-11 is refused (kids home)',       'one_on_one',     '2026-11-11 10:00', '2026-11-11 10:30', false, 'kids_home'),
        (1, 'group coaching at 14:00 on 2026-11-11 is allowed',          'group_coaching', '2026-11-11 14:00', '2026-11-11 14:30', true,  'ok'),
        (1, 'one_on_one at 7:30 is refused',                             'one_on_one',     '2026-11-04 07:30', '2026-11-04 08:00', false, 'before_earliest_start'),
        (1, 'team_familiar at 7:30 is refused',                          'team_familiar',  '2026-11-04 07:30', '2026-11-04 08:00', false, 'before_earliest_start'),
        (1, 'group_coaching at 7:30 on a kids-home day is refused',      'group_coaching', '2026-11-11 07:30', '2026-11-11 08:00', false, 'before_earliest_start'),
        (1, 'one_on_one at 14:00 on 2027-02-25 is refused',              'one_on_one',     '2027-02-25 14:00', '2027-02-25 14:30', false, 'kids_home'),
        (1, 'one_on_one on 2027-06-02 is refused (summer)',              'one_on_one',     '2027-06-02 10:00', '2027-06-02 10:30', false, 'summer_rules_undefined'),
        (1, 'team_familiar on 2027-06-02 is refused (summer)',           'team_familiar',  '2027-06-02 15:00', '2027-06-02 15:30', false, 'summer_rules_undefined'),
        (1, 'a one-off block refuses a time it covers',                  'one_on_one',     '2026-11-05 15:15', '2026-11-05 15:45', false, 'one_off_block'),
        (1, 'one_on_one at 9:00 on a school day is allowed',             'one_on_one',     '2026-11-04 09:00', '2026-11-04 10:00', true,  'ok'),
        (1, 'one_on_one at 13:30 on 2026-11-05 is allowed',              'one_on_one',     '2026-11-05 13:30', '2026-11-05 14:30', true,  'ok'),
        (1, 'one_on_one ending at 11:30 is allowed',                     'one_on_one',     '2026-11-04 11:00', '2026-11-04 11:30', true,  'ok'),
        (1, 'one_on_one crossing 11:30 is refused (pickup)',             'one_on_one',     '2026-11-04 11:00', '2026-11-04 12:00', false, 'blocked_window'),
        (1, 'podcast at 14:00 on a school day is refused',               'podcast',        '2026-11-05 14:00', '2026-11-05 14:30', false, 'outside_window'),
        (1, 'team_familiar at 12:00 on a school day is refused',         'team_familiar',  '2026-11-05 12:00', '2026-11-05 12:30', false, 'blocked_window'),
        (1, 'team_familiar at 12:00 on 2026-11-11 is allowed',           'team_familiar',  '2026-11-11 12:00', '2026-11-11 12:30', true,  'ok'),
        (1, 'group_coaching at 10:00 on 2026-11-11 is refused',          'group_coaching', '2026-11-11 10:00', '2026-11-11 10:30', false, 'outside_window'),
        (1, 'one_on_one at 9:00 on half day 2027-02-25 is allowed',      'one_on_one',     '2027-02-25 09:00', '2027-02-25 10:00', true,  'ok'),
        (1, 'team_familiar on a Saturday is refused',                    'team_familiar',  '2026-11-07 10:00', '2026-11-07 10:30', false, 'weekend'),
        (1, 'a one-off block leaves the next hour alone',                'one_on_one',     '2026-11-05 16:00', '2026-11-05 16:30', true,  'ok'),
        (1, 'Cormac (every other Wed from 11-04) refuses 2026-11-18',    'team_familiar',  '2026-11-18 15:30', '2026-11-18 16:00', false, 'recurring_block'),
        (1, 'Cormac does not fall on 2026-12-09 (odd week)',             'team_familiar',  '2026-12-09 15:30', '2026-12-09 16:00', true,  'ok'),
        (1, 'Cormac skip override frees 2026-12-16',                     'team_familiar',  '2026-12-16 15:30', '2026-12-16 16:00', true,  'ok'),
        (1, 'ending after midnight is refused',                          'team_familiar',  '2026-11-04 16:30', '2026-11-05 00:30', false, 'spans_days'),
        (1, 'unknown category is refused',                               'board_meeting',  '2026-11-04 09:00', '2026-11-04 09:30', false, 'invalid_request'),
        -- phase 2: X = every other week, Wed..Wed from 2026-11-04, Mon-Fri 15:00-16:00
        (2, 'span X blocks Thu 2026-11-05 15:30',                        'team_familiar',  '2026-11-05 15:30', '2026-11-05 16:00', false, 'recurring_block'),
        (2, 'span X blocks Wed 2026-11-11 15:30 (last day of span)',     'team_familiar',  '2026-11-11 15:30', '2026-11-11 16:00', false, 'recurring_block'),
        (2, 'span X leaves Thu 2026-11-12 15:30 (off week)',             'team_familiar',  '2026-11-12 15:30', '2026-11-12 16:00', true,  'ok'),
        (2, 'span X blocks Thu 2026-11-19 15:30 (next span)',            'team_familiar',  '2026-11-19 15:30', '2026-11-19 16:00', false, 'recurring_block'),
        (2, 'span X leaves Thu 2026-11-05 16:00 (after its window)',     'team_familiar',  '2026-11-05 16:00', '2026-11-05 16:30', true,  'ok'),
        (2, 'span X only applies to its categories',                     'one_on_one',     '2026-11-05 15:00', '2026-11-05 15:30', true,  'ok'),
        -- phase 3: Y = Wed..Wed from 2026-12-09, Wednesdays only; first day 13:30-14:30, last day 16:00-17:00
        (3, 'span Y first Wednesday 14:00 is blocked',                   'group_coaching', '2026-12-09 14:00', '2026-12-09 14:30', false, 'recurring_block'),
        (3, 'span Y first Wednesday 16:00 is free',                      'group_coaching', '2026-12-09 16:00', '2026-12-09 16:30', true,  'ok'),
        (3, 'span Y last Wednesday 16:15 is blocked',                    'group_coaching', '2026-12-16 16:15', '2026-12-16 16:45', false, 'recurring_block'),
        (3, 'span Y last Wednesday 14:00 is free',                       'group_coaching', '2026-12-16 14:00', '2026-12-16 14:30', true,  'ok'),
        -- phase 4: X with skip_span 2026-11-18 and add_span 2026-11-11
        (4, 'skip_span 2026-11-18 frees Thu 2026-11-19',                 'team_familiar',  '2026-11-19 15:30', '2026-11-19 16:00', true,  'ok'),
        (4, 'add_span 2026-11-11 blocks Thu 2026-11-12',                 'team_familiar',  '2026-11-12 15:30', '2026-11-12 16:00', false, 'recurring_block'),
        (4, 'regular span 2026-11-04 still blocks Thu 2026-11-05',       'team_familiar',  '2026-11-05 15:30', '2026-11-05 16:00', false, 'recurring_block')
      ) t(phase, name, category, s, e, want_allowed, want_reason)
      where t.phase = v_phase
    loop
      v_total := v_total + 1;
      select * into r from public.hub_sched_check(
        v_owner, c.category,
        (c.s || ' America/New_York')::timestamptz, (c.e || ' America/New_York')::timestamptz);
      if r.allowed is distinct from c.want_allowed or r.reason is distinct from c.want_reason then
        v_fail := v_fail || format('[%s] %s: want %s/%s, got %s/%s', v_phase, c.name, c.want_allowed, c.want_reason, r.allowed, r.reason);
      end if;
    end loop;
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
