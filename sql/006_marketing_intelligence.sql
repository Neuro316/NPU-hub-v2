-- ============================================================
-- NPU Hub: Marketing Intelligence System Tables
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. MEDIA LIBRARY
CREATE TABLE IF NOT EXISTS media_collections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6B7280',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  collection_id UUID REFERENCES media_collections(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  mime_type TEXT,
  width INT,
  height INT,
  file_size INT,
  tags TEXT[] DEFAULT '{}',
  brand TEXT DEFAULT 'both' CHECK (brand IN ('np', 'sensorium', 'both')),
  ai_generated BOOLEAN DEFAULT false,
  usage_count INT DEFAULT 0,
  custom_fields JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. PLATFORM FORMATS
CREATE TABLE IF NOT EXISTS platform_formats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform TEXT NOT NULL,
  format_name TEXT NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  aspect_ratio TEXT,
  category TEXT DEFAULT 'post',
  is_active BOOLEAN DEFAULT true
);

-- 3. BRAND VOICE PROFILES
CREATE TABLE IF NOT EXISTS brand_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  tagline TEXT,
  voice_description TEXT,
  vocabulary_use TEXT[] DEFAULT '{}',
  vocabulary_avoid TEXT[] DEFAULT '{}',
  color_primary TEXT,
  color_secondary TEXT,
  color_accent TEXT,
  logo_url TEXT,
  guidelines JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, brand_key)
);

-- 4. SOCIAL POSTS
CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand TEXT DEFAULT 'np',
  campaign_id UUID,
  content_original TEXT,
  platform_versions JSONB DEFAULT '[]',
  media_asset_ids UUID[] DEFAULT '{}',
  hashtags TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  platform_post_ids JSONB DEFAULT '{}',
  ai_suggestions JSONB DEFAULT '{}',
  trend_keywords TEXT[] DEFAULT '{}',
  brand_alignment_score FLOAT,
  custom_fields JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. QUIZZES
CREATE TABLE IF NOT EXISTS quizzes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand TEXT DEFAULT 'np',
  campaign_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  quiz_type TEXT DEFAULT 'custom' CHECK (quiz_type IN ('nsci_full', 'nsci_quick', 'custom')),
  questions JSONB DEFAULT '[]',
  scoring_config JSONB DEFAULT '{}',
  result_tiers JSONB DEFAULT '[]',
  style_config JSONB DEFAULT '{}',
  completion_count INT DEFAULT 0,
  avg_completion_time INT DEFAULT 0,
  conversion_rate FLOAT DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quiz_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  respondent_email TEXT,
  respondent_name TEXT,
  answers JSONB DEFAULT '{}',
  score FLOAT,
  result_tier TEXT,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  converted BOOLEAN DEFAULT false,
  conversion_action TEXT
);

