-- 068_twilio_conversations_schema.sql
-- Conversations feature -- SCHEMA EXTENSION ONLY (spec build order, stage 1).
-- No route/webhook changes here; the inbound signature-verification fix and all
-- src/app/api/twilio/* work follow in a later change.
--
-- DECISION (your instruction): extend the existing production tables rather than
-- create parallel crm_comm_*. This migration adds the missing Twilio columns to
-- their NATURAL existing homes and adds one new number->org map table.
--
-- COLUMN HOMING -- where each requested field landed and why:
--
--   SMS / MMS  -> crm_messages
--     already has: twilio_sid, direction(check), status(check incl 'received'),
--                  body, conversation_id, sent_by
--     ADD: org_id, msg_type(sms|mms), media_urls, from_e164, to_e164, error_code
--
--   Voice / voicemail / missed_call  -> call_logs   (NOT crm_messages)
--     already has: recording_url, transcript, external_call_sid (=CallSid),
--                  duration_seconds, from_number, to_number, direction(check),
--                  status(check ALREADY includes 'voicemail' AND 'missed')
--     ADD: recording_sid, transcription_status(pending|completed|failed)
--     >>> This is the one fork in your column list. call_logs is already the
--         voice home in production, so recording_sid / transcription_status /
--         the voicemail+missed states go HERE, not onto crm_messages. If you
--         instead want a single unified message table (spec's crm_comm_messages
--         shape), say so and I'll redo 068 to migrate call_logs into crm_messages
--         -- that's a bigger change with a data backfill, hence flagging at review.
--
--   Thread rollups  -> conversations
--     already has: last_message_at, unread_count, channel(check), status(check)
--     ADD: last_message_preview, last_direction(inbound|outbound)
--
--   Number -> org map  -> NEW TABLE crm_twilio_numbers
--
--   contact_communications: left UNTOUCHED. It is a generic cross-channel log
--     (email included) with its own shape; nothing in this feature needs new
--     columns there. Its RLS was NOT part of 067 -- noted at the foot as a
--     follow-up, out of scope for this migration.
--
-- ROW COUNTS (verified pre-migration): crm_messages 0, call_logs 0,
-- conversations 2 (both org_id non-null). All ADD COLUMN are nullable, so every
-- statement is non-blocking and no existing row is invalidated.
--
-- NOTE on NOT NULL: crm_messages.org_id is added NULLABLE on purpose. Existing
-- insert code (api/sms/send, api/twilio/inbound-sms) does not yet set it; the
-- route work that populates org_id lands next, and a follow-up migration can
-- then enforce NOT NULL once every writer is updated. Enforcing it now would
-- break the current send path on its next insert.
--
-- TRANSACTION: no outer BEGIN/COMMIT here -- this is applied via MCP
-- apply_migration, which wraps its own transaction. If re-run manually in the
-- Supabase SQL Editor, WRAP the whole file in BEGIN; ... COMMIT; for atomicity.
--
-- RLS + nullable org_id: crm_messages RLS scopes via conversation_id ->
-- conversations.org_id, NOT via crm_messages.org_id, so a NULL org_id cannot
-- fail open. A NULL scope value yields `NULL IN (...)` = NULL, which RLS treats
-- as not-visible (only exactly TRUE grants a row). Verified empirically 2026-07-20.

-- ===========================================================================
-- 1. crm_twilio_numbers -- maps each owned Twilio number to an org (inbound
--    routing key; one webhook URL serves all tenants).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS crm_twilio_numbers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone_e164    text NOT NULL UNIQUE,
  friendly_name text,
  purpose       text,            -- optional, mirrors twilio-org.ts routing labels
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_twilio_numbers_org ON crm_twilio_numbers (org_id);

ALTER TABLE crm_twilio_numbers ENABLE ROW LEVEL SECURITY;

-- RLS -- identical shape to 067 (superadmin branch mandatory, ARRAY staff gate,
-- user_org_ids() org scope, explicit WITH CHECK).
DROP POLICY IF EXISTS "crm_twilio_numbers_staff_org_rls" ON crm_twilio_numbers;
CREATE POLICY "crm_twilio_numbers_staff_org_rls" ON crm_twilio_numbers
  FOR ALL
  USING (
    has_role(auth.uid(), 'superadmin'::user_role)
    OR (
      get_my_role() = ANY (ARRAY['admin', 'facilitator'])
      AND org_id IN (SELECT user_org_ids())
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'superadmin'::user_role)
    OR (
      get_my_role() = ANY (ARRAY['admin', 'facilitator'])
      AND org_id IN (SELECT user_org_ids())
    )
  );

REVOKE ALL ON crm_twilio_numbers FROM anon;

-- ===========================================================================
-- 2. crm_messages -- SMS/MMS additions
-- ===========================================================================
ALTER TABLE crm_messages
  ADD COLUMN IF NOT EXISTS org_id     uuid REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS msg_type   text NOT NULL DEFAULT 'sms',
  ADD COLUMN IF NOT EXISTS media_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS from_e164  text,
  ADD COLUMN IF NOT EXISTS to_e164    text,
  ADD COLUMN IF NOT EXISTS error_code text;

-- msg_type domain (sms|mms). Added separately so ADD COLUMN IF NOT EXISTS above
-- stays idempotent; guard the constraint too.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_messages_msg_type_check'
  ) THEN
    ALTER TABLE crm_messages
      ADD CONSTRAINT crm_messages_msg_type_check
      CHECK (msg_type = ANY (ARRAY['sms','mms']));
  END IF;
END $$;

-- Backfill org_id for the (zero) existing rows from their parent conversation,
-- so the column is coherent the moment routes start reading it.
-- DRY-RUN before apply:
--   SELECT count(*) FROM crm_messages m JOIN conversations c ON c.id=m.conversation_id
--   WHERE m.org_id IS NULL AND c.org_id IS NOT NULL;   -- expect 0 (table empty)
UPDATE crm_messages m
SET org_id = c.org_id
FROM conversations c
WHERE m.conversation_id = c.id AND m.org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_crm_messages_org ON crm_messages (org_id);
-- twilio_sid already exists; make it a reliable callback key (status/delivery
-- callbacks UPDATE by MessageSid). Partial unique -> allows many NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_messages_twilio_sid
  ON crm_messages (twilio_sid) WHERE twilio_sid IS NOT NULL;

-- ===========================================================================
-- 3. call_logs -- voicemail/transcription additions (voice already lives here)
-- ===========================================================================
ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS recording_sid        text,
  ADD COLUMN IF NOT EXISTS transcription_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'call_logs_transcription_status_check'
  ) THEN
    ALTER TABLE call_logs
      ADD CONSTRAINT call_logs_transcription_status_check
      CHECK (transcription_status IS NULL
             OR transcription_status = ANY (ARRAY['pending','completed','failed']));
  END IF;
END $$;

-- external_call_sid (=CallSid) is the callback key for recording/transcription/
-- voice-status UPDATEs. Guarantee uniqueness for keyed updates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_logs_external_sid
  ON call_logs (external_call_sid) WHERE external_call_sid IS NOT NULL;

-- ===========================================================================
-- 4. conversations -- thread-list rollups for the two-pane inbox
-- ===========================================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_message_preview text,
  ADD COLUMN IF NOT EXISTS last_direction       text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_last_direction_check'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_last_direction_check
      CHECK (last_direction IS NULL
             OR last_direction = ANY (ARRAY['inbound','outbound']));
  END IF;
END $$;

-- ===========================================================================
-- POST-APPLY PROBES
-- ===========================================================================
-- Q1 -- new columns exist:
--   select table_name, column_name from information_schema.columns
--   where table_schema='public'
--     and (table_name='crm_messages' and column_name in ('org_id','msg_type','media_urls','from_e164','to_e164','error_code'))
--      or (table_name='call_logs' and column_name in ('recording_sid','transcription_status'))
--      or (table_name='conversations' and column_name in ('last_message_preview','last_direction'));
--   -- NOTE: introspect via pg_catalog under least-priv roles; information_schema
--   --       may return empty. Use pg_attribute join if this comes back short.
--
-- Q2 -- crm_twilio_numbers RLS matches 067 shape (superadmin-led, with_check):
--   select policyname, (with_check is not null) from pg_policies
--   where schemaname='public' and tablename='crm_twilio_numbers';
--
-- Q3 -- callback keys are unique:
--   select indexname from pg_indexes where schemaname='public'
--   and indexname in ('uq_crm_messages_twilio_sid','uq_call_logs_external_sid');

-- ===========================================================================
-- SEED TEMPLATE -- crm_twilio_numbers (fill real numbers/org before go-live;
-- inbound events for an unmapped number are dropped by the org-resolution guard)
-- ===========================================================================
-- INSERT INTO crm_twilio_numbers (org_id, phone_e164, friendly_name, purpose, is_default) VALUES
--   ('00000000-0000-0000-0000-000000000001', '+1XXXXXXXXXX', 'NP main line', 'inbound_main', true);

-- ---------------------------------------------------------------------------
-- OUT OF SCOPE (tracked, not done here):
--   * contact_communications RLS was not part of 067 and is not touched here.
--   * enforcing crm_messages.org_id NOT NULL -- after route writers populate it.
--   * inbound webhook signature-verification fix (reject, not warn-and-continue).
-- ---------------------------------------------------------------------------
