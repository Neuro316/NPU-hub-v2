-- hub_244_migration_ledger_reader.sql
--
-- STATUS: PROPOSED 2026-11-19. NOT APPLIED. Needs a go. Applied by the Hub chat: nonprod (cpasntagxhxitavivwlb)
-- first, then production (htfrfaxlcuyawtlztxxm), then NOTIFY pgrst and a read-back.
-- Hub band. Production's ledger stops at hub_243 (checked 2026-11-19); hub_241 is reserved for the support FAQ and
-- hub_234 is held by PR #46. This is 244.
--
-- PURPOSE: Running List q23, Hub Health. The "Hub migrations: repo and ledger" tile compares the repo's migration
--   files with supabase_migrations.schema_migrations. That schema is not exposed through the API, so the Hub cannot
--   read the ledger without this one reader. Until it is applied the tile shows unknown; nothing else depends on it.
--
--   public.hub_migration_ledger()  returns the NAMES of applied Hub-band migrations (hub_NNN_* and bare 2NN_*), and
--   nothing else: no statements, no versions, no platform names. SECURITY DEFINER with an empty search_path.
--
-- ACCESS: EXECUTE revoked from public, anon and authenticated; granted to service_role only (the Hub Health cron).
--
-- NO NEW TABLE. Nothing is written.
--
-- READ-BACK:
--   select count(*) from public.hub_migration_ledger();           -- the Hub-band rows (35 on 2026-11-19 before this one, 36 after)
--   select has_function_privilege('authenticated', 'public.hub_migration_ledger()', 'execute');   -- false
--   select name from supabase_migrations.schema_migrations where name = 'hub_244_migration_ledger_reader';
--
-- ROLLBACK:
--   begin;
--   drop function if exists public.hub_migration_ledger();
--   delete from supabase_migrations.schema_migrations where name = 'hub_244_migration_ledger_reader';
--   commit;

begin;

create or replace function public.hub_migration_ledger()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select m.name
    from supabase_migrations.schema_migrations m
   where m.name ~ '^(hub_[0-9]{3}|2[0-9]{2})_'
   order by m.name
$$;

revoke all on function public.hub_migration_ledger() from public, anon, authenticated;
grant execute on function public.hub_migration_ledger() to service_role;

comment on function public.hub_migration_ledger() is
  'Hub Health (q23): names of applied Hub-band migrations, for the repo and ledger parity tile. Service role only.';

commit;