-- 6. CAMPAIGNS
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand TEXT DEFAULT 'np',
  name TEXT NOT NULL,
  description TEXT,
  icp_id UUID,
  quiz_id UUID REFERENCES quizzes(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  budget FLOAT,
  start_date DATE,
  end_date DATE,
  goals JSONB DEFAULT '{}',
  post_ids UUID[] DEFAULT '{}',
  funnel_config JSONB DEFAULT '{}',
  ai_suggestions JSONB DEFAULT '{}',
  custom_fields JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. ANALYTICS
CREATE TABLE IF NOT EXISTS post_analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform TEXT,
  impressions INT DEFAULT 0,
  reach INT DEFAULT 0,
  clicks INT DEFAULT 0,
  engagement_rate FLOAT DEFAULT 0,
  shares INT DEFAULT 0,
  saves INT DEFAULT 0,
  comments INT DEFAULT 0,
  sentiment_score FLOAT,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_date DATE,
  leads INT DEFAULT 0,
  conversions INT DEFAULT 0,
  cost FLOAT DEFAULT 0,
  revenue FLOAT DEFAULT 0,
  bayesian_score FLOAT,
  funnel_data JSONB DEFAULT '{}',
  top_performing_posts UUID[] DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_media_assets_org ON media_assets(org_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_collection ON media_assets(collection_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_brand ON media_assets(brand);
CREATE INDEX IF NOT EXISTS idx_social_posts_org ON social_posts(org_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_campaign ON social_posts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);
CREATE INDEX IF NOT EXISTS idx_quizzes_org ON quizzes(org_id);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_quiz ON quiz_responses(quiz_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_org ON campaigns(org_id);
CREATE INDEX IF NOT EXISTS idx_post_analytics_post ON post_analytics(post_id);
CREATE INDEX IF NOT EXISTS idx_campaign_analytics_campaign ON campaign_analytics(campaign_id);

-- RLS
ALTER TABLE media_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_access" ON media_collections FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_access" ON media_assets FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_access" ON brand_profiles FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_access" ON social_posts FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_access" ON quizzes FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_access" ON quiz_responses FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_access" ON campaigns FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_access" ON post_analytics FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_access" ON campaign_analytics FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

-- SEED: Platform Formats
INSERT INTO platform_formats (platform, format_name, width, height, aspect_ratio, category) VALUES
  ('instagram', 'Square Post', 1080, 1080, '1:1', 'post'),
  ('instagram', 'Portrait Post', 1080, 1350, '4:5', 'post'),
  ('instagram', 'Story / Reel', 1080, 1920, '9:16', 'story'),
  ('instagram', 'Landscape', 1080, 566, '1.91:1', 'post'),
  ('instagram', 'Carousel', 1080, 1080, '1:1', 'carousel'),
  ('facebook', 'Square Post', 1080, 1080, '1:1', 'post'),
  ('facebook', 'Landscape Post', 1200, 630, '1.91:1', 'post'),
  ('facebook', 'Story', 1080, 1920, '9:16', 'story'),
  ('facebook', 'Cover Photo', 820, 312, '2.63:1', 'cover'),
  ('facebook', 'Event Cover', 1920, 1005, '1.91:1', 'cover'),
  ('linkedin', 'Square Post', 1080, 1080, '1:1', 'post'),
  ('linkedin', 'Portrait Post', 1080, 1350, '4:5', 'post'),
  ('linkedin', 'Landscape Post', 1200, 627, '1.91:1', 'post'),
  ('linkedin', 'Article Cover', 1280, 720, '16:9', 'article'),
  ('linkedin', 'Company Banner', 1128, 191, '5.9:1', 'cover'),
  ('tiktok', 'Video / Reel', 1080, 1920, '9:16', 'video'),
  ('tiktok', 'Thumbnail', 1080, 1920, '9:16', 'thumbnail'),
  ('x', 'Single Image', 1600, 900, '16:9', 'post'),
  ('x', 'Two Images', 700, 800, '7:8', 'post'),
  ('x', 'Square Post', 1080, 1080, '1:1', 'post'),
  ('x', 'Header', 1500, 500, '3:1', 'cover')
ON CONFLICT DO NOTHING;

-- SEED: Brand Profiles for Neuro Progeny
INSERT INTO brand_profiles (org_id, brand_key, display_name, tagline, voice_description,
  vocabulary_use, vocabulary_avoid, color_primary, color_secondary, color_accent, guidelines)
SELECT o.id, 'np', 'Neuro Progeny', 'Train Your Nervous System',
  'Scientific authority meets accessible language. Empowering, capacity-focused, forward-looking. We speak to the nervous system as trainable, not broken.',
  ARRAY['capacity', 'regulation', 'training', 'nervous system', 'resilience', 'window of tolerance', 'HRV', 'biofeedback', 'VR', 'state fluidity', 'co-regulation', 'adaptive'],
  ARRAY['treatment', 'therapy', 'fix', 'broken', 'disorder', 'diagnosis', 'cure', 'patient', 'calm-chasing', 'sympathovagal balance'],
  '#386797', '#1A1A2E', '#3B82F6',
  '{"tone": "authoritative yet accessible", "audience": "high-performers, executives, wellness seekers", "core_message": "all behavior is adaptive - capacity over pathology", "source_of_truth": ["capacity training not treatment", "HRV as mirror not score", "LF/HF NOT sympathovagal balance", "VR as feedback amplifier", "training state fluidity not calm-chasing"]}'::jsonb
FROM organizations o WHERE o.slug = 'neuro-progeny'
ON CONFLICT (org_id, brand_key) DO NOTHING;
