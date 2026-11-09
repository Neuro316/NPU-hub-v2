-- hub_235_metric_targets_direction.sql
--
-- STATUS: PROPOSED 2026-11-09. NOT APPLIED. Needs a go. Production (htfrfaxlcuyawtlztxxm) only.
-- (hub_232 and hub_234 are proposed on other branches; this takes the next number.)
--
-- PURPOSE: Growth Dashboard targets that work both ways, and the product-line scorecard (ruled 2026-11-09).
--   hub_metric_targets.direction  'higher' or 'lower' is better. Thresholds are shares of the target:
--     higher  green ≥ amber, amber ≥ red, else red       0 < red ≤ amber ≤ 1    (defaults 0.90 / 0.75)
--     lower   green ≤ amber, amber ≤ red, else red       0 < amber ≤ red ≤ 10   (defaults 1.00 / 1.25)
--   A sum metric's target stays a monthly total (prorated); a ratio, median or level metric's target is a level.
--   That rule lives in the code (src/lib/metrics/targets.ts), not here.
--
-- SEED (from November 2026; a later month without its own row carries these forward):
--   phase1_sales            30 a month                 higher  0.90 / 0.75
--   phase23_conversion      40 (%)                     higher  0.90 / 0.75
--   coaching_hours_booked   10 hours a month           higher  0.90 / 0.75
--   coaching_hours_60        5 hours (60 min sessions)  higher  0.90 / 0.75
--   coaching_hours_30        5 hours (30 min sessions)  higher  0.90 / 0.75
--   coaching_capacity_used 100 (%)                     lower   0.90 / 1.01   amber from 90%, red above 100%
--                                                                           (exactly 10 hours is at capacity, amber)
--   days_to_consent          2 days                    lower   1.00 / 1.25   (were hard-coded in collect.ts;
--   days_to_pairing          7 days                    lower   1.00 / 1.25    the "stuck" check now reads
--   days_to_first_session   10 days                    lower   1.00 / 1.25    these rows)
-- REMOVED: the clarity_sales target (the product is retired; its history stays readable on the Sales tab).
-- Not set here, for Cameron to set in the panel: revenue (its 90,000 row is unchanged), core_revenue. Coaching
-- attach (30 and 60) is information only and takes no target.
--
-- ACCESS: unchanged (RLS on, no policies, service_role only).
--
-- ROLLBACK:
--   begin;
--   delete from public.hub_metric_targets where direction = 'lower' or metric_key in
--     ('phase1_sales', 'phase23_conversion', 'coaching_hours_booked', 'coaching_hours_60', 'coaching_hours_30');
--   insert into public.hub_metric_targets (metric_key, month, target_value) values ('clarity_sales', '2026-11-01', 12)
--     on conflict do nothing;
--   alter table public.hub_metric_targets drop constraint hub_metric_targets_thresholds,
--     add constraint hub_metric_targets_amber_threshold_check check (amber_threshold > 0 and amber_threshold <= 1),
--     add constraint hub_metric_targets_red_threshold_check check (red_threshold > 0 and red_threshold <= 1),
--     add constraint hub_metric_targets_check check (red_threshold <= amber_threshold),
--     drop column direction;
--   commit;

begin;

alter table public.hub_metric_targets
  add column direction text not null default 'higher' check (direction in ('higher', 'lower')),
  drop constraint hub_metric_targets_amber_threshold_check,
  drop constraint hub_metric_targets_red_threshold_check,
  drop constraint hub_metric_targets_check,
  add constraint hub_metric_targets_thresholds check (
       (direction = 'higher' and red_threshold > 0 and red_threshold <= amber_threshold and amber_threshold <= 1)
    or (direction = 'lower'  and amber_threshold > 0 and amber_threshold <= red_threshold and red_threshold <= 10));

insert into public.hub_metric_targets (metric_key, month, target_value, direction, amber_threshold, red_threshold) values
  ('phase1_sales',           '2026-11-01',  30, 'higher', 0.90, 0.75),
  ('phase23_conversion',     '2026-11-01',  40, 'higher', 0.90, 0.75),
  ('coaching_hours_booked',  '2026-11-01',  10, 'higher', 0.90, 0.75),
  ('coaching_hours_60',      '2026-11-01',   5, 'higher', 0.90, 0.75),
  ('coaching_hours_30',      '2026-11-01',   5, 'higher', 0.90, 0.75),
  ('coaching_capacity_used', '2026-11-01', 100, 'lower',  0.90, 1.01),
  ('days_to_consent',        '2026-11-01',   2, 'lower',  1.00, 1.25),
  ('days_to_pairing',        '2026-11-01',   7, 'lower',  1.00, 1.25),
  ('days_to_first_session',  '2026-11-01',  10, 'lower',  1.00, 1.25)
on conflict (metric_key, month) do update set
  target_value = excluded.target_value, direction = excluded.direction,
  amber_threshold = excluded.amber_threshold, red_threshold = excluded.red_threshold, updated_at = now();

delete from public.hub_metric_targets where metric_key = 'clarity_sales';

commit;
