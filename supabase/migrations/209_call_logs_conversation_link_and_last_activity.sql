-- 209_call_logs_conversation_link_and_last_activity.sql
--
-- STATUS: APPLIED 2026-09-29 by hand in the Supabase SQL Editor, EXCEPT the
-- COMMENT ON statements (see NOT APPLIED below). Verified after apply: 42/42
-- call_logs rows linked to a conversation, 19 of 24 threads carrying a
-- last_activity_at, both triggers present and enabled, and
-- call_logs_conversation_id_fkey present with convalidated = false, which is
-- the intended NOT VALID state.
--
-- NOT APPLIED: all three COMMENT ON statements in this file. Measured
-- 2026-09-29 after the apply, col_description and obj_description both return
-- NULL for call_logs.conversation_id, conversations.last_activity_at and
-- fn_bump_conversation_activity(). That is one more than the two column
-- comments first reported, so the function comment is missing too. Comments
-- carry no behaviour, so nothing is broken, but the semantics of NULL in each
-- column now live only in this file. To finish, run lines 209-210, 232-233 and
-- 301-302 on their own; each is idempotent and re-runnable.
--
-- APPLY ORDER, OUT OF ORDER: fn_bump_conversation_activity() went to production
-- ahead of the rest of the file, also on 2026-09-29; the body here is that live
-- version verbatim. Everything else, both ALTERs, the FK, the two indexes, both
-- backfills and the two CREATE TRIGGER statements, was applied afterwards in
-- the same session. Re-running the CREATE OR REPLACE is a no-op against the
-- live definition. If you edit the body, apply that change separately too, or
-- the file and production drift again.
--
-- To re-run this file from scratch against a fresh database, run it whole: the
-- guards make every statement idempotent.
--
-- Numbering: 208 is the highest applied Hub migration (version 20260916104738).
-- 206 is committed-but-unapplied and 203 is claimed by an unapplied platform
-- change that has no file in this repo, so 209 is the next free number in the
-- Hub-owned 200+ band. The ledger keys on the timestamp `version`, not on this
-- filename prefix.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
-- Two facts, both measured live on 2026-09-29 through pg_catalog:
--
--  (1) public.call_logs HAS NO conversation_id COLUMN. crm_001 declares one,
--      but the live table was built elsewhere and never got it (pg_attribute
--      returns 0 rows for attname='conversation_id'). Consequences today:
--        - src/components/crm/comms-timeline.tsx has to join calls to a thread
--          by contact_id, which is why its header comment says "call_logs has
--          no conversation_id". With a contact holding two threads that join is
--          already ambiguous (measured: 1 such contact).
--        - src/app/api/voice/token/route.ts INSERTs conversation_id (and
--          called_by, also absent). PostgREST rejects the unknown column and
--          the surrounding try/catch swallows it as a console.warn. RESULT:
--          no outbound call has ever been logged — all 42 call_logs rows are
--          direction='inbound'. This migration makes that insert land. The
--          called_by half is deliberately NOT added here (see BLAST RADIUS).
--
--  (2) Thread ordering uses conversations.last_message_at, which bumpConversation()
--      writes with new Date() — the wall clock at webhook receipt, not the
--      event's own time — and which is never written at all for outbound calls.
--      "Order by most recent activity" therefore cannot be made correct in app
--      code alone: any writer that forgets the bump silently sinks a thread. A
--      trigger cannot be forgotten, so last_activity_at is maintained in the
--      database, from each event's OWN timestamp.
--
-- REJECTED: overloading last_message_at to mean "any activity". It is read by
-- the thread-list fallback in crm/conversations/page.tsx and by
-- contact-detail.tsx, and 068 gave it the sibling rollups last_message_preview
-- and last_direction that are genuinely message-shaped. Redefining it in place
-- would change those reads with no way to tell old semantics from new. A new
-- additive column is reversible: drop it and the old ordering is intact.
--
-- REJECTED: adding call_logs.line_e164. 207's column comment is explicit that
-- the per-event line lives on call_logs.to_number/from_number and the
-- per-thread line on conversations.line_e164. Nothing here changes that.
--
-- ── BLAST RADIUS ─────────────────────────────────────────────────────────────
-- Measured 2026-09-29: call_logs 42 rows (42 with contact_id, 0 without, 42
-- matchable to a conversation); conversations 24 rows (14 sms / 10 voice, 5
-- with NULL last_message_at, 1 contact holding >1 thread, 1 orphan thread whose
-- contact is gone); crm_messages 56 rows.
--
-- Both ALTERs are additive, nullable and carry no DEFAULT, so neither rewrites
-- its table and neither holds more than a brief ACCESS EXCLUSIVE lock on a
-- 42-row and a 24-row table. The FK is created NOT VALID, matching 070's
-- precedent on conversations_contact_id_fkey and avoiding a validation scan
-- against a table that still holds the 1 orphan row from that same issue.
--
-- NOT DONE HERE, on purpose: call_logs.called_by; widening the call_logs status
-- CHECK (voice/answered writes 'answered', which the CHECK rejects); the
-- call-status CallSid mis-attribution; inbound-call signature validation. Those
-- are the open defects recorded at CURRENT.md:69-86 and are out of scope.
--
-- ── RLS ──────────────────────────────────────────────────────────────────────
-- No policy is created, altered or dropped. The live policies stay exactly as
-- 067 left them: call_logs_staff_org_rls and conversations_staff_org_rls gate
-- on org_id + get_my_role(); crm_messages_staff_org_rls gates through the
-- parent conversation. A new COLUMN inherits its table's policies, so
-- conversation_id and last_activity_at are readable by precisely who can
-- already read the row and by nobody else. crm_messages_org_via_conversation is
-- platform-owned and is not touched.
--
-- The trigger function is SECURITY DEFINER because the Twilio webhooks write
-- call_logs/crm_messages under service_role while other writers are RLS-bound,
-- and the bump must land either way. search_path is pinned to public, pg_temp.
-- It writes one column, only ever forward, and widens no one's visibility.

