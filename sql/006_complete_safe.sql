-- ============================================================
-- NPU Hub: Complete Marketing Intelligence + Ideas
-- Single clean migration - safe to re-run
-- ============================================================

-- Check what exists and create only what's missing

DO $$ BEGIN
  -- media_collections
  IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'media_collections') THEN
    CREATE TABLE media_collections (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#6B7280',
      sort_order INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE media_collections ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "org_access" ON media_collections FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
    RAISE NOTICE 'Created media_collections';
  ELSE
    RAISE NOTICE 'media_collections already exists';
  END IF;

  -- media_assets
  IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'media_assets') THEN
    CREATE TABLE media_assets (
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
    ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "org_access" ON media_assets FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
    RAISE NOTICE 'Created media_assets';
  ELSE
    RAISE NOTICE 'media_assets already exists';
  END IF;

  -- platform_formats
  IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'platform_formats') THEN
    CREATE TABLE platform_formats (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      platform TEXT NOT NULL,
      format_name TEXT NOT NULL,
      width INT NOT NULL,
      height INT NOT NULL,
      aspect_ratio TEXT,
      category TEXT DEFAULT 'post',
      is_active BOOLEAN DEFAULT true
    );
    RAISE NOTICE 'Created platform_formats';
  ELSE
    RAISE NOTICE 'platform_formats already exists';
  END IF;

  -- brand_profiles
  IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'brand_profiles') THEN
    CREATE TABLE brand_profiles (
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
    ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "org_access" ON brand_profiles FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
    RAISE NOTICE 'Created brand_profiles';
  ELSE
    RAISE NOTICE 'brand_profiles already exists';
  END IF;

  -- social_posts
  IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'social_posts') THEN
    CREATE TABLE social_posts (
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
    ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "org_access" ON social_posts FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
    RAISE NOTICE 'Created social_posts';
  ELSE
    RAISE NOTICE 'social_posts already exists';
  END IF;

  -- quizzes
  IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'quizzes') THEN
    CREATE TABLE quizzes (
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
    ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "org_access" ON quizzes FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
    RAISE NOTICE 'Created quizzes';
  ELSE
    RAISE NOTICE 'quizzes already exists';
  END IF;

  -- quiz_responses
  IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'quiz_responses') THEN
    CREATE TABLE quiz_responses (
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
    ALTER TABLE quiz_responses ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "org_access" ON quiz_responses FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
    RAISE NOTICE 'Created quiz_responses';
  ELSE
    RAISE NOTICE 'quiz_responses already exists';
  END IF;

  -- campaigns
  IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'campaigns') THEN
    CREATE TABLE campaigns (
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
    ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "org_access" ON campaigns FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
    RAISE NOTICE 'Created campaigns';
  ELSE
    RAISE NOTICE 'campaigns already exists';
  END IF;

  -- post_analytics
  IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'post_analytics') THEN
    CREATE TABLE post_analytics (
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
    ALTER TABLE post_analytics ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "org_access" ON post_analytics FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
    RAISE NOTICE 'Created post_analytics';
  ELSE
    RAISE NOTICE 'post_analytics already exists';
  END IF;

  -- campaign_analytics
  IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'campaign_analytics') THEN
    CREATE TABLE campaign_analytics (
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
    ALTER TABLE campaign_analytics ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "org_access" ON campaign_analytics FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
    RAISE NOTICE 'Created campaign_analytics';
  ELSE
    RAISE NOTICE 'campaign_analytics already exists';
  END IF;

  -- ideas
  IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'ideas') THEN
    CREATE TABLE ideas (
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
    ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "org_access" ON ideas FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
    RAISE NOTICE 'Created ideas';
  ELSE
    RAISE NOTICE 'ideas already exists';
  END IF;

END $$;

-- Indexes (safe to re-run)
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
CREATE INDEX IF NOT EXISTS idx_ideas_org ON ideas(org_id);
