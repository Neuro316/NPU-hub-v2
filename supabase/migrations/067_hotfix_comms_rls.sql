-- 067_hotfix_comms_rls.sql
-- R0.4 hotfix — comms tables: conversations, call_logs, crm_messages
--
-- WHY (three live defects, verified against htfrfaxlcuyawtlztxxm on 2026-07-20):
--
--   1. conversations_org_policy / call_logs_org_policy carry the 033b
--      correlated-subquery defect:
--          org_id IN (SELECT conversations.org_id FROM org_members
--                     WHERE org_members.user_id = auth.uid())
--      The inner SELECT projects the OUTER table's own org_id, so it yields
--      the row's org once per membership row the caller holds. The test
--      collapses to "caller belongs to ANY org" -> cross-tenant read.
--
--   2. crm_messages_authenticated is FOR ALL USING (true) WITH CHECK (true).
--      Every authenticated user -- including role 'participant' -- can read
--      and write every SMS body in the system.
--
--   3. No WITH CHECK on any of the three, so writes were unconstrained even
--      where the USING clause was intended to scope reads.
--
-- BLAST RADIUS: crm_messages 0 rows, call_logs 0 rows, conversations 2 rows
-- (both with non-null org_id). No existing row becomes invisible under the
-- corrected policies. Exposure to date is latent, not realized.
--
-- PATTERN: copied from the corrected contacts_org_rls, with user_org_ids()
-- substituted for the inline subquery per R0.4 naming. The superadmin branch
-- is mandatory and leads every policy.
--
-- ENUM ORDERING (confirmed, pg_enum.enumsortorder):
--   1 participant  <  2 facilitator  <  3 admin  <  4 superadmin
-- has_role(uid, 'superadmin') tests role >= superadmin, i.e. superadmin ONLY.
-- The staff set is expressed as an explicit text ARRAY rather than an enum
-- >= comparison, so this gate does NOT depend on the enum ordering and will
-- not silently widen if a label is later inserted into the type.
--
-- NOTE: crm_messages has no org_id column; it scopes only through
-- conversation_id -> conversations.org_id. The nested subquery below is
-- fully table-qualified (c.id / c.org_id) and references no outer column,
-- so it does not reproduce defect #1. Migration 068 adds org_id to
-- crm_messages and this policy can then be flattened.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. conversations
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "conversations_org_policy" ON conversations;

CREATE POLICY "conversations_staff_org_rls" ON conversations
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

-- ---------------------------------------------------------------------------
-- 2. call_logs  (recordings + transcripts -- clinical-adjacent)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "call_logs_org_policy" ON call_logs;

CREATE POLICY "call_logs_staff_org_rls" ON call_logs
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

-- ---------------------------------------------------------------------------
-- 3. crm_messages  (SMS bodies -- scoped via conversations)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "crm_messages_authenticated" ON crm_messages;

CREATE POLICY "crm_messages_staff_org_rls" ON crm_messages
  FOR ALL
  USING (
    has_role(auth.uid(), 'superadmin'::user_role)
    OR (
      get_my_role() = ANY (ARRAY['admin', 'facilitator'])
      AND conversation_id IN (
        SELECT c.id FROM conversations c
        WHERE c.org_id IN (SELECT user_org_ids())
      )
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'superadmin'::user_role)
    OR (
      get_my_role() = ANY (ARRAY['admin', 'facilitator'])
      AND conversation_id IN (
        SELECT c.id FROM conversations c
        WHERE c.org_id IN (SELECT user_org_ids())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Revoke anon (matches 062 / 064 / 065 batches)
-- ---------------------------------------------------------------------------
REVOKE ALL ON conversations FROM anon;
REVOKE ALL ON call_logs     FROM anon;
REVOKE ALL ON crm_messages  FROM anon;

-- ---------------------------------------------------------------------------
-- 5. Membership backfill -- cameron.allen@neuroprogeny.com / Neuro Progeny
--
-- DRY RUN RESULT: rows_would_insert = 1
--   select count(*) from team_members tm
--   where tm.is_active and tm.user_id = '7bfcb19f-c7fe-4b4d-a208-212eb45df95f'
--     and not exists (select 1 from org_members om
--                     where om.user_id = tm.user_id
--                       and om.organization_id = tm.org_id);
--
-- This account is active in team_members but has ZERO org_members rows, so its
-- access to comms currently rests entirely on the superadmin short-circuit.
-- Guarded by the existing UNIQUE (user_id, organization_id) constraint.
--
-- ROLE VALUE -- NEEDS YOUR CONFIRMATION: org_members.role uses a DIFFERENT
-- vocabulary from profiles.role and has no CHECK constraint.
--   org_members.role in use: owner(2), admin(3), member(4), participant(3)
--   profiles.role    in use: superadmin(4), admin(3), facilitator(1), participant(17)
-- No policy reads org_members.role today (get_my_role() reads profiles), so
-- this value is not load-bearing for RLS -- but app code may branch on it.
-- 'admin' per your confirmation (matches the profiles.role for this account
-- and the ADMIN_ROLES set app code checks).
-- ---------------------------------------------------------------------------
INSERT INTO org_members (user_id, organization_id, role, status)
SELECT tm.user_id, tm.org_id, 'admin', 'active'
FROM team_members tm
WHERE tm.is_active = true
  AND tm.user_id = '7bfcb19f-c7fe-4b4d-a208-212eb45df95f'
  AND tm.org_id  = '00000000-0000-0000-0000-000000000001'
ON CONFLICT (user_id, organization_id) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- ACCEPTANCE PROBES (run AFTER apply; all three must hold)
-- ---------------------------------------------------------------------------
-- P1 -- no policy on these tables may still contain the correlated pattern:
--   select tablename, policyname, qual from pg_policies
--   where schemaname='public'
--     and tablename in ('conversations','call_logs','crm_messages');
--   EXPECT: 3 rows, each qual starting with has_role(...superadmin...),
--           each with a non-null with_check.
--
-- P2 -- backfill landed exactly one row, zero stragglers remain:
--   select count(*) from team_members tm
--   where tm.is_active and tm.user_id is not null
--     and not exists (select 1 from org_members om where om.user_id=tm.user_id);
--   EXPECT: 0   (was 1)
--
-- P3 -- participant-role users are locked out. Impersonate a participant and:
--   select count(*) from crm_messages;   EXPECT: 0 rows / permission denied