-- ═════════════════════════════════════════════════════════════════════════════
-- PRE-CHECK PROBES — run these first and confirm each EXPECT before the DDL.
-- pg_catalog, not information_schema: a least-privileged role gets empty
-- results from information_schema, which would read as "column absent".
-- ═════════════════════════════════════════════════════════════════════════════

-- PC1. conversation_id must be absent; started_at and contact_id must exist.
-- EXPECT: has_conversation_id = 0, has_started_at = 1, has_contact_id = 1.
SELECT
  count(*) FILTER (WHERE attname = 'conversation_id') AS has_conversation_id,
  count(*) FILTER (WHERE attname = 'started_at')      AS has_started_at,
  count(*) FILTER (WHERE attname = 'contact_id')      AS has_contact_id
FROM pg_catalog.pg_attribute
WHERE attrelid = 'public.call_logs'::regclass AND attnum > 0 AND NOT attisdropped;

-- PC2. last_activity_at must be absent on conversations.
-- EXPECT: 0.
SELECT count(*) AS has_last_activity_at
FROM pg_catalog.pg_attribute
WHERE attrelid = 'public.conversations'::regclass
  AND attname = 'last_activity_at' AND attnum > 0 AND NOT attisdropped;

-- PC3. Every call row must resolve to exactly one thread under the oldest-wins
-- rule the app already applies (crm-server.ts getOrCreateConversation orders by
-- created_at ASC LIMIT 1 and IGNORES channel).
-- EXPECT (2026-09-29): total 42, resolvable 42, unresolvable 0.
WITH pick AS (
  SELECT DISTINCT ON (contact_id) contact_id, id
  FROM public.conversations
  ORDER BY contact_id, created_at ASC, id ASC
)
SELECT count(*) AS total,
       count(pick.id) AS resolvable,
       count(*) - count(pick.id) AS unresolvable
FROM public.call_logs cl
LEFT JOIN pick ON pick.contact_id = cl.contact_id;

