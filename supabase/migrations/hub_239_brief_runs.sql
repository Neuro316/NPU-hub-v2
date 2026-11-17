-- hub_239_brief_runs.sql
--
-- STATUS: PROPOSED 2026-11-17. NOT APPLIED. Needs a go. Nonprod (cpasntagxhxitavivwlb) first, then production
-- (htfrfaxlcuyawtlztxxm), applied by the Hub chat, each followed by NOTIFY pgrst and the read-back below.
--
-- PURPOSE (Running List q22, the 8 AM brief): one row per person per New York date that a brief was sent.
-- UNIQUE (org_id, user_id, brief_date) is what makes a second brief that day impossible: /api/cron/brief claims the
-- row BEFORE it queues the text, and a run that finds the row already there queues nothing. Counts only: no text,
-- no names, no subjects.
--
-- Safe before the code: nothing writes here until org_settings 'hub_notifications'.mode is 'live', which ships
-- unset (off). Without this table a live run fails closed (the claim errors and nothing is queued).
--
-- ACCESS: RLS on with NO policies and no grants to anon or authenticated: service role only.
--
-- ROLLBACK:
--   begin;
--   drop table if exists public.hub_brief_runs;
--   commit;
--   notify pgrst, 'reload schema';

begin;

create table public.hub_brief_runs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  brief_date  date not null,
  mode        text not null check (mode in ('live')),
  line_count  smallint not null default 0 check (line_count between 0 and 50),
  outbox_id   uuid,
  created_at  timestamptz not null default now(),
  unique (org_id, user_id, brief_date)
);
create index hub_brief_runs_user on public.hub_brief_runs (org_id, user_id, created_at desc);
alter table public.hub_brief_runs enable row level security;
revoke all on public.hub_brief_runs from anon, authenticated;
comment on table public.hub_brief_runs is 'The 8 AM brief (hub_239): one row per person per New York date, claimed before the text is queued. Service role only.';

commit;

notify pgrst, 'reload schema';

-- READ-BACK:
--   select name from supabase_migrations.schema_migrations where name = 'hub_239_brief_runs';
--   select relrowsecurity from pg_class where oid = 'public.hub_brief_runs'::regclass;   -- true
--   select count(*) from pg_policies where tablename = 'hub_brief_runs';                 -- 0
