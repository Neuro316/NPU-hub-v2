-- ============================================================
-- NPU Hub: Task Manager Tables
-- Run in Supabase SQL Editor
-- ============================================================

-- Kanban Columns
CREATE TABLE IF NOT EXISTS kanban_columns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  color TEXT DEFAULT '#6B7280',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Kanban Tasks
CREATE TABLE IF NOT EXISTS kanban_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  column_id UUID NOT NULL REFERENCES kanban_columns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assignee TEXT,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date DATE,
  visibility TEXT DEFAULT 'everyone' CHECK (visibility IN ('everyone', 'private', 'specific')),
  sort_order INT DEFAULT 0,
  custom_fields JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Task Comments
CREATE TABLE IF NOT EXISTS task_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Card-Task Links (journey card <-> task bi-directional)
CREATE TABLE IF NOT EXISTS card_task_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES journey_cards(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(card_id, task_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kanban_columns_org ON kanban_columns(org_id);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_org ON kanban_tasks(org_id);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_column ON kanban_tasks(column_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_card_task_links_card ON card_task_links(card_id);
CREATE INDEX IF NOT EXISTS idx_card_task_links_task ON card_task_links(task_id);

-- RLS Policies
ALTER TABLE kanban_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_task_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own org columns" ON kanban_columns
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users access own org tasks" ON kanban_tasks
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users access own org comments" ON task_comments
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users access own org card-task links" ON card_task_links
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- Seed default columns for existing orgs
INSERT INTO kanban_columns (org_id, title, color, sort_order)
SELECT o.id, col.title, col.color, col.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('Backlog', '#9CA3AF', 0),
  ('To Do', '#3B82F6', 1),
  ('In Progress', '#F59E0B', 2),
  ('Review', '#8B5CF6', 3),
  ('Done', '#10B981', 4)
) AS col(title, color, sort_order)
ON CONFLICT DO NOTHING;
