-- Ideas table (run after 006_marketing_intelligence.sql)
CREATE TABLE IF NOT EXISTS ideas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'general',
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'exploring', 'planned', 'done', 'archived')),
  votes INT DEFAULT 0,
  custom_fields JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ideas_org ON ideas(org_id);
ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_access" ON ideas FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
