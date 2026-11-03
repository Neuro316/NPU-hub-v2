-- hub_223_growth_metrics.sql
--
-- STATUS: APPLIED to production (htfrfaxlcuyawtlztxxm) on 2026-11-03, ledger version
-- 20261103131756, migration name hub_223_growth_metrics. Amended at the go: hub_metric_exclusions
-- gained email_pattern and a decision column (exclude or keep, for the Review test accounts
-- panel), created_by became nullable for seeded rows, and Cameron's test addresses were seeded.
-- Verified after the apply: all four tables have RLS on, no policies, and no anon or
-- authenticated grants; 5 targets and 3 exclusions.
--
-- Hub band (200+). Checked 2026-11-02: the ledger stops at hub_221. hub_222 is held by
-- the Resource Library (branch feat/resource-library, proposed), so this is 223.
--
-- PURPOSE: the Growth Dashboard (docs/plans/hub-growth-dashboard.md,
-- docs/metrics/definitions.md). Hub-owned derived data only: nothing here touches a
-- University-owned table.
--   hub_metrics_daily      one value per day, metric and dimension. The rollup replaces a
--                          day's rows on every recompute. A total row has dimension_key ''
--                          and dimension_value ''
--   hub_metric_targets     monthly target per metric, with amber and red thresholds as a
--                          share of the target pace (amber 0.90, red 0.75 by default)
--   hub_metric_exclusions  the Hub's own "this is test data" list (test-filter rule T3):
--                          nothing in the shared tables flags test people. Seeded with
--                          Cameron's test addresses; anything else is decided in the
--                          Review test accounts panel (exclude or keep)
--   hub_metric_alerts      one row per alert sent, so an hourly check texts once per
--                          period (Monday scorecard, no leads in 48 h, slow speed to
--                          lead, a cron failing twice)
--
-- SEED: targets for November 2026, per the brief: 150 leads, 35 assessments sold, 30
-- onboarded, 12 Clarity sales, $90,000 revenue. A month with no row uses the latest
-- earlier month's targets.
--
-- ACCESS: RLS on with no policies on all four tables; anon and authenticated have no
-- privileges; service_role only. The dashboard reads through superadmin-only routes.
--
-- ROLLBACK:
--   begin;
--   drop table if exists public.hub_metric_alerts, public.hub_metric_exclusions,
--     public.hub_metric_targets, public.hub_metrics_daily;
--   delete from supabase_migrations.schema_migrations where name = 'hub_223_growth_metrics';
--   commit;

begin;

create table public.hub_metrics_daily (
  date             date not null,
  metric_key       text not null check (metric_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  dimension_key    text not null default '' check (length(dimension_key) <= 64),
  dimension_value  text not null default '' check (length(dimension_value) <= 200),
  value            numeric not null,
  computed_at      timestamptz not null default now(),
  primary key (date, metric_key, dimension_key, dimension_value)
);

create index hub_metrics_daily_metric_date on public.hub_metrics_daily (metric_key, date);

create table public.hub_metric_targets (
  metric_key       text not null check (metric_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  month            date not null check (extract(day from month) = 1),
  target_value     numeric not null check (target_value >= 0),
  amber_threshold  numeric not null default 0.90 check (amber_threshold > 0 and amber_threshold <= 1),
  red_threshold    numeric not null default 0.75 check (red_threshold > 0 and red_threshold <= 1),
  updated_by       uuid,
  updated_at       timestamptz not null default now(),
  primary key (metric_key, month),
  check (red_threshold <= amber_threshold)
);

create table public.hub_metric_exclusions (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('contact', 'profile', 'email', 'email_pattern')),
  decision       text not null default 'exclude' check (decision in ('exclude', 'keep')),
  contact_id     uuid references public.contacts(id) on delete cascade,
  profile_id     uuid,
  email          text check (email is null or email = lower(btrim(email))),
  email_pattern  text check (email_pattern is null or (email_pattern = lower(btrim(email_pattern))
                   and email_pattern like '%@%' and length(email_pattern) <= 200)),
  reason         text check (reason is null or length(reason) <= 200),
  created_by     uuid,   -- null: seeded by this migration
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check ((kind = 'contact' and contact_id is not null and profile_id is null and email is null and email_pattern is null)
      or (kind = 'profile' and profile_id is not null and contact_id is null and email is null and email_pattern is null)
      or (kind = 'email' and email is not null and contact_id is null and profile_id is null and email_pattern is null)
      or (kind = 'email_pattern' and email_pattern is not null and contact_id is null and profile_id is null and email is null))
);

create unique index hub_metric_exclusions_contact on public.hub_metric_exclusions (contact_id) where contact_id is not null;
create unique index hub_metric_exclusions_profile on public.hub_metric_exclusions (profile_id) where profile_id is not null;
create unique index hub_metric_exclusions_email on public.hub_metric_exclusions (email) where email is not null;
create unique index hub_metric_exclusions_pattern on public.hub_metric_exclusions (email_pattern) where email_pattern is not null;

create table public.hub_metric_alerts (
  alert_key   text not null check (alert_key ~ '^[a-z][a-z0-9_:.-]{1,120}$'),
  period_key  text not null check (length(period_key) between 1 and 40),
  sent_at     timestamptz not null default now(),
  detail      jsonb not null default '{}',
  primary key (alert_key, period_key)
);

alter table public.hub_metrics_daily enable row level security;
alter table public.hub_metric_targets enable row level security;
alter table public.hub_metric_exclusions enable row level security;
alter table public.hub_metric_alerts enable row level security;
revoke all on public.hub_metrics_daily, public.hub_metric_targets, public.hub_metric_exclusions, public.hub_metric_alerts
  from public, anon, authenticated;
grant all on public.hub_metrics_daily, public.hub_metric_targets, public.hub_metric_exclusions, public.hub_metric_alerts
  to service_role;

insert into public.hub_metric_targets (metric_key, month, target_value) values
  ('leads',            '2026-11-01', 150),
  ('assessments_sold', '2026-11-01', 35),
  ('onboarded',        '2026-11-01', 30),
  ('clarity_sales',    '2026-11-01', 12),
  ('revenue',          '2026-11-01', 90000);

-- Test rows confirmed at the go (2026-11-03): Cameron's test addresses. email_pattern is a
-- lower-case LIKE pattern. Anything else is excluded only after Cameron confirms it in the
-- Review test accounts panel, which writes 'exclude' or 'keep' rows here.
insert into public.hub_metric_exclusions (kind, email_pattern, email, reason) values
  ('email_pattern', 'cameron.s.allen+%@gmail.com', null, 'Cameron test addresses (seeded at the go)'),
  ('email',         null, 'cameron.s.allen@gmail.com', 'Cameron test profile (seeded at the go)'),
  ('email',         null, 'cameron@neuroprogeny.com',  'Cameron test purchases (seeded at the go)');

commit;
