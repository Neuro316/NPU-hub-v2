-- 072_merge_duplicate_cameron_contact.sql  (SOFT MERGE — no hard delete)
--
--   WINNER : 4cb236f6-30c8-4d24-a91a-9db786425cee
--            phone 18287347558 · Cameron@neuroprogeny.com
--            holds all history: 25 calls (16 outbound), 9 call_logs rows,
--            11 contact_timeline rows, last contact 2026-07-21 21:02
--   LOSER  : 68099477-b7a6-4807-b339-6a89ab101c4e
--            phone 8287347558 · cameron.s.allen@gmail.com · source 'admin'
--
-- EXPLICITLY OUT OF SCOPE: 5921c286-8dbd-4e53-b253-642bb6061c39, the Stripe
-- `+buyertest1` record. Not read, not written, not referenced below.
--
-- ── MATCHING GUARANTEE ───────────────────────────────────────────────────────
-- Every statement matches on a contacts.id UUID (the loser's, or the winner's)
-- or on conversation UUIDs derived from contact_id. There is NO `where email =`
-- predicate anywhere in this file, and no non-contact table is targeted. Auth
-- users, profiles, org_members, participants, Stripe/billing, subscriptions and
-- every other account/login-keyed table are untouched and unreachable from
-- this SQL. The loser's email is READ once (from contacts, by UUID) and WRITTEN
-- once (into contacts.notes, by UUID) — see Part A.1.
--
-- ── WHY SOFT MERGE ───────────────────────────────────────────────────────────
-- Matches the app convention in /api/contacts/merge: set merged_into_id and
-- keep the row. ~15 read paths already filter `.is('merged_into_id', null)`, so
-- the loser disappears from lists, search, campaigns and exports without a
-- DELETE. 28 FKs reference contacts(id) and most are ON DELETE CASCADE, so a
-- hard delete would risk silently destroying assessments, notes, payments and
-- consents. Soft merge is reversible; the snapshot below makes it recoverable
-- even if the row were later removed.
--
-- ⚠️ NOTE ON contact_merge_log: the real columns are (org_id, winner_id,
-- loser_id, merged_by, merge_details jsonb). /api/contacts/merge inserts
-- surviving_contact_id / merged_contact_id / merged_contact_snapshot — columns
-- that DO NOT EXIST — and never checks the error, so that route's snapshot has
-- silently never been written. This migration uses the real schema. Fixing the
-- route is queued separately.

begin;

-- ── PART A.0 — snapshot the loser (recovery record) ─────────────────────────
insert into contact_merge_log (org_id, winner_id, loser_id, merged_by, merge_details)
select
  l.org_id,
  '4cb236f6-30c8-4d24-a91a-9db786425cee'::uuid,
  l.id,
  null,                                   -- applied via migration, not a UI user
  jsonb_build_object(
    'reason', 'phone-format duplicate contact (8287347558 vs 18287347558)',
    'applied_by', 'migration 072',
    'loser_snapshot', to_jsonb(l)         -- full row, including email, for recovery
  )
from contacts l
where l.id = '68099477-b7a6-4807-b339-6a89ab101c4e';

-- ── PART A.1 — preserve the loser's alternate email ─────────────────────────
-- The ONLY place this migration touches an email address: read from the loser
-- CONTACT row by UUID, written into the winner CONTACT's notes by UUID.
update contacts w
   set notes = coalesce(nullif(trim(w.notes), '') || E'\n', '')
             || 'Merged duplicate CRM contact on 2026-07-22 (contact '
             || '68099477-b7a6-4807-b339-6a89ab101c4e). Alternate email: '
             || coalesce((select l.email from contacts l
                           where l.id = '68099477-b7a6-4807-b339-6a89ab101c4e'), '(none)')
             || ' · alternate phone format: 8287347558 · source: admin.'
 where w.id = '4cb236f6-30c8-4d24-a91a-9db786425cee';

-- ── PART A.2 — repoint EVERY contact-referencing column ─────────────────────
-- Driven off information_schema rather than a hand-written list, because the
-- hand-written list in /api/contacts/merge covers 9 tables and the real schema
-- has ~60 contact-referencing columns — including call_logs.contact_id, which
-- has NO foreign key and is therefore invisible to any FK-based enumeration.
-- BASE TABLE only (skips views such as v_nr_participant_quiz_history).
-- contact_interaction_score is excluded here and handled in A.3 (UNIQUE).
do $$
declare
  v_loser  uuid := '68099477-b7a6-4807-b339-6a89ab101c4e';
  v_winner uuid := '4cb236f6-30c8-4d24-a91a-9db786425cee';
  r record;
  n bigint;
begin
  for r in
    select c.table_name, c.column_name, c.data_type
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema
       and t.table_name  = c.table_name
       and t.table_type  = 'BASE TABLE'
     where c.table_schema = 'public'
       and (c.column_name like '%contact_id%'
            or (c.table_name = 'equipment' and c.column_name = 'assigned_to'))
       and c.table_name <> 'contact_interaction_score'   -- UNIQUE(contact_id), see A.3
       and c.table_name <> 'contact_merge_log'           -- audit trail must keep pointing at the loser
     order by c.table_name, c.column_name
  loop
    -- Not every contact-referencing column is typed uuid: acct_clients
    -- .enrolled_contact_id is TEXT. A uuid parameter against a text column
    -- raises "operator does not exist: text = uuid" and aborts the whole
    -- transaction, so cast per column type rather than assuming.
    if r.data_type = 'uuid' then
      execute format('update public.%I set %I = $1 where %I = $2',
                     r.table_name, r.column_name, r.column_name)
        using v_winner, v_loser;
    else
      execute format('update public.%I set %I = $1::text where %I = $2::text',
                     r.table_name, r.column_name, r.column_name)
        using v_winner, v_loser;
    end if;
    get diagnostics n = row_count;
    if n > 0 then
      raise notice 'repointed % row(s): %.%', n, r.table_name, r.column_name;
    end if;
  end loop;
