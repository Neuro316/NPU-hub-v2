-- phantom_trigger_columns.sql — repeatable schema-integrity check.
-- Finds every trigger whose function references a NEW.<field> / OLD.<field>
-- that is NOT a real column on the trigger's own table. That mismatch aborts
-- the triggering write at runtime (ERROR 42703 "record new has no field X"),
-- silently breaking whatever feature does that insert/update.
--
-- Found this session: tasks.created_by (fixed, migration 081) and
-- resource_locks.updated_at (fixed, migration 082).
--
-- KNOWN BENIGN: a shared trigger function that branches on TG_TABLE_NAME can
-- legitimately reference a column that exists on ONE of its tables but not
-- another; the reference sits behind a table-name guard and never executes for
-- the other table. Current example: call_logs / trg_call_last_contact reads
-- NEW.conversation_id only inside its `TG_TABLE_NAME = 'crm_messages'` branch.
-- Before acting on a hit, read the function body and confirm the reference
-- isn't guarded.
--
-- Run: paste into the Supabase SQL editor (or the Supabase MCP execute_sql).

with trg as (
  select c.relname as tbl, p.proname as fn, t.tgname, p.prosrc
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'public' and not t.tgisinternal
),
refs as (
  select distinct tbl, fn, tgname, lower(m[1]) as field
  from trg, regexp_matches(prosrc, '(?:NEW|OLD)\.([a-zA-Z_][a-zA-Z0-9_]*)', 'g') as m
)
select r.tbl as table_name, r.tgname as trigger_name, r.fn as function_name,
       r.field as phantom_field,
       -- a hint at whether it's likely the benign guarded-shared-function case
       exists (select 1 from trg t2 where t2.fn = r.fn and t2.prosrc ilike '%TG_TABLE_NAME%') as function_branches_on_table
from refs r
where not exists (
  select 1 from information_schema.columns col
  where col.table_schema = 'public' and col.table_name = r.tbl and col.column_name = r.field
)
order by r.tbl, r.field;
