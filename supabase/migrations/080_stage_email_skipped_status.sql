-- 080_stage_email_skipped_status.sql
-- Add 'skipped' to stage_email_sends.status so gate-skips (no email, no consent,
-- no team_id, already_sent) leave a durable, diagnosable row instead of living
-- only in the HTTP response the browser got. Three client-send investigations
-- this session could not be answered from the database because a skip persisted
-- nothing -- this closes that.
--
-- 'skipped' is deliberately NOT in the partial unique index
-- (stage_email_sends_once covers only 'sending' and 'sent'), so a skip never
-- blocks a future legitimate send and multiple skip rows for the same
-- (contact, stage, email) can accumulate as an attempt log.

alter table public.stage_email_sends
  drop constraint if exists stage_email_sends_status_check;

alter table public.stage_email_sends
  add constraint stage_email_sends_status_check
  check (status in ('sending','sent','failed','skipped'));

-- Verification:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.stage_email_sends'::regclass and contype='c';