-- PC4. Nothing else on conversations reacts to an UPDATE. The bump triggers
-- fire on call_logs and crm_messages, but each one UPDATEs a conversations row,
-- so any pre-existing trigger there would run once per bump — and a BEFORE
-- trigger that rewrote the row, or any trigger that wrote back to call_logs or
-- crm_messages, would recurse. Confirm the only one present is the harmless
-- updated_at stamp before adding a new write path to this table.
-- EXPECT: exactly one row — trg_updated_at, BEFORE UPDATE ... FOR EACH ROW
-- EXECUTE FUNCTION update_updated_at(), which only stamps updated_at.
SELECT t.tgname,
       CASE WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
       CASE WHEN (t.tgtype & 4) <> 0 THEN 'INSERT' ELSE '' END
         || CASE WHEN (t.tgtype & 8)  <> 0 THEN ' DELETE' ELSE '' END
         || CASE WHEN (t.tgtype & 16) <> 0 THEN ' UPDATE' ELSE '' END AS events,
       p.proname AS function_name,
       pg_get_triggerdef(t.oid) AS def
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.conversations'::regclass
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- DRY RUN 1. What last_activity_at will become, and how many threads move.
-- EXPECT (2026-09-29, measured): threads 24, changed 8, still_null 5.
-- Those 8 are threads whose newest event is a CALL and which the current
-- last_message_at ordering therefore sinks below quieter texted threads.
WITH ev AS (
  SELECT cv.id,
         cv.last_message_at,
         GREATEST(
           cv.last_message_at,
           (SELECT max(coalesce(m.sent_at, m.created_at))
              FROM public.crm_messages m WHERE m.conversation_id = cv.id),
           (SELECT max(cl.started_at)
              FROM public.call_logs cl WHERE cl.contact_id = cv.contact_id)
         ) AS computed
  FROM public.conversations cv
)
SELECT count(*) AS threads,
       count(*) FILTER (WHERE computed IS DISTINCT FROM last_message_at) AS changed,
       count(*) FILTER (WHERE computed IS NULL) AS still_null
FROM ev;

-- ═════════════════════════════════════════════════════════════════════════════
-- DDL
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. call_logs.conversation_id ─────────────────────────────────────────────
ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS conversation_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conname = 'call_logs_conversation_id_fkey'
      AND c.conrelid = 'public.call_logs'::regclass
  ) THEN
    ALTER TABLE public.call_logs
      ADD CONSTRAINT call_logs_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_call_logs_conversation
  ON public.call_logs (conversation_id, started_at DESC)
  WHERE conversation_id IS NOT NULL;

COMMENT ON COLUMN public.call_logs.conversation_id IS
  'The Conversations thread this call belongs to. NULL means the call predates the link or its contact has no thread, and a reader must then fall back to contact_id. Backfilled by 209 using the same oldest-thread-per-contact rule that crm-server.ts getOrCreateConversation applies (ORDER BY created_at ASC LIMIT 1, channel ignored). The FK is NOT VALID, matching 070.';

-- Backfill. Oldest thread per contact wins, so the result agrees with whatever
-- getOrCreateConversation would have returned when the call was placed.
WITH pick AS (
  SELECT DISTINCT ON (contact_id) contact_id, id
  FROM public.conversations
  ORDER BY contact_id, created_at ASC, id ASC
)
UPDATE public.call_logs cl
SET conversation_id = pick.id
FROM pick
WHERE pick.contact_id = cl.contact_id
  AND cl.conversation_id IS NULL;

-- ── 2. conversations.last_activity_at ────────────────────────────────────────
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_conversations_org_last_activity
  ON public.conversations (org_id, last_activity_at DESC NULLS LAST);

COMMENT ON COLUMN public.conversations.last_activity_at IS
  'Newest timestamp of ANY event on this thread: a text (crm_messages.sent_at, else created_at), or a call, voicemail or missed call (call_logs.started_at). This is the thread-list ORDER BY. It differs from last_message_at in two ways that matter: it counts calls, and it stores the EVENT''s own time rather than the wall clock at webhook receipt. Maintained by trg_conv_activity_from_messages and trg_conv_activity_from_calls, which only ever move it forward. NULL means a thread with no events yet.';

