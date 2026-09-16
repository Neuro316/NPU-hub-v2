-- 207_conversations_line_e164.sql
-- STATUS: APPLIED 2026-09-16 via apply_migration, registered in schema_migrations
-- as 207_conversations_line_e164 (version 20260916104713). Verified after apply:
-- column text/nullable, index + check present, policy keeps WITH CHECK,
-- distribution NP 15 x +18284155050, 1 x +18289009821, Sensorium 2 NULL,
-- crm_twilio_numbers friendly_name = 'WNW Office'.
--
-- Multi-line Conversations (docs/HUB_Multi_Line_Conversations_Design.md §1, §7).
-- Adds conversations.line_e164: which of the org's own Twilio numbers a thread
-- most recently used. Additive, nullable, no default -> no table rewrite.
-- RLS untouched: 067's conversations_staff_org_rls is column-agnostic and
-- already carries WITH CHECK.
--
-- NULL means "the org's default line" (getVoiceCallerId in code). The Neuro
-- Progeny org is backfilled explicitly to +18284155050 so no NP row is NULL;
-- other orgs stay NULL because stamping an NP number on their threads is wrong.
--
-- Applied via MCP apply_migration (own transaction). In the SQL Editor wrap the
-- whole file in BEGIN; ... COMMIT;.
--
-- ---------------------------------------------------------------------------
-- PRE-CHECK PROBES (read-only; run BEFORE apply, both must hold)
-- ---------------------------------------------------------------------------
-- PC1 -- org identity for the hard-coded id below:
--   SELECT o.id, o.name FROM public.organizations o
--   WHERE o.id = '00000000-0000-0000-0000-000000000001';
--   EXPECT: exactly one row, Neuro Progeny.
--
-- PC2 -- both lines are mapped to that org (backfill 1 joins on this table,
--        and a missing row would silently leave every thread on that line NULL
--        until backfill 2 stamps it as NP):
--   SELECT n.phone_e164, n.friendly_name, n.purpose, n.is_default
--   FROM public.crm_twilio_numbers n
--   WHERE n.org_id = '00000000-0000-0000-0000-000000000001'
--   ORDER BY n.phone_e164;
--   EXPECT: +18284155050 and +18289009821, both present.
--
-- DRY RUN 1 (pre-apply; the column does not exist yet so there is no
--            line_e164 IS NULL predicate here):
--   WITH msg AS (...), calls AS (...), events AS (...), ranked AS (...)   -- same CTEs as below
--   SELECT r.line, count(*) FROM ranked r WHERE r.rn = 1 GROUP BY r.line;
--   EXPECT: only +18284155050 / +18289009821, all in org ...0001.
--
-- DRY RUN 2 (pre-apply): rows backfill 2 will touch = NP-org total minus the
--            DRY RUN 1 total.
--   SELECT count(*) FROM public.conversations cv
--   WHERE cv.org_id = '00000000-0000-0000-0000-000000000001';
-- ---------------------------------------------------------------------------

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS line_e164 text;