end $$;
-- Expected notices (from the dry run): contact_timeline 4, np_onboarding_log 4,
-- np_client_records 2, conversations 1, identity_graph 1. All other columns 0.

-- Also repoint any contact previously merged INTO the loser, so merge chains
-- don't dangle. (merged_into_id does not match the '%contact_id%' filter above.)
update contacts set merged_into_id = '4cb236f6-30c8-4d24-a91a-9db786425cee'
 where merged_into_id = '68099477-b7a6-4807-b339-6a89ab101c4e';

-- ── PART A.3 — contact_interaction_score: UNIQUE(contact_id) ────────────────
-- Both records have a row, so repointing would violate the constraint. The
-- winner's score covers all 25 calls; the loser's scores an empty history.
-- Dropping the loser's row is the correct resolution, not an overwrite.
delete from contact_interaction_score
 where contact_id = '68099477-b7a6-4807-b339-6a89ab101c4e';

-- ── PART A.4 — collapse to ONE conversation card ────────────────────────────
-- After A.2 the winner has 3 conversations (its 2 + the loser's 1). Merge them
-- into the oldest. crm_messages and response_time_log are the ONLY tables
-- referencing conversations(id); both are repointed BEFORE any card is deleted,
-- so no message is lost. call_logs has no conversation_id — calls attach by
-- contact_id and are already correct after A.2.
with keep as (
  select id from conversations
   where contact_id = '4cb236f6-30c8-4d24-a91a-9db786425cee'
   order by created_at asc limit 1
), doomed as (
  select id from conversations
   where contact_id = '4cb236f6-30c8-4d24-a91a-9db786425cee'
     and id <> (select id from keep)
)
update crm_messages m set conversation_id = (select id from keep)
 where m.conversation_id in (select id from doomed);

with keep as (
  select id from conversations
   where contact_id = '4cb236f6-30c8-4d24-a91a-9db786425cee'
   order by created_at asc limit 1
), doomed as (
  select id from conversations
   where contact_id = '4cb236f6-30c8-4d24-a91a-9db786425cee'
     and id <> (select id from keep)
)
update response_time_log r set conversation_id = (select id from keep)
 where r.conversation_id in (select id from doomed);

with keep as (
  select id from conversations
   where contact_id = '4cb236f6-30c8-4d24-a91a-9db786425cee'
   order by created_at asc limit 1
), agg as (
  select max(last_message_at) as last_at, sum(unread_count) as unread
    from conversations
   where contact_id = '4cb236f6-30c8-4d24-a91a-9db786425cee'
)
update conversations c
   set last_message_at = coalesce((select last_at from agg), c.last_message_at),
       unread_count    = coalesce((select unread  from agg), c.unread_count),
       status          = 'open'
 where c.id = (select id from keep);

delete from conversations
 where contact_id = '4cb236f6-30c8-4d24-a91a-9db786425cee'
   and id <> (select id from conversations
               where contact_id = '4cb236f6-30c8-4d24-a91a-9db786425cee'
               order by created_at asc limit 1);

-- ── PART A.5 — union tags onto the winner (matches the merge route) ─────────
update contacts w
   set tags = (
     select coalesce(array_agg(distinct t), '{}')
       from (
         select unnest(coalesce(w.tags, '{}'::text[])) as t
         union
         select unnest(coalesce((select l.tags from contacts l
                                  where l.id = '68099477-b7a6-4807-b339-6a89ab101c4e'), '{}'::text[]))
       ) s
   )
 where w.id = '4cb236f6-30c8-4d24-a91a-9db786425cee';

-- ── PART A.6 — soft-delete the loser ────────────────────────────────────────
-- The row STAYS. merged_into_id hides it from every read path that filters on
-- it; do_not_contact prevents any outreach that doesn't. Fully reversible:
-- null out merged_into_id to restore, and contact_merge_log holds the snapshot.
update contacts
   set merged_into_id  = '4cb236f6-30c8-4d24-a91a-9db786425cee',
       do_not_contact  = true
 where id = '68099477-b7a6-4807-b339-6a89ab101c4e';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION (run after; no Part B exists — nothing is deleted).
-- 1. Every contact-referencing column should report 0 loser rows:
--    select table_name, column_name,
--      (xpath('/row/cnt/text()', query_to_xml(
--         format('select count(*) as cnt from %I.%I where %I = %L', table_schema, table_name, column_name,
--                '68099477-b7a6-4807-b339-6a89ab101c4e'), false, true, '')))[1]::text::int as loser_rows
--    from information_schema.columns
--    where table_schema='public'
--      and (column_name like '%contact_id%' or (table_name='equipment' and column_name='assigned_to'))
--    order by loser_rows desc;
--
-- 2. Cameron should have exactly ONE conversation:
--    select count(*) from conversations where contact_id='4cb236f6-30c8-4d24-a91a-9db786425cee';
--
-- 3. The loser is hidden but intact, and the snapshot exists:
--    select id, merged_into_id, do_not_contact from contacts where id='68099477-b7a6-4807-b339-6a89ab101c4e';
--    select winner_id, loser_id, merge_details->'reason' from contact_merge_log
--     where loser_id='68099477-b7a6-4807-b339-6a89ab101c4e';
--
-- TO REVERSE:
--    update contacts set merged_into_id = null, do_not_contact = false
--     where id = '68099477-b7a6-4807-b339-6a89ab101c4e';
--    (child records stay with the winner; repoint from the snapshot if needed)