-- Backfill. Calls are joined by contact_id as well as conversation_id so that
-- any row step 1 could not link still contributes.
WITH ev AS (
  SELECT cv.id,
         GREATEST(
           cv.last_message_at,
           (SELECT max(coalesce(m.sent_at, m.created_at))
              FROM public.crm_messages m WHERE m.conversation_id = cv.id),
           (SELECT max(cl.started_at)
              FROM public.call_logs cl
             WHERE cl.conversation_id = cv.id OR cl.contact_id = cv.contact_id)
         ) AS computed
  FROM public.conversations cv
)
UPDATE public.conversations cv
SET last_activity_at = ev.computed
FROM ev
WHERE ev.id = cv.id
  AND ev.computed IS NOT NULL
  AND cv.last_activity_at IS DISTINCT FROM ev.computed;

-- ── 3. Triggers that keep last_activity_at true ──────────────────────────────
-- Monotonic: GREATEST plus the guarded WHERE means a late-arriving webhook for
-- an older event can never pull a thread backwards. One statement, one column,
-- no status change — the archive/resurface semantics that bumpConversation()
-- implements stay entirely in app code.
CREATE OR REPLACE FUNCTION public.fn_bump_conversation_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_conv uuid;
  v_at   timestamptz;
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'crm_messages' THEN
      v_conv := NEW.conversation_id;
      v_at   := coalesce(NEW.sent_at, NEW.created_at);
    ELSE
      v_conv := NEW.conversation_id;
      v_at   := NEW.started_at;
      IF v_conv IS NULL AND NEW.contact_id IS NOT NULL THEN
        SELECT id INTO v_conv
        FROM public.conversations
        WHERE contact_id = NEW.contact_id
        ORDER BY created_at ASC, id ASC
        LIMIT 1;
      END IF;
    END IF;

    IF v_conv IS NOT NULL AND v_at IS NOT NULL THEN
      UPDATE public.conversations
      SET last_activity_at = GREATEST(coalesce(last_activity_at, v_at), v_at)
      WHERE id = v_conv
        AND (last_activity_at IS NULL OR last_activity_at < v_at);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_bump_conversation_activity failed for %: %', v_conv, SQLERRM;
  END;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.fn_bump_conversation_activity() IS
  'AFTER-trigger body for conversations.last_activity_at. SECURITY DEFINER because the Twilio webhooks write call_logs/crm_messages under service_role while other writers are RLS-bound, and the bump must land either way; search_path is pinned. Writes exactly one column and only ever forward. A failure inside the bump is caught and logged as a WARNING so it can never abort the call_logs or crm_messages insert.';

DROP TRIGGER IF EXISTS trg_conv_activity_from_messages ON public.crm_messages;
CREATE TRIGGER trg_conv_activity_from_messages
  AFTER INSERT OR UPDATE OF sent_at, created_at, conversation_id
  ON public.crm_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bump_conversation_activity();

DROP TRIGGER IF EXISTS trg_conv_activity_from_calls ON public.call_logs;
CREATE TRIGGER trg_conv_activity_from_calls
  AFTER INSERT OR UPDATE OF started_at, conversation_id, contact_id, status
  ON public.call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bump_conversation_activity();

NOTIFY pgrst, 'reload schema';

-- ═════════════════════════════════════════════════════════════════════════════
-- POST-APPLY PROBES
-- ═════════════════════════════════════════════════════════════════════════════

-- P1. Both columns exist, nullable, no default.
-- EXPECT: 2 rows, attnotnull false, default_expr NULL.
SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod) AS type,
       a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default_expr
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE (c.oid = 'public.call_logs'::regclass     AND a.attname = 'conversation_id')
   OR (c.oid = 'public.conversations'::regclass AND a.attname = 'last_activity_at');