COMMENT ON COLUMN public.conversations.line_e164 IS
  'E.164 of the org''s own Twilio number this thread most recently used '
  '(inbound: the dialled/texted number; outbound: the From). NULL = the org''s '
  'default line as resolved by getVoiceCallerId(). Per-event line lives on '
  'crm_messages.to_e164/from_e164 and call_logs.to_number/from_number.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conname = 'conversations_line_e164_check'
      AND c.conrelid = 'public.conversations'::regclass
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_line_e164_check
      CHECK (line_e164 IS NULL OR line_e164 ~ '^\+[1-9][0-9]{6,14}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_org_line
  ON public.conversations (org_id, line_e164);

-- ---------------------------------------------------------------------------
-- Backfill 1: most recent event per conversation, kept only when the derived
-- number is one of the SAME org's Twilio numbers (so a contact's own number can
-- never be stamped as a line). Inbound call rows have no conversation_id, so
-- calls join through contact_id exactly as buildTimeline does.
-- ---------------------------------------------------------------------------
WITH msg AS (
  SELECT m.conversation_id,
         CASE WHEN m.direction = 'inbound' THEN m.to_e164 ELSE m.from_e164 END AS line,
         COALESCE(m.sent_at, m.created_at) AS at
  FROM public.crm_messages m
),
calls AS (
  SELECT cv.id AS conversation_id,
         CASE WHEN cl.direction = 'inbound' THEN cl.to_number ELSE cl.from_number END AS line,
         cl.started_at AS at
  FROM public.call_logs cl
  JOIN public.conversations cv ON cv.contact_id = cl.contact_id
),
events AS (
  SELECT * FROM msg
  UNION ALL
  SELECT * FROM calls
),
ranked AS (
  SELECT e.conversation_id, e.line,
         row_number() OVER (PARTITION BY e.conversation_id ORDER BY e.at DESC) AS rn
  FROM events e
  JOIN public.conversations cv ON cv.id = e.conversation_id
  JOIN public.crm_twilio_numbers n
    ON n.phone_e164 = e.line AND n.org_id = cv.org_id
  WHERE e.line IS NOT NULL
)
UPDATE public.conversations cv
SET line_e164 = r.line
FROM ranked r
WHERE r.conversation_id = cv.id
  AND r.rn = 1
  AND cv.line_e164 IS NULL;

-- ---------------------------------------------------------------------------
-- Backfill 2: everything else in the Neuro Progeny org is the NP main line.
-- ---------------------------------------------------------------------------
UPDATE public.conversations cv
SET line_e164 = '+18284155050'
WHERE cv.org_id = '00000000-0000-0000-0000-000000000001'
  AND cv.line_e164 IS NULL;

-- ---------------------------------------------------------------------------
-- D4: the 069 seed labelled +18289009821 'Campaign'. It is the Waynesville
-- Neuro Wellness office line. friendly_name is not read by the UI (the
-- dropdown uses crm_twilio.numbers[].nickname); this only makes the map table
-- honest. purpose stays 'outreach' on purpose (design §12 D4).
-- ---------------------------------------------------------------------------
UPDATE public.crm_twilio_numbers n
SET friendly_name = 'WNW Office'
WHERE n.phone_e164 = '+18289009821';

-- ---------------------------------------------------------------------------
-- No RLS change. If conversations_staff_org_rls is ever recreated it must keep
-- an explicit WITH CHECK (067 shape); this migration does not touch it.
-- ---------------------------------------------------------------------------

-- POST-APPLY PROBES (pg_catalog, not information_schema)
-- P1 column exists, nullable text:
--   SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull
--   FROM pg_catalog.pg_attribute a
--   JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
--   JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
--   WHERE ns.nspname = 'public' AND c.relname = 'conversations'
--     AND a.attname = 'line_e164' AND NOT a.attisdropped;
--   -- expect: line_e164 | text | f
-- P2 index + check present:
--   SELECT ic.relname FROM pg_catalog.pg_index i
--   JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
--   WHERE i.indrelid = 'public.conversations'::regclass
--     AND ic.relname = 'idx_conversations_org_line';
--   SELECT c.conname FROM pg_catalog.pg_constraint c
--   WHERE c.conrelid = 'public.conversations'::regclass
--     AND c.conname = 'conversations_line_e164_check';
-- P3 distribution:
--   SELECT cv.org_id, cv.line_e164, count(*) FROM public.conversations cv
--   GROUP BY 1, 2 ORDER BY 1, 2;
--   -- expect: every ...0001 row non-null (5050 or 9821); other orgs NULL.
-- P4 policy still carries WITH CHECK:
--   SELECT p.polname, (p.polwithcheck IS NOT NULL) AS has_with_check
--   FROM pg_catalog.pg_policy p
--   WHERE p.polrelid = 'public.conversations'::regclass;
-- P5 seed label:
--   SELECT n.phone_e164, n.friendly_name FROM public.crm_twilio_numbers n
--   WHERE n.phone_e164 = '+18289009821';   -- expect 'WNW Office'
