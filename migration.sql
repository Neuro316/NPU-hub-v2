-- ============================================================
-- Media Appearances / Podcast Preparation Module
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Podcasts table
CREATE TABLE IF NOT EXISTS podcasts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  episode_topic text,
  recording_date timestamptz,
  release_date date,
  status text DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'prep_needed', 'ready', 'completed')),
  format text DEFAULT 'interview' CHECK (format IN ('interview', 'hosting', 'cohost', 'panel', 'solo')),
  platform text DEFAULT 'zoom',
  -- Host info
  host_name text,
  host_email text,
  host_excited_about text,
  host_cares_about text,
  interview_style text,
  show_website text,
  audience_info text,
  show_notes text,
  -- Prep
  key_talking_points text,
  stories_anecdotes text,
  cta_offer text,
  strategic_positioning text,
  -- Technical
  tech_notes text,
  recording_link text,
  -- Post episode
  post_social_notes text,
  -- Tags
  crossover_topics text[] DEFAULT '{}',
  target_icps text[] DEFAULT '{}',
  -- Retrospect
  retro_went_well text,
  retro_improve text,
  retro_rating integer CHECK (retro_rating >= 0 AND retro_rating <= 5),
  retro_topics_captured text[] DEFAULT '{}',
  -- Prep sheet
  prep_sheet_text text,
  prep_sheet_url text,
  -- Metadata
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Podcast questions
CREATE TABLE IF NOT EXISTS podcast_questions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  podcast_id uuid NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  question text NOT NULL,
  draft_answer text,
  source text DEFAULT 'manual',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 3. Future podcast ideas (global capture)
CREATE TABLE IF NOT EXISTS podcast_future_ideas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  source_podcast_id uuid REFERENCES podcasts(id) ON DELETE SET NULL,
  status text DEFAULT 'new' CHECK (status IN ('new', 'developing', 'ready', 'used')),
  created_at timestamptz DEFAULT now()
);

-- 4. Advisory voices (for feedback coach panel)
CREATE TABLE IF NOT EXISTS advisory_voices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text,
  perspective text NOT NULL,
  color text DEFAULT '#3B82F6',
  is_default boolean DEFAULT false,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 5. Podcast checklist items
CREATE TABLE IF NOT EXISTS podcast_checklist (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  podcast_id uuid NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  label text NOT NULL,
  completed boolean DEFAULT false,
  sort_order integer DEFAULT 0
);

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_podcasts_org ON podcasts(org_id);
CREATE INDEX IF NOT EXISTS idx_podcasts_status ON podcasts(org_id, status);
CREATE INDEX IF NOT EXISTS idx_podcast_questions_podcast ON podcast_questions(podcast_id);
CREATE INDEX IF NOT EXISTS idx_podcast_future_ideas_org ON podcast_future_ideas(org_id);
CREATE INDEX IF NOT EXISTS idx_advisory_voices_org ON advisory_voices(org_id);
CREATE INDEX IF NOT EXISTS idx_podcast_checklist_podcast ON podcast_checklist(podcast_id);

-- 7. RLS
ALTER TABLE podcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE podcast_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE podcast_future_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE advisory_voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE podcast_checklist ENABLE ROW LEVEL SECURITY;

-- Podcasts RLS
CREATE POLICY "podcasts_select" ON podcasts FOR SELECT
  USING (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "podcasts_insert" ON podcasts FOR INSERT
  WITH CHECK (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "podcasts_update" ON podcasts FOR UPDATE
  USING (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "podcasts_delete" ON podcasts FOR DELETE
  USING (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));

-- Questions RLS
CREATE POLICY "podcast_questions_select" ON podcast_questions FOR SELECT
  USING (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "podcast_questions_insert" ON podcast_questions FOR INSERT
  WITH CHECK (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "podcast_questions_update" ON podcast_questions FOR UPDATE
  USING (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "podcast_questions_delete" ON podcast_questions FOR DELETE
  USING (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));

-- Future ideas RLS
CREATE POLICY "future_ideas_select" ON podcast_future_ideas FOR SELECT
  USING (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "future_ideas_insert" ON podcast_future_ideas FOR INSERT
  WITH CHECK (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "future_ideas_update" ON podcast_future_ideas FOR UPDATE
  USING (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "future_ideas_delete" ON podcast_future_ideas FOR DELETE
  USING (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));

-- Advisory voices RLS
CREATE POLICY "voices_select" ON advisory_voices FOR SELECT
  USING (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "voices_insert" ON advisory_voices FOR INSERT
  WITH CHECK (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "voices_update" ON advisory_voices FOR UPDATE
  USING (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "voices_delete" ON advisory_voices FOR DELETE
  USING (org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));

-- Checklist RLS
CREATE POLICY "checklist_all" ON podcast_checklist FOR ALL
  USING (podcast_id IN (SELECT id FROM podcasts WHERE org_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid())));

-- 8. Seed default advisory voices (run once)
-- These will be inserted when the first org creates their first podcast
-- The app handles seeding in the hook

SELECT 'Podcast module migration complete.' AS result;