-- P2. FK present and NOT VALID; both indexes present.
-- EXPECT: 1 constraint row with convalidated = false; 2 index rows.
SELECT conname, pg_get_constraintdef(oid) AS def, convalidated
FROM pg_catalog.pg_constraint
WHERE conname = 'call_logs_conversation_id_fkey';

SELECT i.relname, pg_get_indexdef(x.indexrelid) AS def
FROM pg_catalog.pg_index x
JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
WHERE i.relname IN ('idx_call_logs_conversation', 'idx_conversations_org_last_activity');

-- P3. Backfill landed. VERIFY BY ROW COUNT, NOT BY error = null: an RLS-filtered
-- UPDATE returns no error and zero rows (CURRENT.md:233-236).
-- EXPECT (2026-09-29): calls 42, linked 42, unlinked 0.
SELECT count(*) AS calls,
       count(conversation_id) AS linked,
       count(*) - count(conversation_id) AS unlinked
FROM public.call_logs;

-- EXPECT (2026-09-29, measured): threads 24, with_activity 19, null_activity 5
-- (the five threads that have neither a message nor a call), and
-- ahead_of_last_message 8 — the threads whose newest event is a CALL, which is
-- exactly the ordering bug this migration exists to fix.
SELECT count(*) AS threads,
       count(last_activity_at) AS with_activity,
       count(*) - count(last_activity_at) AS null_activity,
       count(*) FILTER (
         WHERE last_activity_at IS NOT NULL
           AND (last_message_at IS NULL OR last_activity_at > last_message_at)
       ) AS ahead_of_last_message
FROM public.conversations;

-- P4. Both triggers present and enabled.
-- EXPECT: 2 rows, tgenabled = 'O'.
SELECT c.relname AS table_name, t.tgname, t.tgenabled,
       pg_get_triggerdef(t.oid) AS def
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND t.tgname IN ('trg_conv_activity_from_messages', 'trg_conv_activity_from_calls');

-- P5. Nothing changed about who can read these tables.
-- EXPECT: exactly the three 067 policies, unchanged; relrowsecurity still true.
SELECT c.relname, c.relrowsecurity, p.polname, p.polcmd
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('call_logs', 'conversations', 'crm_messages')
ORDER BY c.relname, p.polname;

-- P6. OPTIONAL live trigger round-trip. Moves one thread's last_activity_at
-- forward through a real call_logs UPDATE, then restores both values. Safe, but
-- it does write — run it only if you want the end-to-end proof.
-- EXPECT: after > before (or after set where before was NULL).
--
-- DO $$
-- DECLARE v_call uuid; v_conv uuid; v_before timestamptz; v_at timestamptz; v_after timestamptz;
-- BEGIN
--   SELECT id, conversation_id, started_at INTO v_call, v_conv, v_at
--     FROM public.call_logs WHERE conversation_id IS NOT NULL
--     ORDER BY started_at DESC LIMIT 1;
--   SELECT last_activity_at INTO v_before FROM public.conversations WHERE id = v_conv;
--   UPDATE public.call_logs SET started_at = now() WHERE id = v_call;
--   SELECT last_activity_at INTO v_after FROM public.conversations WHERE id = v_conv;
--   RAISE NOTICE 'before=% after=%', v_before, v_after;
--   UPDATE public.call_logs SET started_at = v_at WHERE id = v_call;
--   UPDATE public.conversations SET last_activity_at = v_before WHERE id = v_conv;
-- END $$;

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_conv_activity_from_calls ON public.call_logs;
-- DROP TRIGGER IF EXISTS trg_conv_activity_from_messages ON public.crm_messages;
-- DROP FUNCTION IF EXISTS public.fn_bump_conversation_activity();
-- DROP INDEX IF EXISTS public.idx_conversations_org_last_activity;
-- DROP INDEX IF EXISTS public.idx_call_logs_conversation;
-- ALTER TABLE public.conversations DROP COLUMN IF EXISTS last_activity_at;
-- ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_conversation_id_fkey;
-- ALTER TABLE public.call_logs DROP COLUMN IF EXISTS conversation_id;
-- NOTIFY pgrst, 'reload schema';
