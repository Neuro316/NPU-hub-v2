-- ============================================================
-- Phase 2: Project Architecture Migration
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Projects table
CREATE TABLE IF NOT EXISTS projects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  color text DEFAULT '#3B82F6',
  icon text DEFAULT 'folder',
  status text DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'completed', 'archived')),
  owner_id uuid REFERENCES auth.users(id),
  owner_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Add project_id to tasks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kanban_tasks' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE kanban_tasks ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Saved views table
CREATE TABLE IF NOT EXISTS saved_views (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  name text NOT NULL,
  filters_json jsonb DEFAULT '{}',
  view_type text DEFAULT 'kanban' CHECK (view_type IN ('kanban', 'list', 'timeline', 'workload')),
  sort_json jsonb DEFAULT '{}',
  shared boolean DEFAULT false,
  pinned boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(org_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON kanban_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_saved_views_org ON saved_views(org_id);
CREATE INDEX IF NOT EXISTS idx_saved_views_user ON saved_views(user_id);

-- 5. RLS Policies for projects
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projects_select" ON projects;
CREATE POLICY "projects_select" ON projects FOR SELECT
  USING (org_id IN (
    SELECT om.organization_id FROM organization_members om WHERE om.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "projects_insert" ON projects;
CREATE POLICY "projects_insert" ON projects FOR INSERT
  WITH CHECK (org_id IN (
    SELECT om.organization_id FROM organization_members om WHERE om.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "projects_update" ON projects;
CREATE POLICY "projects_update" ON projects FOR UPDATE
  USING (org_id IN (
    SELECT om.organization_id FROM organization_members om WHERE om.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "projects_delete" ON projects;
CREATE POLICY "projects_delete" ON projects FOR DELETE
  USING (org_id IN (
    SELECT om.organization_id FROM organization_members om WHERE om.user_id = auth.uid()
  ));

-- 6. RLS Policies for saved_views
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "views_select" ON saved_views;
CREATE POLICY "views_select" ON saved_views FOR SELECT
  USING (
    user_id = auth.uid()
    OR (shared = true AND org_id IN (
      SELECT om.organization_id FROM organization_members om WHERE om.user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "views_insert" ON saved_views;
CREATE POLICY "views_insert" ON saved_views FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "views_update" ON saved_views;
CREATE POLICY "views_update" ON saved_views FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "views_delete" ON saved_views;
CREATE POLICY "views_delete" ON saved_views FOR DELETE
  USING (user_id = auth.uid());

-- 7. Create default "All Tasks" project for existing orgs (optional)
-- Existing tasks remain with project_id = NULL (shown as "No Project")

SELECT 'Phase 2 migration complete. Projects, saved_views, and project_id column ready.' AS result;
