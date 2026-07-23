-- 076_fix_erica_thiessen_merge_direction.sql
-- DATA REPAIR (not a schema change). Reviewed before apply; run once.
--
-- Merge 312a2f3f-a28a-4a70-94d8-2ac089fec1de (2026-07-23 00:16:56) joined two
-- genuine duplicates of Erica Thiessen in the WRONG direction:
--     survivor  436781be  erica@lifetutors.org
--     retired   c720f984  erica.thiessen.house@gmail.com
-- The gmail record is the correct survivor. This flips the direction.
--
-- WHY NOT "reverse from snapshot, then re-merge":
--   merge_contact_repoint records per-TABLE counts, not per-ROW provenance, so
--   there is nothing recording which rows originally belonged to which contact.
--   Running it backwards moves EVERYTHING to the gmail record regardless — which
--   is exactly the desired end state. The reverse and the re-merge are therefore
--   the same operation, and splitting them into two transactions only adds an
--   intermediate state where the data sits on neither record correctly.
--
--   The snapshot is still load-bearing: it is what confirms the gmail record's
--   pre-merge field values (do_not_contact was false, merged_into_id was null,
--   tags ['xRegulation'], stage 'Completed Course moving to nurture'). It just
--   cannot restore row ownership, because it never captured it.
--
-- THE TRAP THIS AVOIDS: merge_contact_repoint DELETEs the loser's
--   contact_interaction_score row rather than repointing it (UNIQUE(contact_id)).
--   The original merge already deleted the gmail record's score row. A naive
--   re-run would delete the lifetutors one too and leave Erica with NO
--   interaction score at all. Step 2 moves it by hand first, so the function's
--   delete is a no-op.
--
-- TAGS ARE DELIBERATELY NOT TOUCHED: both records carry exactly ['xRegulation'],
-- so there is no union to apply. That keeps this repair clear of
-- handle_contact_tag_change entirely — it does NOT depend on migration 075.

begin;

-- ── 1. Un-retire the gmail record ──────────────────────────────────────────
-- Must run BEFORE the repoint: merge_contact_repoint rewrites
-- `contacts.merged_into_id = p_loser` to the winner, which would otherwise make
-- c720f984 point at itself.
update contacts
   set merged_into_id = null,
       do_not_contact = false          -- matches loser_snapshot
 where id = 'c720f984-5070-4d1d-be63-7ed6bcc75ae8'
   and merged_into_id = '436781be-a2f4-4e74-958a-bdf8a39b7a90';

-- ── 2. Move the interaction score by hand (see trap note above) ────────────
update contact_interaction_score
   set contact_id = 'c720f984-5070-4d1d-be63-7ed6bcc75ae8'
 where contact_id = '436781be-a2f4-4e74-958a-bdf8a39b7a90'
   and not exists (
     select 1 from contact_interaction_score
      where contact_id = 'c720f984-5070-4d1d-be63-7ed6bcc75ae8');

-- ── 3. Repoint everything else onto the gmail record ───────────────────────
-- Dry-run showed exactly 6 rows across 3 tables:
--   contact_interaction_score 1 (handled in step 2)
--   contact_timeline          4
--   identity_graph            1
select public.merge_contact_repoint(
  '436781be-a2f4-4e74-958a-bdf8a39b7a90'::uuid,   -- p_loser  (lifetutors)
  'c720f984-5070-4d1d-be63-7ed6bcc75ae8'::uuid    -- p_winner (gmail)
);

-- ── 4. Retire the lifetutors record ────────────────────────────────────────
update contacts
   set merged_into_id = 'c720f984-5070-4d1d-be63-7ed6bcc75ae8',
       do_not_contact = true
 where id = '436781be-a2f4-4e74-958a-bdf8a39b7a90';

-- ── 5. Audit row for the corrected direction ───────────────────────────────
-- The original log row is left untouched — it is the record of what happened.
-- This adds the correction on top, snapshotting both rows as they stand now.
insert into contact_merge_log (org_id, winner_id, loser_id, merged_by, merge_details)
select
  '00000000-0000-0000-0000-000000000001'::uuid,
  'c720f984-5070-4d1d-be63-7ed6bcc75ae8'::uuid,
  '436781be-a2f4-4e74-958a-bdf8a39b7a90'::uuid,
  null,                                  -- applied as a migration, not by a user
  jsonb_build_object(
    'reason', 'direction correction — re-merged onto erica.thiessen.house@gmail.com',
    'corrects_merge_log_id', '312a2f3f-a28a-4a70-94d8-2ac089fec1de',
    'applied_by', 'migration 076',
    'loser_snapshot',  (select to_jsonb(c) from contacts c where c.id='436781be-a2f4-4e74-958a-bdf8a39b7a90'),
    'winner_snapshot_before', (select to_jsonb(c) from contacts c where c.id='c720f984-5070-4d1d-be63-7ed6bcc75ae8')
  );

commit;

-- Verification (expect: gmail active, lifetutors retired, 6 rows on gmail, 0 on lifetutors):
--   select id, email, merged_into_id, do_not_contact from contacts
--    where id in ('c720f984-5070-4d1d-be63-7ed6bcc75ae8','436781be-a2f4-4e74-958a-bdf8a39b7a90');
--   select 'timeline', count(*) from contact_timeline where contact_id='c720f984-5070-4d1d-be63-7ed6bcc75ae8'
--   union all select 'identity_graph', count(*) from identity_graph where contact_id='c720f984-5070-4d1d-be63-7ed6bcc75ae8'
--   union all select 'score', count(*) from contact_interaction_score where contact_id='c720f984-5070-4d1d-be63-7ed6bcc75ae8';
