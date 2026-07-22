-- 073_merge_contact_repoint_fn.sql
-- Repoint every contact-referencing column from a losing contact to a winner.
--
-- WHY A DB FUNCTION: the repoint has to enumerate information_schema, which the
-- supabase-js client cannot do. /api/contacts/merge previously carried a
-- HAND-WRITTEN list of 9 tables while the schema has ~60 contact-referencing
-- columns, so every merge through the UI stranded records pointing at a
-- soft-deleted contact. This is the same loop proven in migration 072.
--
-- Two traps carried forward from 072 — do not "simplify" either away:
--   1. NOT every contact-referencing column is uuid: acct_clients
--      .enrolled_contact_id is TEXT. Passing a uuid parameter to it raises
--      "operator does not exist: text = uuid" and aborts the whole transaction.
--      Hence the per-column-type cast.
--   2. contact_interaction_score has UNIQUE(contact_id). Repointing when both
--      contacts have a row violates it, so the loser's row is deleted instead.
--
-- Also note call_logs.contact_id has NO foreign key, so it is invisible to any
-- FK-based enumeration (pg_constraint). Driving off information_schema.columns
-- is what catches it.

create or replace function merge_contact_repoint(p_loser uuid, p_winner uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  n        bigint;
  counts   jsonb := '{}'::jsonb;
  total    bigint := 0;
begin
  if p_loser is null or p_winner is null then
    raise exception 'merge_contact_repoint: both contact ids are required';
  end if;
  if p_loser = p_winner then
    raise exception 'merge_contact_repoint: loser and winner must differ';
  end if;

  -- UNIQUE(contact_id): drop the loser's row rather than repoint into a violation.
  delete from contact_interaction_score where contact_id = p_loser;
  get diagnostics n = row_count;
  if n > 0 then
    counts := counts || jsonb_build_object('contact_interaction_score.deleted', n);
    total := total + n;
  end if;

  for r in
    select c.table_name, c.column_name, c.data_type
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema
       and t.table_name  = c.table_name
       and t.table_type  = 'BASE TABLE'         -- never attempt an UPDATE on a view
     where c.table_schema = 'public'
       and (c.column_name like '%contact_id%'
            or (c.table_name = 'equipment' and c.column_name = 'assigned_to'))
       and c.table_name <> 'contact_interaction_score'  -- handled above
       and c.table_name <> 'contact_merge_log'          -- audit trail must keep pointing at the loser
     order by c.table_name, c.column_name
  loop
    if r.data_type = 'uuid' then
      execute format('update public.%I set %I = $1 where %I = $2',
                     r.table_name, r.column_name, r.column_name)
        using p_winner, p_loser;
    else
      execute format('update public.%I set %I = $1::text where %I = $2::text',
                     r.table_name, r.column_name, r.column_name)
        using p_winner, p_loser;
    end if;
    get diagnostics n = row_count;
    if n > 0 then
      counts := counts || jsonb_build_object(r.table_name || '.' || r.column_name, n);
      total := total + n;
    end if;
  end loop;

  -- merged_into_id does not match the '%contact_id%' pattern, but a contact
  -- previously merged INTO the loser must follow the chain to the winner.
  update contacts set merged_into_id = p_winner where merged_into_id = p_loser;
  get diagnostics n = row_count;
  if n > 0 then
    counts := counts || jsonb_build_object('contacts.merged_into_id', n);
    total := total + n;
  end if;

  return jsonb_build_object('repointed', counts, 'total', total);
end;
$$;

-- SECURITY DEFINER + PostgREST means this would otherwise be callable directly
-- by any logged-in user, bypassing the route's staff gate entirely. Lock it to
-- the service role, which is what /api/contacts/merge uses server-side.
revoke all on function merge_contact_repoint(uuid, uuid) from public;
revoke all on function merge_contact_repoint(uuid, uuid) from anon;
revoke all on function merge_contact_repoint(uuid, uuid) from authenticated;
grant execute on function merge_contact_repoint(uuid, uuid) to service_role;

-- Verification:
--   select proname, pg_get_function_identity_arguments(oid) from pg_proc
--    where proname = 'merge_contact_repoint';
--   select grantee, privilege_type from information_schema.routine_privileges
--    where routine_name = 'merge_contact_repoint';   -- expect service_role only
