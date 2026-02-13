-- ShipIt Journal Projects Table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS shipit_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ship_date DATE,
  description TEXT,
  status TEXT DEFAULT 'planning' CHECK (status IN ('planning', 'in-progress', 'blocked', 'shipped')),
  sections JSONB DEFAULT '{}',
  chat_history JSONB DEFAULT '[]',
  doc_url TEXT,
  doc_id TEXT,
  folder_url TEXT,
  folder_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE shipit_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage shipit projects in their org"
  ON shipit_projects FOR ALL
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

-- Index
CREATE INDEX idx_shipit_projects_org ON shipit_projects(org_id);
