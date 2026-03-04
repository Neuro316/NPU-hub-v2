-- ============================================================
-- STEP 2: RLS Policy Swap for Private Tasks
-- Run AFTER step1-additive.sql succeeds.
--
-- Your existing policies:
--   "Users access own org tasks"
--   "org_access"
--
-- This replaces them with privacy-aware versions.
-- Existing task data is NOT affected — only who can see what.
-- ============================================================


-- Drop existing policies (exact names from your Supabase export)
DROP POLICY IF EXISTS "Users access own org tasks" ON kanban_tasks;
DROP POLICY IF EXISTS "org_access" ON kanban_tasks;


-- New SELECT: org members see all non-private tasks + their own private tasks
CREATE POLICY "tasks_select_with_privacy" ON kanban_tasks
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    AND (
      visibility IS DISTINCT FROM 'private'
      OR owner_id = auth.uid()
    )
  );

-- INSERT: any org member can create tasks
CREATE POLICY "tasks_insert_org" ON kanban_tasks
  FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- UPDATE: org members can update non-private tasks + their own private tasks
CREATE POLICY "tasks_update_with_privacy" ON kanban_tasks
  FOR UPDATE USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    AND (
      visibility IS DISTINCT FROM 'private'
      OR owner_id = auth.uid()
    )
  );

-- DELETE: org members can delete non-private tasks + their own private tasks
CREATE POLICY "tasks_delete_with_privacy" ON kanban_tasks
  FOR DELETE USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    AND (
      visibility IS DISTINCT FROM 'private'
      OR owner_id = auth.uid()
    )
  );


-- ============================================================
-- VERIFY: Should show 4 new policies
--   SELECT policyname, cmd
--   FROM pg_policies
--   WHERE tablename = 'kanban_tasks';
--
-- Expected:
--   tasks_select_with_privacy  | SELECT
--   tasks_insert_org           | INSERT
--   tasks_update_with_privacy  | UPDATE
--   tasks_delete_with_privacy  | DELETE
--
-- ROLLBACK (if something goes wrong):
--   DROP POLICY "tasks_select_with_privacy" ON kanban_tasks;
--   DROP POLICY "tasks_insert_org" ON kanban_tasks;
--   DROP POLICY "tasks_update_with_privacy" ON kanban_tasks;
--   DROP POLICY "tasks_delete_with_privacy" ON kanban_tasks;
--   -- Then recreate your originals:
--   CREATE POLICY "Users access own org tasks" ON kanban_tasks USING (
--     org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
--   );
--   CREATE POLICY "org_access" ON kanban_tasks USING (
--     org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
--   );
-- ============================================================
