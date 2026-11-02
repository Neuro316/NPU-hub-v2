-- hub_218_scheduling_rules.sql
--
-- STATUS: PROPOSED, NOT APPLIED. Apply to production (htfrfaxlcuyawtlztxxm) only,
-- through the Supabase connector as migration name hub_218_scheduling_rules, after an
-- explicit go. Not for npu-platform-nonprod: the Hub has no nonprod.
--
-- Hub band (200+). Checked 2026-11-02: the ledger stops at hub_216; hub_217 is reserved
-- by the unmerged inbox-triage branch (feat/mail-triage). This is 218 and does not
-- depend on 217.
--
-- PURPOSE: per-user scheduling rules, the single source of truth for availability,
-- read by the Hub (future inbox scheduling agent) and by the platform booking links,
-- which share this database. Both call ONE function:
--
--   public.hub_sched_check(p_owner uuid, p_category text, p_starts_at timestamptz,
--                          p_ends_at timestamptz, out allowed boolean, out reason text)
--
-- docs/plans/hub-scheduling-rules-rulings.md has the rules and the reason codes.
--
-- Every table is keyed by owner_user_id (auth.users, cascade). A user with no category
-- windows gets reason no_rules_set for every check. Only Cameron is seeded.
--
-- ACCESS: RLS on with no policies on every table; anon and authenticated have no
-- privileges. service_role only, through /api/scheduling/* (which always uses the
-- signed-in user as the owner and never accepts an owner from the request) and the
-- platform's service-role calls to hub_sched_check / hub_sched_exception_requests.
--
-- ROLLBACK:
--   begin;
--   drop function if exists public.hub_sched_check(uuid, text, timestamptz, timestamptz);
--   drop table if exists public.hub_sched_exception_requests, public.hub_sched_reply_rules,
--     public.hub_sched_trusted_senders, public.hub_sched_one_off_blocks,
--     public.hub_sched_recurring_overrides, public.hub_sched_recurring_blocks,
--     public.hub_sched_kids_home_dates, public.hub_sched_blocked_windows,
--     public.hub_sched_category_windows, public.hub_sched_settings;
--   drop function if exists public.hub_sched_reply_rules_owner_check();
--   delete from supabase_migrations.schema_migrations where name = 'hub_218_scheduling_rules';
--   commit;

begin;

-- ─── settings ────────────────────────────────────────────────────────────────
create table public.hub_sched_settings (
  owner_user_id    uuid primary key references auth.users(id) on delete cascade,
  timezone         text not null default 'America/New_York' check (length(timezone) between 1 and 64),
  earliest_start   time not null default '08:00',
  -- weekdays after this date are 'summer' days; NULL means no school year is set
  school_year_end  date,
  updated_at       timestamptz not null default now()
);

-- ─── category windows: when each category may be booked, by kind of day ──────
-- day_kind: school (weekday, not a kids-home day), kids_home, weekend, summer
create table public.hub_sched_category_windows (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  category       text not null check (category in ('one_on_one', 'podcast', 'in_person', 'group_coaching', 'team_familiar')),
  day_kind       text not null check (day_kind in ('school', 'kids_home', 'weekend', 'summer')),
  start_time     time not null,
  end_time       time not null,
  check (end_time > start_time)
);
create index hub_sched_category_windows_owner on public.hub_sched_category_windows (owner_user_id, category, day_kind);

-- ─── blocked windows: daily blocks by kind of day (e.g. kindergarten pickup) ─
create table public.hub_sched_blocked_windows (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  day_kind       text not null check (day_kind in ('school', 'kids_home', 'weekend', 'summer')),
  start_time     time not null,
  end_time       time not null,
  label          text not null check (length(label) between 1 and 120),
  categories     text[] check (categories is null or (cardinality(categories) > 0 and categories <@ array['one_on_one', 'podcast', 'in_person', 'group_coaching', 'team_familiar'])),
  check (end_time > start_time)
);
create index hub_sched_blocked_windows_owner on public.hub_sched_blocked_windows (owner_user_id, day_kind);

-- ─── kids-home dates: from_time NULL = whole day, else kids home from that time ─
create table public.hub_sched_kids_home_dates (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  date           date not null,
  from_time      time,
  label          text not null default '' check (length(label) <= 120),
  source         text not null default 'manual' check (source ~ '^[a-z0-9_]{1,40}$'),
  unique (owner_user_id, date)
);

-- ─── recurring blocks (every N weeks on a weekday) and their per-date overrides ─
create table public.hub_sched_recurring_blocks (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references auth.users(id) on delete cascade,
  name            text not null check (length(name) between 1 and 120),
  active          boolean not null default false,
  anchor_date     date,
  interval_weeks  smallint not null default 1 check (interval_weeks between 1 and 52),
  weekday         smallint not null check (weekday between 1 and 7),   -- ISO: 1 = Monday
  start_time      time,
  end_time        time,
  categories      text[] check (categories is null or (cardinality(categories) > 0 and categories <@ array['one_on_one', 'podcast', 'in_person', 'group_coaching', 'team_familiar'])),
  unique (id, owner_user_id),
  check (end_time is null or start_time is null or end_time > start_time),
  check (anchor_date is null or extract(isodow from anchor_date) = weekday),
  check (not active or (anchor_date is not null and start_time is not null and end_time is not null))
);

-- skip: no occurrence that date. add / change: an occurrence that date, with these
-- times (or the block's own when NULL). Overrides of an inactive block do nothing.
create table public.hub_sched_recurring_overrides (
  id             uuid primary key default gen_random_uuid(),
  block_id       uuid not null,
  owner_user_id  uuid not null,
  date           date not null,
  kind           text not null check (kind in ('skip', 'add', 'change')),
  start_time     time,
  end_time       time,
  foreign key (block_id, owner_user_id) references public.hub_sched_recurring_blocks (id, owner_user_id) on delete cascade,
  unique (block_id, date),
  check (end_time is null or start_time is null or end_time > start_time),
  check (kind <> 'change' or (start_time is not null and end_time is not null))
);

-- ─── one-off blocks (page today; sms / slack / agent in a later phase) ───────
create table public.hub_sched_one_off_blocks (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  label          text not null default '' check (length(label) <= 200),
  categories     text[] check (categories is null or (cardinality(categories) > 0 and categories <@ array['one_on_one', 'podcast', 'in_person', 'group_coaching', 'team_familiar'])),
  source         text not null default 'page' check (source in ('page', 'sms', 'slack', 'agent')),
  created_by     text not null default '' check (length(created_by) <= 200),
  created_at     timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index hub_sched_one_off_blocks_owner on public.hub_sched_one_off_blocks (owner_user_id, starts_at);

-- ─── trusted senders (managed by the owner; no inbound handling in this build) ─
create table public.hub_sched_trusted_senders (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references auth.users(id) on delete cascade,
  display_name    text not null check (length(display_name) between 1 and 120),
  channel         text not null check (channel in ('sms', 'slack')),
  sender_address  text not null,
  permission      text not null default 'block_only' check (permission in ('block_only', 'block_and_reschedule')),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (owner_user_id, channel, sender_address),
  check ((channel = 'sms' and sender_address ~ '^\+[1-9][0-9]{6,14}$')
      or (channel = 'slack' and sender_address ~ '^[UW][A-Z0-9]{6,20}$'))
);

-- ─── reply rules: one per mailbox, only for mailboxes the owner connected ────
create table public.hub_sched_reply_rules (
  id                       uuid primary key default gen_random_uuid(),
  owner_user_id            uuid not null references auth.users(id) on delete cascade,
  connection_id            uuid not null unique references public.hub_mail_connections(id) on delete cascade,
  reply_from               text not null check (reply_from = lower(reply_from) and reply_from like '%@neuroprogeny.com'),
  mode                     text not null default 'draft_only' check (mode in ('draft_only', 'auto_send')),
  always_draft_categories  text[] not null default '{}' check (always_draft_categories <@ array[
                             'scheduling', 'lead', 'participant_support', 'partner_outreach', 'personal',
                             'legal_financial', 'clinical', 'vendor_billing', 'security_alert', 'newsletter', 'spam']),
  voice_note               text not null default '' check (length(voice_note) <= 2000),
  updated_at               timestamptz not null default now()
);

create function public.hub_sched_reply_rules_owner_check()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if not exists (select 1 from public.hub_mail_connections c
                  where c.id = new.connection_id and c.owner_user_id = new.owner_user_id) then
    raise exception 'reply_rule_mailbox_not_owned';
  end if;
  return new;
end
$function$;

create trigger hub_sched_reply_rules_owner_check
  before insert or update on public.hub_sched_reply_rules
  for each row execute function public.hub_sched_reply_rules_owner_check();

-- ─── exception requests: anything outside the rules waits for the owner ──────
create table public.hub_sched_exception_requests (
  id                   uuid primary key default gen_random_uuid(),
  owner_user_id        uuid not null references auth.users(id) on delete cascade,
  category             text not null check (category in ('one_on_one', 'podcast', 'in_person', 'group_coaching', 'team_familiar')),
  requested_starts_at  timestamptz not null,
  requested_ends_at    timestamptz not null,
  requester_name       text not null default '' check (length(requester_name) <= 200),
  requester_email      text not null default '' check (length(requester_email) <= 320),
  note                 text not null default '' check (length(note) <= 2000),
  source               text not null default 'platform' check (source in ('platform', 'hub', 'agent')),
  check_reason         text check (check_reason is null or length(check_reason) <= 60),
  status               text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'booked', 'cancelled')),
  decided_at           timestamptz,
  booking_ref          text check (booking_ref is null or length(booking_ref) <= 200),
  created_at           timestamptz not null default now(),
  check (requested_ends_at > requested_starts_at)
);
create index hub_sched_exception_requests_owner on public.hub_sched_exception_requests (owner_user_id, status, created_at desc);

-- ─── access: service role only ───────────────────────────────────────────────
alter table public.hub_sched_settings enable row level security;
alter table public.hub_sched_category_windows enable row level security;
alter table public.hub_sched_blocked_windows enable row level security;
alter table public.hub_sched_kids_home_dates enable row level security;
alter table public.hub_sched_recurring_blocks enable row level security;
alter table public.hub_sched_recurring_overrides enable row level security;
alter table public.hub_sched_one_off_blocks enable row level security;
alter table public.hub_sched_trusted_senders enable row level security;
alter table public.hub_sched_reply_rules enable row level security;
alter table public.hub_sched_exception_requests enable row level security;

revoke all on public.hub_sched_settings, public.hub_sched_category_windows, public.hub_sched_blocked_windows,
  public.hub_sched_kids_home_dates, public.hub_sched_recurring_blocks, public.hub_sched_recurring_overrides,
  public.hub_sched_one_off_blocks, public.hub_sched_trusted_senders, public.hub_sched_reply_rules,
  public.hub_sched_exception_requests
  from public, anon, authenticated;
grant all on public.hub_sched_settings, public.hub_sched_category_windows, public.hub_sched_blocked_windows,
  public.hub_sched_kids_home_dates, public.hub_sched_recurring_blocks, public.hub_sched_recurring_overrides,
  public.hub_sched_one_off_blocks, public.hub_sched_trusted_senders, public.hub_sched_reply_rules,
  public.hub_sched_exception_requests
  to service_role;
revoke all on function public.hub_sched_reply_rules_owner_check() from public, anon, authenticated;

-- ─── the check ───────────────────────────────────────────────────────────────
-- Reason codes, in the order they are tested (first failure wins):
--   invalid_request         missing owner/time, end <= start, unknown category
--   no_rules_set            the owner has no category windows at all
--   spans_days              start and end fall on different local dates
--   before_earliest_start   local start is before settings.earliest_start (08:00 default)
--   summer_rules_undefined  a weekday after school_year_end and no 'summer' windows exist
--   one_off_block           overlaps a one-off block that applies to the category
--   recurring_block         overlaps an occurrence of an active recurring block
--   blocked_window          overlaps a daily blocked window for that kind of day
--   kids_home               a kids-home day (or the part after from_time) and the
--                           category has no kids_home windows
--   weekend                 a weekend and the category has no weekend windows
--   outside_window          not inside one window for the category and kind of day
--   ok                      allowed
-- A half day (from_time set) is checked in two parts: before from_time as a school day,
-- from from_time as a kids-home day. A booking must sit inside ONE window per part.
create function public.hub_sched_check(
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

  -- the kind of day, split into parts on a half day
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

  if exists (
    select 1
      from public.hub_sched_recurring_blocks b
      left join public.hub_sched_recurring_overrides o on o.block_id = b.id and o.date = v_d
     where b.owner_user_id = p_owner
       and b.active
       and (b.categories is null or p_category = any (b.categories))
       and (
             (o.id is not null and o.kind in ('add', 'change'))
          or (o.id is null and b.weekday = v_dow and ((v_d - b.anchor_date) % (7 * b.interval_weeks)) = 0)
           )
       and coalesce(o.start_time, b.start_time) < v_et
       and coalesce(o.end_time, b.end_time) > v_st
  ) then
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

-- ─── seed: Cameron (the Hub user cameron@neuroprogeny.com) ───────────────────
do $seed$
declare
  v_owner uuid;
begin
  select u.id into v_owner from auth.users u where lower(u.email) = 'cameron@neuroprogeny.com';
  if v_owner is null then
    raise exception 'seed: Hub user cameron@neuroprogeny.com not found';
  end if;

  insert into public.hub_sched_settings (owner_user_id, timezone, earliest_start, school_year_end)
  values (v_owner, 'America/New_York', '08:00', '2027-05-28');

  insert into public.hub_sched_category_windows (owner_user_id, category, day_kind, start_time, end_time) values
    (v_owner, 'one_on_one',     'school',    '08:00', '11:30'),
    (v_owner, 'one_on_one',     'school',    '13:30', '17:00'),
    (v_owner, 'podcast',        'school',    '08:00', '11:30'),
    (v_owner, 'in_person',      'school',    '08:00', '11:30'),
    (v_owner, 'group_coaching', 'school',    '13:30', '17:00'),
    (v_owner, 'group_coaching', 'kids_home', '13:30', '17:00'),
    (v_owner, 'team_familiar',  'school',    '08:00', '17:00'),
    (v_owner, 'team_familiar',  'kids_home', '08:00', '17:00');

  insert into public.hub_sched_blocked_windows (owner_user_id, day_kind, start_time, end_time, label, categories)
  values (v_owner, 'school', '11:30', '13:30', 'Kindergarten pickup', null);

  -- Haywood County Schools 2026-27, weekdays only (weekends are never school days)
  insert into public.hub_sched_kids_home_dates (owner_user_id, date, from_time, label, source)
  select v_owner, d::date, null, 'No school (Haywood County Schools)', 'hcs_2026_27'
    from (values
      ('2026-11-11'::date, '2026-11-11'::date), ('2026-11-25', '2026-11-27'), ('2026-12-23', '2027-01-01'),
      ('2027-01-04', '2027-01-05'), ('2027-01-18', '2027-01-18'), ('2027-02-03', '2027-02-03'),
      ('2027-02-26', '2027-02-26'), ('2027-03-11', '2027-03-11'), ('2027-03-26', '2027-03-26'),
      ('2027-04-05', '2027-04-09')
    ) r(a, b)
    cross join lateral generate_series(r.a::timestamp, r.b::timestamp, interval '1 day') d
   where extract(isodow from d) < 6;

  insert into public.hub_sched_kids_home_dates (owner_user_id, date, from_time, label, source) values
    (v_owner, '2027-02-25', '12:30', 'Early release (Haywood County Schools)', 'hcs_2026_27'),
    (v_owner, '2027-03-25', '12:30', 'Early release (Haywood County Schools)', 'hcs_2026_27');

  -- every other Wednesday; anchor date and times are filled in on the Rules page
  insert into public.hub_sched_recurring_blocks (owner_user_id, name, active, anchor_date, interval_weeks, weekday, start_time, end_time, categories)
  values (v_owner, 'Cormac', false, null, 2, 3, null, null, null);

  insert into public.hub_sched_reply_rules (owner_user_id, connection_id, reply_from, mode, always_draft_categories, voice_note)
  select v_owner, c.id, c.email_address, 'draft_only', array['personal', 'legal_financial', 'clinical'], ''
    from public.hub_mail_connections c
   where c.owner_user_id = v_owner
     and c.email_address in ('admin@neuroprogeny.com', 'cameron@neuroprogeny.com',
                             'cameron.allen@neuroprogeny.com', 'ops@neuroprogeny.com');
end
$seed$;

commit;
