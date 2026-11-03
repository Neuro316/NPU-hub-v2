-- hub_219_recurring_spans.sql
--
-- STATUS: APPLIED to production (htfrfaxlcuyawtlztxxm) on 2026-11-02 through the Supabase
-- connector as hub_219_recurring_spans, ledger version 20261103004445. Never applied to
-- npu-platform-nonprod. Cormac converted Wed..Tue, days {Wed}, 14:00-15:30, every other
-- week (ruled at the go). Access verified: RLS on, no policies, anon/authenticated have no
-- table or function privileges. scripts/scheduling/check-tests.sql: PASS 47/47, rolled back.
--
-- Hub band (200+). Checked 2026-11-02: the ledger stops at hub_218. This is 219.
--
-- PURPOSE: recurring blocks become custody-style SPANS (docs/plans/hub-recurring-spans-rulings.md).
-- One block = a repeat pattern + a span of days + which weekdays in it are blocked + times.
--
--   repeat          weekly | every_other_week | custom; interval_weeks is 1, 2, or N (1..52)
--   from_weekday    ISO 1..7; the span starts on this weekday (was `weekday`, renamed)
--   to_weekday      ISO 1..7; the span runs forward to the next to_weekday. Same day as
--                   from_weekday = 8 days including both (Wed..Wed); Wed..Tue = 7 days
--   anchor_date     must fall on from_weekday; spans start there, then every interval_weeks
--                   weeks. NO spans before the anchor.
--   days            ISO weekdays inside the span that are blocked (default all 7)
--   all_day         the chosen days are blocked all day (shared mode)
--   start/end_time  one window for all chosen days (shared mode)
--   per_day_times   when true, times come from hub_sched_recurring_block_days, one row per
--                   span offset (0 = first day of the span ... 7 = last day of an 8-day span),
--                   so the two Wednesdays of a Wed..Wed span can differ. An offset with no
--                   row falls back to the shared times, and with none of those, all day.
--
-- Overrides gain two span-level kinds (date = the span's first day):
--   skip_span   no occurrence for the whole span starting that date
--   add_span    an extra span starting that date, with the block's days and times
-- Date-level skip / add / change win over spans on their date. A span-level and a
-- date-level override may now share a date (unique on block, date, scope).
--
-- DATA: every existing row converts exactly. The only row today is Cormac (Cameron):
-- active, anchor 2026-11-04, every 2 weeks, Wednesday, 14:00-15:30, all categories,
-- no overrides. It becomes repeat every_other_week, from Wednesday TO TUESDAY (a 7-day
-- span), days {Wednesday}, 14:00-15:30: the same Wednesdays (Nov 4, Nov 18, ...) as
-- before. ⚠ Converting it to Wednesday-to-WEDNESDAY with days {Wednesday} would ALSO
-- block the span's last Wednesday (Nov 11, Nov 25, ...), i.e. every Wednesday, which
-- is not "behaves exactly as before". See the plan doc; the go decides.
-- The one behaviour change for any row: occurrences BEFORE the anchor date no longer
-- exist (the old model counted both directions). For Cormac that only removes
-- Wednesdays before 2026-11-04, none of which is still ahead on 2026-11-02.
--
-- hub_sched_check keeps its signature and reason codes; only how recurring_block is
-- decided changes, now in public.hub_sched_recurring_blocked (service role only).
--
-- ACCESS: RLS on with no policies on the new table; anon and authenticated have no
-- privileges; service_role only, as for every hub_sched_* table.
--
-- ROLLBACK (only while no row uses a span feature; restores the hub_218 function):
--   begin;
--   drop function if exists public.hub_sched_recurring_blocked(uuid, text, date, time, time);
--   drop table if exists public.hub_sched_recurring_block_days;
--   delete from public.hub_sched_recurring_overrides where kind in ('skip_span', 'add_span');
--   alter table public.hub_sched_recurring_overrides drop constraint hub_sched_recurring_overrides_block_date_scope_key,
--     drop column scope, drop constraint hub_sched_recurring_overrides_kind_check,
--     add constraint hub_sched_recurring_overrides_kind_check check (kind in ('skip', 'add', 'change')),
--     add constraint hub_sched_recurring_overrides_block_id_date_key unique (block_id, date);
--   alter table public.hub_sched_recurring_blocks drop constraint hub_sched_recurring_blocks_repeat_check,
--     drop constraint hub_sched_recurring_blocks_days_check, drop constraint hub_sched_recurring_blocks_times_check,
--     drop constraint hub_sched_recurring_blocks_active_check,
--     drop column repeat, drop column to_weekday, drop column days, drop column all_day, drop column per_day_times;
--   alter table public.hub_sched_recurring_blocks rename column from_weekday to weekday;
--   alter table public.hub_sched_recurring_blocks add constraint hub_sched_recurring_blocks_check2
--     check (not active or (anchor_date is not null and start_time is not null and end_time is not null));
--   -- then re-run the hub_sched_check definition from hub_218
--   delete from supabase_migrations.schema_migrations where name = 'hub_219_recurring_spans';
--   commit;

begin;

-- ─── blocks: the span model ──────────────────────────────────────────────────
alter table public.hub_sched_recurring_blocks rename column weekday to from_weekday;

alter table public.hub_sched_recurring_blocks
  add column repeat        text,
  add column to_weekday    smallint,
  add column days          smallint[] not null default '{1,2,3,4,5,6,7}',
  add column all_day       boolean not null default false,
  add column per_day_times boolean not null default false;

-- exact conversion of existing rows (old model = one weekday per occurrence)
update public.hub_sched_recurring_blocks
   set repeat     = case interval_weeks when 1 then 'weekly' when 2 then 'every_other_week' else 'custom' end,
       to_weekday = case when from_weekday = 1 then 7 else from_weekday - 1 end,   -- 7-day span
       days       = array[from_weekday];

alter table public.hub_sched_recurring_blocks
  alter column repeat set not null,
  alter column repeat set default 'weekly',
  alter column to_weekday set not null,
  alter column to_weekday set default 7,
  add constraint hub_sched_recurring_blocks_to_weekday_check check (to_weekday between 1 and 7),
  add constraint hub_sched_recurring_blocks_repeat_check check (
       (repeat = 'weekly' and interval_weeks = 1)
    or (repeat = 'every_other_week' and interval_weeks = 2)
    or (repeat = 'custom' and interval_weeks between 1 and 52)),
  add constraint hub_sched_recurring_blocks_days_check check (
    cardinality(days) between 1 and 7 and days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  add constraint hub_sched_recurring_blocks_times_check check (
    not all_day or (start_time is null and end_time is null));

-- "active needs an anchor and times" now allows all-day and per-day times
alter table public.hub_sched_recurring_blocks drop constraint hub_sched_recurring_blocks_check2;
alter table public.hub_sched_recurring_blocks
  add constraint hub_sched_recurring_blocks_active_check check (
    not active or (anchor_date is not null
                   and (all_day or per_day_times or (start_time is not null and end_time is not null))));

-- ─── per-day times (per span offset) ─────────────────────────────────────────
create table public.hub_sched_recurring_block_days (
  block_id       uuid not null,
  owner_user_id  uuid not null,
  span_offset    smallint not null check (span_offset between 0 and 7),
  all_day        boolean not null default false,
  start_time     time,
  end_time       time,
  primary key (block_id, span_offset),
  foreign key (block_id, owner_user_id) references public.hub_sched_recurring_blocks (id, owner_user_id) on delete cascade,
  check ((all_day and start_time is null and end_time is null)
      or (not all_day and start_time is not null and end_time is not null and end_time > start_time))
);

alter table public.hub_sched_recurring_block_days enable row level security;
revoke all on public.hub_sched_recurring_block_days from public, anon, authenticated;
grant all on public.hub_sched_recurring_block_days to service_role;

-- ─── overrides: span-level kinds ─────────────────────────────────────────────
alter table public.hub_sched_recurring_overrides drop constraint hub_sched_recurring_overrides_kind_check;
alter table public.hub_sched_recurring_overrides drop constraint hub_sched_recurring_overrides_block_id_date_key;
alter table public.hub_sched_recurring_overrides
  add column scope text generated always as (case when kind in ('skip_span', 'add_span') then 'span' else 'date' end) stored;
alter table public.hub_sched_recurring_overrides
  add constraint hub_sched_recurring_overrides_kind_check
    check (kind in ('skip', 'add', 'change', 'skip_span', 'add_span')),
  add constraint hub_sched_recurring_overrides_block_date_scope_key unique (block_id, date, scope),
  add constraint hub_sched_recurring_overrides_span_times_check
    check (kind not in ('skip_span', 'add_span') or (start_time is null and end_time is null));

-- ─── is a time on a date blocked by any recurring block? ─────────────────────
create function public.hub_sched_recurring_blocked(
  p_owner uuid, p_category text, p_date date, p_start time, p_end time
) returns boolean
language plpgsql
stable
set search_path to ''
as $function$
declare
  b        record;
  o        record;
  d        record;
  v_len    int;
  v_off    int;
  v_span   date;
  v_dow    int := extract(isodow from p_date)::int;
  v_all    boolean;
  v_s      time;
  v_e      time;
begin
  for b in
    select * from public.hub_sched_recurring_blocks rb
     where rb.owner_user_id = p_owner and rb.active
       and (rb.categories is null or p_category = any (rb.categories))
  loop
    -- a date-level override decides its date outright
    select * into o from public.hub_sched_recurring_overrides x
     where x.block_id = b.id and x.date = p_date and x.scope = 'date';
    if found then
      if o.kind = 'skip' then continue; end if;
      v_s := coalesce(o.start_time, b.start_time);
      v_e := coalesce(o.end_time, b.end_time);
      if o.start_time is null and (b.all_day or v_s is null or v_e is null) then return true; end if;
      if v_s < p_end and v_e > p_start then return true; end if;
      continue;
    end if;

    if not (v_dow = any (b.days)) then continue; end if;
    v_len := case when b.to_weekday = b.from_weekday then 8 else ((b.to_weekday - b.from_weekday + 7) % 7) + 1 end;

    for v_off in 0 .. v_len - 1 loop
      v_span := p_date - v_off;
      if not (
           (v_span >= b.anchor_date
            and ((v_span - b.anchor_date) % (7 * b.interval_weeks)) = 0
            and not exists (select 1 from public.hub_sched_recurring_overrides x
                             where x.block_id = b.id and x.date = v_span and x.kind = 'skip_span'))
        or exists (select 1 from public.hub_sched_recurring_overrides x
                    where x.block_id = b.id and x.date = v_span and x.kind = 'add_span')
      ) then
        continue;
      end if;

      -- times for this day of the span
      v_all := b.all_day; v_s := b.start_time; v_e := b.end_time;
      if b.per_day_times then
        select * into d from public.hub_sched_recurring_block_days y
         where y.block_id = b.id and y.span_offset = v_off;
        if found then v_all := d.all_day; v_s := d.start_time; v_e := d.end_time; end if;
      end if;
      if v_all or v_s is null or v_e is null then return true; end if;
      if v_s < p_end and v_e > p_start then return true; end if;
    end loop;
  end loop;
  return false;
end
$function$;

revoke all on function public.hub_sched_recurring_blocked(uuid, text, date, time, time) from public, anon, authenticated;
grant execute on function public.hub_sched_recurring_blocked(uuid, text, date, time, time) to service_role;

-- ─── hub_sched_check: same signature and reason codes; recurring via the helper ─
create or replace function public.hub_sched_check(
  p_owner uuid, p_category text, p_starts_at timestamptz, p_ends_at timestamptz,
  out allowed boolean, out reason text
)
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_tz        text;
  v_earliest  time;
  v_year_end  date;
  v_ls        timestamp;
  v_le        timestamp;
  v_d         date;
  v_st        time;
  v_et        time;
  v_dow       int;
  v_from      time;
  v_kh_found  boolean;
  v_kinds     text[] := '{}';
  v_ss        time[] := '{}';
  v_es        time[] := '{}';
  i           int;
begin
  allowed := false;

  if p_owner is null or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or p_category is null
     or p_category not in ('one_on_one', 'podcast', 'in_person', 'group_coaching', 'team_familiar') then
    reason := 'invalid_request'; return;
  end if;

  if not exists (select 1 from public.hub_sched_category_windows w where w.owner_user_id = p_owner) then
    reason := 'no_rules_set'; return;
  end if;

  select s.timezone, s.earliest_start, s.school_year_end
    into v_tz, v_earliest, v_year_end
    from public.hub_sched_settings s where s.owner_user_id = p_owner;
  v_tz := coalesce(v_tz, 'America/New_York');
  v_earliest := coalesce(v_earliest, '08:00'::time);

  v_ls := p_starts_at at time zone v_tz;
  v_le := p_ends_at at time zone v_tz;
  v_d := v_ls::date;
  v_st := v_ls::time;
  v_et := v_le::time;
  v_dow := extract(isodow from v_d)::int;

  if v_le::date <> v_d then reason := 'spans_days'; return; end if;
  if v_st < v_earliest then reason := 'before_earliest_start'; return; end if;

  if v_dow >= 6 then
    v_kinds := array['weekend']; v_ss := array[v_st]; v_es := array[v_et];
  elsif v_year_end is not null and v_d > v_year_end then
    if not exists (select 1 from public.hub_sched_category_windows w
                    where w.owner_user_id = p_owner and w.day_kind = 'summer') then
      reason := 'summer_rules_undefined'; return;
    end if;
    v_kinds := array['summer']; v_ss := array[v_st]; v_es := array[v_et];
  else
    select true, k.from_time into v_kh_found, v_from
      from public.hub_sched_kids_home_dates k
     where k.owner_user_id = p_owner and k.date = v_d;
    if v_kh_found is null then
      v_kinds := array['school']; v_ss := array[v_st]; v_es := array[v_et];
    elsif v_from is null then
      v_kinds := array['kids_home']; v_ss := array[v_st]; v_es := array[v_et];
    else
      if v_st < v_from then
        v_kinds := v_kinds || 'school'::text; v_ss := v_ss || v_st; v_es := v_es || least(v_et, v_from);
      end if;
      if v_et > v_from then
        v_kinds := v_kinds || 'kids_home'::text; v_ss := v_ss || greatest(v_st, v_from); v_es := v_es || v_et;
      end if;
    end if;
  end if;

  if exists (select 1 from public.hub_sched_one_off_blocks b
              where b.owner_user_id = p_owner
                and (b.categories is null or p_category = any (b.categories))
                and b.starts_at < p_ends_at and b.ends_at > p_starts_at) then
    reason := 'one_off_block'; return;
  end if;

  if public.hub_sched_recurring_blocked(p_owner, p_category, v_d, v_st, v_et) then
    reason := 'recurring_block'; return;
  end if;

  for i in 1 .. coalesce(array_length(v_kinds, 1), 0) loop
    if exists (select 1 from public.hub_sched_blocked_windows b
                where b.owner_user_id = p_owner and b.day_kind = v_kinds[i]
                  and (b.categories is null or p_category = any (b.categories))
                  and b.start_time < v_es[i] and b.end_time > v_ss[i]) then
      reason := 'blocked_window'; return;
    end if;
  end loop;

  for i in 1 .. coalesce(array_length(v_kinds, 1), 0) loop
    if not exists (select 1 from public.hub_sched_category_windows w
                    where w.owner_user_id = p_owner and w.category = p_category and w.day_kind = v_kinds[i]
                      and w.start_time <= v_ss[i] and w.end_time >= v_es[i]) then
      if v_kinds[i] in ('kids_home', 'weekend')
         and not exists (select 1 from public.hub_sched_category_windows w
                          where w.owner_user_id = p_owner and w.category = p_category and w.day_kind = v_kinds[i]) then
        reason := v_kinds[i];
      else
        reason := 'outside_window';
      end if;
      return;
    end if;
  end loop;

  allowed := true;
  reason := 'ok';
end
$function$;

revoke all on function public.hub_sched_check(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.hub_sched_check(uuid, text, timestamptz, timestamptz) to service_role;

commit;
