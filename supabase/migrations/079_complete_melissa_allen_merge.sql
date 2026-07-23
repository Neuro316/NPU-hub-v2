-- 079_complete_melissa_allen_merge.sql  (APPLIED 2026-07-23)
-- Finish the Melissa Allen merge that died on the lifecycle label bug.
--
-- Two attempts (07-22 23:16, 07-23 00:14) ran merge_contact_repoint successfully
-- then threw on the tags UPDATE, before the loser was flagged. The data movement
-- was ALREADY DONE -- 4c4819cc held nothing. Only the tag union and the
-- soft-delete flag were outstanding.
--
--   winner 5c661e5c  Melissa.k.allen10@gmail.com  tags [xRegulation]
--   loser  4c4819cc  melissa.k.allen10@gmail.com  tags [Mastermind, Enrolled]
--                    (source 'stripe' -- the 07-15 clarity-protocol purchase)
--
-- The union goes through merge_union_tags (075) so the enrollment trigger stays
-- suppressed; adding 'Mastermind' would otherwise queue participant creation,
-- the exact side effect a merge must not cause. The snapshot from the failed
-- attempt already exists in contact_merge_log, so reversibility is preserved.
--
-- Idempotent: no-ops if the loser is already flagged.

do $$
declare
  v_winner uuid := '5c661e5c-d7d6-495d-b1c9-436edc2b1fbe';
  v_loser  uuid := '4c4819cc-9761-41a3-8480-d566488e9dd6';
  v_tags   text[];
begin
  if exists (select 1 from contacts where id = v_loser and merged_into_id is not null) then
    raise notice 'loser already flagged - nothing to do';
    return;
  end if;

  select array(select distinct unnest(
    coalesce((select tags from contacts where id = v_winner), '{}') ||
    coalesce((select tags from contacts where id = v_loser),  '{}')) order by 1)
  into v_tags;

  perform public.merge_union_tags(v_winner, v_tags);

  update contacts set merged_into_id = v_winner, do_not_contact = true where id = v_loser;
end $$;

-- KNOWN ISSUE, NOT FIXED HERE: the survivor carries do_not_contact = true and
-- pipeline_stage 'New Lead'. Both PRE-DATE every merge (winner_snapshot_before in
-- the 07-22 23:16 log row already shows dnc=true, stage='New Lead') while both
-- losers were dnc=false and one was 'Paid/ payment plan'. Melissa paid $2797 on
-- 07-15. Awaiting Cameron's decision -- see the field-choice note in the handoff.
