-- ============================================================
-- NPU UNIFIED IDENTITY GRAPH
-- Connects: Social Media Campaign → Quiz → CRM Contact → 
--   Mastermind Enrollment → Program Metrics → Outcomes
-- Future: Sensorium EHR integration point
-- ============================================================

-- ============================================================
-- 1. IDENTITY GRAPH - The spine that connects everything
-- ============================================================
CREATE TABLE IF NOT EXISTS identity_graph (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Anonymous identifiers (pre-quiz, from ad click)
  ga4_client_id TEXT,
  meta_fbclid TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  first_touch_url TEXT,
  first_touch_at TIMESTAMPTZ,

  -- Known identifiers (post-quiz or form submission)
  email TEXT,
  full_name TEXT,
  phone TEXT,

  -- CRM link
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,

  -- Mastermind platform link
  user_id UUID, -- references auth.users(id) when enrolled
  cohort_id UUID,
  enrollment_date TIMESTAMPTZ,

  -- Quiz history
  quiz_completions JSONB DEFAULT '[]', -- [{quiz_id, scores, segment, completed_at}]
  psychographic_segment TEXT,
  icp_classification TEXT,

  -- Outcome tracking (populated during/after program)
  intake_nsci JSONB,
  midpoint_nsci JSONB,
  post_nsci JSONB,
  followup_3mo JSONB,
  followup_6mo JSONB,
  outcome_delta JSONB, -- computed: post minus intake per domain

  -- EHR integration point (Sensorium future)
  ehr_patient_id TEXT, -- external EHR system ID
  ehr_system TEXT, -- which EHR system (e.g., 'epic', 'cerner', 'custom')
  ehr_linked_at TIMESTAMPTZ,
  clinical_data_consent BOOLEAN DEFAULT false,

  -- Identity matching metadata
  match_confidence FLOAT DEFAULT 0, -- 0-1
  match_method TEXT, -- 'exact_email', 'fuzzy_name', 'manual_confirm', 'auto'
  matched_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_identity_email ON identity_graph(org_id, email) WHERE email IS NOT NULL;
CREATE INDEX idx_identity_contact ON identity_graph(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX idx_identity_user ON identity_graph(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_identity_org ON identity_graph(org_id);
CREATE INDEX idx_identity_segment ON identity_graph(org_id, psychographic_segment) WHERE psychographic_segment IS NOT NULL;
CREATE INDEX idx_identity_ehr ON identity_graph(ehr_patient_id) WHERE ehr_patient_id IS NOT NULL;

-- ============================================================
-- 2. UNIFIED FUNNEL EVENTS - Every touchpoint in one table
-- ============================================================
CREATE TABLE IF NOT EXISTS unified_funnel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  identity_id UUID REFERENCES identity_graph(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,

  -- Event identification
  event_type TEXT NOT NULL, 
  -- Types: ad_impression, landing_view, quiz_start, quiz_progress,
  -- quiz_complete, email_capture, nurture_open, nurture_click,
  -- discovery_booked, enrollment, lesson_complete, session_complete,
  -- journal_entry, assessment_complete, program_complete,
  -- followup_sent, followup_complete,
  -- social_post_published, campaign_sent, sms_sent, call_completed

  -- Attribution
  campaign_id UUID,
  social_post_id UUID,
  quiz_id TEXT,
  creative_variant TEXT,
  platform TEXT, -- facebook, instagram, google, organic, referral, direct

  -- Funnel position (1-14)
  funnel_stage INTEGER,
  funnel_stage_name TEXT,

  -- Event data (flexible)
  event_data JSONB DEFAULT '{}',

  -- Source module
  source_module TEXT, -- 'crm', 'social', 'campaign', 'mastermind', 'quiz', 'manual'

  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ingested_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_funnel_org ON unified_funnel_events(org_id);
CREATE INDEX idx_funnel_identity ON unified_funnel_events(identity_id) WHERE identity_id IS NOT NULL;
CREATE INDEX idx_funnel_contact ON unified_funnel_events(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX idx_funnel_type ON unified_funnel_events(org_id, event_type);
CREATE INDEX idx_funnel_campaign ON unified_funnel_events(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX idx_funnel_stage ON unified_funnel_events(org_id, funnel_stage);
CREATE INDEX idx_funnel_time ON unified_funnel_events(org_id, occurred_at DESC);

-- ============================================================
-- 3. EXTEND CONTACTS TABLE - Add identity + attribution fields
-- ============================================================
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS identity_id UUID REFERENCES identity_graph(id);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS health_score INTEGER DEFAULT 50;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS health_tier TEXT DEFAULT 'stable';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS acquisition_source TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS acquisition_campaign TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS acquisition_utm JSONB;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS mastermind_user_id UUID;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS mastermind_status TEXT; -- prospect, enrolled, active, completed, graduated, alumni
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ehr_patient_id TEXT; -- Sensorium future

CREATE INDEX idx_contacts_identity ON contacts(identity_id) WHERE identity_id IS NOT NULL;
CREATE INDEX idx_contacts_mastermind ON contacts(mastermind_user_id) WHERE mastermind_user_id IS NOT NULL;
CREATE INDEX idx_contacts_health ON contacts(org_id, health_tier);

-- ============================================================
-- 4. CONTACT TIMELINE - Aggregated view across all modules
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  event_type TEXT NOT NULL,
  -- Types: note_added, call_completed, sms_sent, sms_received,
  -- email_sent, email_opened, email_clicked, campaign_enrolled,
  -- sequence_enrolled, sequence_step, pipeline_changed,
  -- tag_added, tag_removed, task_created, task_completed,
  -- quiz_completed, discovery_booked, mastermind_enrolled,
  -- lesson_completed, journal_entry, vr_session, assessment,
  -- social_interaction, lifecycle_event, health_score_changed

  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  
  -- Links to source records
  source_table TEXT,
  source_id UUID,
  
  -- Who triggered this
  actor_type TEXT DEFAULT 'system', -- system, user, automation, ai
  actor_id UUID,

  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_timeline_contact ON contact_timeline(contact_id, occurred_at DESC);
CREATE INDEX idx_timeline_org ON contact_timeline(org_id, occurred_at DESC);
CREATE INDEX idx_timeline_type ON contact_timeline(contact_id, event_type);

-- ============================================================
-- 5. HEALTH SCORE CALCULATION FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_contact_health_score(p_contact_id UUID)
RETURNS INTEGER AS $$
DECLARE
  score INTEGER := 50;
  last_contact TIMESTAMPTZ;
  days_since_contact INTEGER;
  open_tasks INTEGER;
  sentiment_avg FLOAT;
  has_enrollment BOOLEAN;
BEGIN
  -- Recency of contact (max 25 points)
  SELECT last_contacted_at INTO last_contact FROM contacts WHERE id = p_contact_id;
  IF last_contact IS NOT NULL THEN
    days_since_contact := EXTRACT(EPOCH FROM (now() - last_contact)) / 86400;
    IF days_since_contact <= 3 THEN score := score + 25;
    ELSIF days_since_contact <= 7 THEN score := score + 20;
    ELSIF days_since_contact <= 14 THEN score := score + 15;
    ELSIF days_since_contact <= 30 THEN score := score + 10;
    ELSIF days_since_contact <= 60 THEN score := score + 5;
    ELSE score := score - 10;
    END IF;
  END IF;

  -- Open tasks (penalize if overdue)
  SELECT COUNT(*) INTO open_tasks FROM tasks 
  WHERE contact_id = p_contact_id AND status != 'done' AND due_date < now();
  score := score - (open_tasks * 5);

  -- Call sentiment (max 15 points)
  SELECT AVG(CASE sentiment 
    WHEN 'positive' THEN 15 
    WHEN 'neutral' THEN 5 
    WHEN 'negative' THEN -10 
    WHEN 'concerned' THEN -5 
    ELSE 0 END)
  INTO sentiment_avg
  FROM call_logs WHERE contact_id = p_contact_id AND started_at > now() - INTERVAL '30 days';
  IF sentiment_avg IS NOT NULL THEN score := score + sentiment_avg::INTEGER; END IF;

  -- Mastermind enrollment bonus
  SELECT EXISTS(SELECT 1 FROM contacts WHERE id = p_contact_id AND mastermind_user_id IS NOT NULL)
  INTO has_enrollment;
  IF has_enrollment THEN score := score + 10; END IF;

  -- Clamp 0-100
  RETURN GREATEST(0, LEAST(100, score));
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 6. IDENTITY RESOLUTION FUNCTION
-- Runs when a new enrollment happens or contact is created
-- ============================================================
CREATE OR REPLACE FUNCTION resolve_identity(
  p_org_id UUID,
  p_email TEXT,
  p_name TEXT DEFAULT NULL,
  p_contact_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_identity_id UUID;
  v_existing RECORD;
BEGIN
  -- Pass 1: Exact email match
  SELECT id INTO v_identity_id 
  FROM identity_graph 
  WHERE org_id = p_org_id AND lower(email) = lower(p_email)
  LIMIT 1;

  IF v_identity_id IS NOT NULL THEN
    -- Update existing identity with new links
    UPDATE identity_graph SET
      contact_id = COALESCE(p_contact_id, contact_id),
      user_id = COALESCE(p_user_id, user_id),
      full_name = COALESCE(p_name, full_name),
      match_confidence = GREATEST(match_confidence, 0.95),
      match_method = COALESCE(match_method, 'exact_email'),
      matched_at = COALESCE(matched_at, now()),
      updated_at = now()
    WHERE id = v_identity_id;
    RETURN v_identity_id;
  END IF;

  -- Pass 2: Fuzzy name match (if name provided and no email match)
  IF p_name IS NOT NULL AND length(p_name) > 2 THEN
    SELECT id INTO v_identity_id
    FROM identity_graph
    WHERE org_id = p_org_id 
      AND full_name IS NOT NULL
      AND similarity(lower(full_name), lower(p_name)) > 0.7
      AND created_at > now() - INTERVAL '90 days'
    ORDER BY similarity(lower(full_name), lower(p_name)) DESC
    LIMIT 1;

    IF v_identity_id IS NOT NULL THEN
      UPDATE identity_graph SET
        email = COALESCE(email, p_email),
        contact_id = COALESCE(p_contact_id, contact_id),
        user_id = COALESCE(p_user_id, user_id),
        match_confidence = 0.7,
        match_method = 'fuzzy_name',
        matched_at = now(),
        updated_at = now()
      WHERE id = v_identity_id;
      RETURN v_identity_id;
    END IF;
  END IF;

  -- No match: create new identity
  INSERT INTO identity_graph (org_id, email, full_name, contact_id, user_id, match_confidence, match_method, matched_at)
  VALUES (p_org_id, p_email, p_name, p_contact_id, p_user_id, 1.0, 'auto', now())
  RETURNING id INTO v_identity_id;

  -- Link back to contact if provided
  IF p_contact_id IS NOT NULL THEN
    UPDATE contacts SET identity_id = v_identity_id WHERE id = p_contact_id;
  END IF;

  RETURN v_identity_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 7. AUTO-RESOLVE TRIGGER: When contact is created, resolve identity
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_contact_identity_resolution()
RETURNS TRIGGER AS $$
DECLARE
  v_identity_id UUID;
  v_name TEXT;
BEGIN
  IF NEW.email IS NOT NULL THEN
    v_name := NEW.first_name || ' ' || NEW.last_name;
    v_identity_id := resolve_identity(NEW.org_id, NEW.email, v_name, NEW.id);
    
    IF NEW.identity_id IS NULL AND v_identity_id IS NOT NULL THEN
      NEW.identity_id := v_identity_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contact_identity ON contacts;
CREATE TRIGGER trg_contact_identity
  BEFORE INSERT ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION trigger_contact_identity_resolution();

-- ============================================================
-- 8. AUTO-TIMELINE TRIGGERS
-- ============================================================

-- Timeline entry when a call is logged
CREATE OR REPLACE FUNCTION trigger_call_timeline()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO contact_timeline (org_id, contact_id, event_type, title, description, metadata, source_table, source_id, occurred_at)
  VALUES (
    NEW.org_id, NEW.contact_id,
    'call_completed',
    CASE NEW.direction WHEN 'inbound' THEN 'Inbound call' ELSE 'Outbound call' END,
    CASE WHEN NEW.duration_seconds > 0 THEN 
      (NEW.duration_seconds / 60)::TEXT || ' min call' || COALESCE(' - ' || NEW.sentiment, '')
    ELSE 'Missed/no answer' END,
    jsonb_build_object('direction', NEW.direction, 'duration', NEW.duration_seconds, 'sentiment', NEW.sentiment),
    'call_logs', NEW.id, NEW.started_at
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_call_timeline ON call_logs;
CREATE TRIGGER trg_call_timeline AFTER INSERT ON call_logs
  FOR EACH ROW WHEN (NEW.contact_id IS NOT NULL)
  EXECUTE FUNCTION trigger_call_timeline();

-- Timeline entry when a message is sent/received
CREATE OR REPLACE FUNCTION trigger_message_timeline()
RETURNS TRIGGER AS $$
DECLARE
  v_contact_id UUID;
  v_org_id UUID;
BEGIN
  SELECT c.contact_id, c.org_id INTO v_contact_id, v_org_id
  FROM conversations c WHERE c.id = NEW.conversation_id;
  
  IF v_contact_id IS NOT NULL THEN
    INSERT INTO contact_timeline (org_id, contact_id, event_type, title, description, metadata, source_table, source_id, occurred_at)
    VALUES (
      v_org_id, v_contact_id,
      CASE NEW.direction WHEN 'inbound' THEN 'sms_received' ELSE 'sms_sent' END,
      CASE NEW.direction WHEN 'inbound' THEN 'Received SMS' ELSE 'Sent SMS' END,
      left(NEW.body, 200),
      jsonb_build_object('channel', NEW.channel, 'direction', NEW.direction),
      'messages', NEW.id, NEW.created_at
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_message_timeline ON messages;
CREATE TRIGGER trg_message_timeline AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION trigger_message_timeline();

-- Timeline entry when a task is created for a contact
CREATE OR REPLACE FUNCTION trigger_task_timeline()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    INSERT INTO contact_timeline (org_id, contact_id, event_type, title, description, metadata, source_table, source_id, occurred_at)
    VALUES (
      NEW.org_id, NEW.contact_id,
      CASE WHEN NEW.status = 'done' THEN 'task_completed' ELSE 'task_created' END,
      CASE WHEN NEW.status = 'done' THEN 'Task completed: ' ELSE 'Task created: ' END || NEW.title,
      NEW.description,
      jsonb_build_object('priority', NEW.priority, 'status', NEW.status),
      'tasks', NEW.id, NEW.created_at
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_timeline ON tasks;
CREATE TRIGGER trg_task_timeline AFTER INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION trigger_task_timeline();

-- Timeline entry on pipeline stage change
CREATE OR REPLACE FUNCTION trigger_pipeline_timeline()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.pipeline_stage IS DISTINCT FROM NEW.pipeline_stage THEN
    INSERT INTO contact_timeline (org_id, contact_id, event_type, title, description, metadata, occurred_at)
    VALUES (
      NEW.org_id, NEW.id,
      'pipeline_changed',
      'Pipeline: ' || COALESCE(OLD.pipeline_stage, 'None') || ' → ' || COALESCE(NEW.pipeline_stage, 'None'),
      NULL,
      jsonb_build_object('from', OLD.pipeline_stage, 'to', NEW.pipeline_stage),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pipeline_timeline ON contacts;
CREATE TRIGGER trg_pipeline_timeline AFTER UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION trigger_pipeline_timeline();

-- ============================================================
-- 9. FUNNEL STAGE DEFINITIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS funnel_stage_definitions (
  id SERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stage_number INTEGER NOT NULL,
  stage_name TEXT NOT NULL,
  stage_key TEXT NOT NULL, -- machine-readable key
  description TEXT,
  target_conversion_rate FLOAT,
  UNIQUE(org_id, stage_number)
);

-- Default funnel stages for Neuro Progeny
INSERT INTO funnel_stage_definitions (org_id, stage_number, stage_name, stage_key, description, target_conversion_rate)
SELECT o.id, s.num, s.name, s.key, s.desc, s.rate
FROM organizations o,
(VALUES 
  (1, 'Ad Impression', 'ad_impression', 'Sees social/paid ad', NULL),
  (2, 'Landing Page', 'landing_view', 'Clicks to quiz or landing page', 0.02),
  (3, 'Quiz Start', 'quiz_start', 'Begins assessment', 0.45),
  (4, 'Quiz Complete', 'quiz_complete', 'Finishes all questions', 0.65),
  (5, 'Email Captured', 'email_capture', 'Provides email for results', 0.80),
  (6, 'Nurture Engaged', 'nurture_engaged', 'Opens/clicks nurture emails', 0.35),
  (7, 'Discovery Booked', 'discovery_booked', 'Books a discovery call', 0.05),
  (8, 'Enrollment', 'enrollment', 'Signs up for Mastermind', 0.40),
  (9, 'Program Active', 'program_active', 'Actively participating in cohort', 0.90),
  (10, 'Midpoint Assessment', 'midpoint_assessment', 'Completes Week 3 check-in', 0.85),
  (11, 'Program Complete', 'program_complete', 'Finishes 5-week program', 0.80),
  (12, 'Graduated', 'graduated', 'Completed with positive outcomes', 0.75),
  (13, '3-Month Follow-up', 'followup_3mo', 'Completes 3-month reassessment', 0.50),
  (14, '6-Month Follow-up', 'followup_6mo', 'Completes 6-month reassessment', 0.35)
) AS s(num, name, key, desc, rate)
WHERE o.slug = 'neuro-progeny'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 10. RLS POLICIES
-- ============================================================
ALTER TABLE identity_graph ENABLE ROW LEVEL SECURITY;
ALTER TABLE unified_funnel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_stage_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own org identity data" ON identity_graph
  FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Users see own org funnel events" ON unified_funnel_events
  FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Users see own org timelines" ON contact_timeline
  FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Users see own org funnel definitions" ON funnel_stage_definitions
  FOR ALL USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

-- ============================================================
-- 11. VIEWS FOR DASHBOARDS
-- ============================================================

-- Funnel conversion view: shows conversion rates per stage
CREATE OR REPLACE VIEW funnel_conversion_summary AS
SELECT 
  org_id,
  funnel_stage,
  funnel_stage_name,
  COUNT(*) as total_events,
  COUNT(DISTINCT identity_id) as unique_people,
  occurred_at::DATE as event_date
FROM unified_funnel_events
WHERE occurred_at > now() - INTERVAL '90 days'
GROUP BY org_id, funnel_stage, funnel_stage_name, occurred_at::DATE
ORDER BY org_id, funnel_stage, event_date;

-- Contact lifecycle summary
CREATE OR REPLACE VIEW contact_lifecycle_summary AS
SELECT 
  c.org_id,
  c.mastermind_status,
  c.health_tier,
  c.acquisition_source,
  COUNT(*) as contact_count,
  AVG(c.health_score) as avg_health_score
FROM contacts c
WHERE c.merged_into_id IS NULL
GROUP BY c.org_id, c.mastermind_status, c.health_tier, c.acquisition_source;

-- Attribution effectiveness: which campaigns produce the best outcomes
CREATE OR REPLACE VIEW attribution_effectiveness AS
SELECT 
  ig.org_id,
  ig.utm_campaign,
  ig.utm_source,
  ig.icp_classification,
  COUNT(*) as total_leads,
  COUNT(ig.user_id) as enrolled,
  COUNT(ig.post_nsci) as completed_program,
  AVG((ig.outcome_delta->>'composite')::FLOAT) as avg_outcome_improvement
FROM identity_graph ig
WHERE ig.utm_campaign IS NOT NULL
GROUP BY ig.org_id, ig.utm_campaign, ig.utm_source, ig.icp_classification;
