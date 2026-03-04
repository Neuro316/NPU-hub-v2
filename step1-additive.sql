-- ============================================================
-- STEP 1: Safe Additive Changes (run first)
-- Adds columns, tables, indexes. Zero risk to existing data.
-- ============================================================

-- 1a. Add owner_id to kanban_tasks
ALTER TABLE kanban_tasks
  ADD COLUMN IF NOT EXISTS owner_id UUID;

-- 1b. Backfill owner_id from org_members where display_name matches created_by
UPDATE kanban_tasks kt
SET owner_id = om.user_id
FROM org_members om
WHERE kt.org_id = om.org_id
  AND kt.owner_id IS NULL
  AND (om.display_name = kt.created_by OR om.email = kt.created_by);

CREATE INDEX IF NOT EXISTS idx_kanban_tasks_owner ON kanban_tasks(owner_id);


-- 2. Subtasks table
CREATE TABLE IF NOT EXISTS subtasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  title TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0,
  assignee_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subtasks_task_id ON subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_org_id ON subtasks(org_id);

ALTER TABLE subtasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subtasks_read_org" ON subtasks
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "subtasks_insert_org" ON subtasks
  FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "subtasks_update_org" ON subtasks
  FOR UPDATE USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "subtasks_delete_org" ON subtasks
  FOR DELETE USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );


-- 3. Task Activity table
CREATE TABLE IF NOT EXISTS task_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_activity_task_id ON task_activity(task_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_org_id ON task_activity(org_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_created ON task_activity(created_at DESC);

ALTER TABLE task_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_activity_read_org" ON task_activity
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "task_activity_insert_org" ON task_activity
  FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );


-- ============================================================
-- DONE. Verify with:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'kanban_tasks' AND column_name = 'owner_id';
--
--   SELECT tablename FROM pg_tables
--   WHERE tablename IN ('subtasks', 'task_activity');
--
-- Then run step2-rls-swap.sql
-- ============================================================
