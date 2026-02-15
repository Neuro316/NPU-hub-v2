-- NPU CRM Communications Module
-- Complete database migration: 26 tables with RLS, triggers, indexes
-- Run via: npx supabase db push

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- fuzzy text search
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. team_members
-- ============================================================
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'manager', 'member')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  auto_assign_weight INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);

CREATE INDEX idx_team_members_org ON team_members(org_id) WHERE is_active = true;

-- ============================================================
-- 2. auto_assignment_rules
-- ============================================================
CREATE TABLE IF NOT EXISTS auto_assignment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('round_robin', 'tag_match', 'pipeline_match', 'source_match')),
  match_field TEXT,
  match_value TEXT,
  assign_to UUID REFERENCES team_members(id),
  round_robin_pool UUID[],
  last_assigned_to UUID REFERENCES team_members(id),
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auto_assign_org ON auto_assignment_rules(org_id) WHERE is_active = true;

-- ============================================================
-- 3. contacts
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  sms_consent BOOLEAN NOT NULL DEFAULT false,
  email_consent BOOLEAN NOT NULL DEFAULT false,
  email_consent_at TIMESTAMPTZ,
  email_unsubscribed_at TIMESTAMPTZ,
  do_not_contact BOOLEAN NOT NULL DEFAULT false,
  tags TEXT[] DEFAULT '{}',
  pipeline_stage TEXT,
  assigned_to UUID REFERENCES team_members(id),
  source TEXT,
  notes TEXT,
  last_contacted_at TIMESTAMPTZ,
  merged_into_id UUID REFERENCES contacts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Full-text search vector
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(first_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(last_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(email, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(notes, '')), 'C')
  ) STORED
);

CREATE INDEX idx_contacts_org ON contacts(org_id);
CREATE INDEX idx_contacts_phone ON contacts(org_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_contacts_email ON contacts(org_id, email) WHERE email IS NOT NULL;
CREATE INDEX idx_contacts_assigned ON contacts(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_contacts_pipeline ON contacts(org_id, pipeline_stage);
CREATE INDEX idx_contacts_tags ON contacts USING GIN(tags);
CREATE INDEX idx_contacts_search ON contacts USING GIN(search_vector);
CREATE INDEX idx_contacts_last_contacted ON contacts(org_id, last_contacted_at);
CREATE INDEX idx_contacts_not_merged ON contacts(org_id) WHERE merged_into_id IS NULL;

-- ============================================================
-- 4. conversations
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'voice', 'email')),
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER NOT NULL DEFAULT 0,
  snoozed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(contact_id, channel)
);

CREATE INDEX idx_conversations_unread ON conversations(contact_id) WHERE unread_count > 0;
CREATE INDEX idx_conversations_snoozed ON conversations(snoozed_until) WHERE snoozed_until IS NOT NULL;

-- ============================================================
-- 5. messages
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'scheduled', 'sent', 'delivered', 'failed', 'received')),
  twilio_sid TEXT,
  sent_by UUID REFERENCES auth.users(id),
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(body, ''))
  ) STORED
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_scheduled ON messages(scheduled_for) WHERE status = 'scheduled' AND scheduled_for IS NOT NULL;
CREATE INDEX idx_messages_search ON messages USING GIN(search_vector);

-- ============================================================
-- 6. call_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'in-progress', 'completed', 'missed', 'voicemail')),
  duration_seconds INTEGER,
  recording_url TEXT,
  transcription TEXT,
  ai_summary TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative', 'concerned')),
  called_by UUID REFERENCES auth.users(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(ai_summary, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(transcription, '')), 'B')
  ) STORED
);

CREATE INDEX idx_call_logs_contact ON call_logs(contact_id, started_at DESC);
CREATE INDEX idx_call_logs_search ON call_logs USING GIN(search_vector);

-- ============================================================
-- 7. org_email_config
-- ============================================================
CREATE TABLE IF NOT EXISTS org_email_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'gmail_workspace' CHECK (provider IN ('gmail_workspace', 'resend', 'smtp')),
  sending_email TEXT NOT NULL,
  sending_name TEXT NOT NULL,
  credentials_json JSONB NOT NULL DEFAULT '{}',
  daily_send_limit INTEGER NOT NULL DEFAULT 500,
  batch_size INTEGER NOT NULL DEFAULT 50,
  batch_delay_seconds INTEGER NOT NULL DEFAULT 60,
  warmup_enabled BOOLEAN NOT NULL DEFAULT true,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  webhook_url TEXT,
  test_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 8. email_campaigns
-- ============================================================
CREATE TABLE IF NOT EXISTS email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'paused', 'completed', 'failed')),
  filter_criteria JSONB,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  total_recipients INTEGER,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_org ON email_campaigns(org_id, status);

-- ============================================================
-- 9. email_sends
-- ============================================================
CREATE TABLE IF NOT EXISTS email_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES email_campaigns(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed')),
  provider_message_id TEXT,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  batch_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_sends_campaign ON email_sends(campaign_id, status);
CREATE INDEX idx_email_sends_provider ON email_sends(provider_message_id) WHERE provider_message_id IS NOT NULL;

-- ============================================================
-- 10. email_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  category TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 11. sms_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS sms_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 12. sequences
-- ============================================================
CREATE TABLE IF NOT EXISTS sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual', 'tag_added', 'pipeline_change', 'form_submit', 'lifecycle_event')),
  trigger_value TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 13. sequence_steps
-- ============================================================
CREATE TABLE IF NOT EXISTS sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  subject TEXT,
  body TEXT NOT NULL,
  template_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sequence_id, step_order)
);

CREATE INDEX idx_sequence_steps_seq ON sequence_steps(sequence_id, step_order);

-- ============================================================
-- 14. sequence_enrollments
-- ============================================================
CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  current_step INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  next_step_at TIMESTAMPTZ,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enrolled_by UUID REFERENCES auth.users(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_enrollments_active ON sequence_enrollments(next_step_at) WHERE status = 'active';
CREATE INDEX idx_enrollments_contact ON sequence_enrollments(contact_id, status);

-- ============================================================
-- 15. tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assigned_to UUID NOT NULL REFERENCES team_members(id),
  created_by UUID REFERENCES auth.users(id),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai_call', 'ai_sms', 'sequence', 'campaign')),
  source_ref_id UUID,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_assigned ON tasks(assigned_to, status) WHERE status IN ('todo', 'in_progress');
CREATE INDEX idx_tasks_org ON tasks(org_id, status);
CREATE INDEX idx_tasks_contact ON tasks(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX idx_tasks_due ON tasks(due_date) WHERE status IN ('todo', 'in_progress') AND due_date IS NOT NULL;

-- ============================================================
-- 16. contact_notes
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id),
  body TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(body, ''))
  ) STORED
);

CREATE INDEX idx_notes_contact ON contact_notes(contact_id, created_at DESC);
CREATE INDEX idx_notes_pinned ON contact_notes(contact_id) WHERE is_pinned = true;
CREATE INDEX idx_notes_search ON contact_notes USING GIN(search_vector);

-- ============================================================
-- 17. contact_lifecycle_events
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('enrolled', 'completed_week', 'graduated', 'referred', 'churned', 'reactivated', 'custom')),
  event_value TEXT,
  metadata JSONB,
  recorded_by UUID REFERENCES auth.users(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lifecycle_contact ON contact_lifecycle_events(contact_id, occurred_at DESC);
CREATE INDEX idx_lifecycle_org ON contact_lifecycle_events(org_id, event_type);

-- ============================================================
-- 18. activity_log
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB,
  ref_table TEXT,
  ref_id UUID,
  actor_id UUID REFERENCES auth.users(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_contact ON activity_log(contact_id, occurred_at DESC);
CREATE INDEX idx_activity_org ON activity_log(org_id, occurred_at DESC);
CREATE INDEX idx_activity_type ON activity_log(org_id, event_type, occurred_at DESC);

-- ============================================================
-- 19. do_not_contact_list
-- ============================================================
CREATE TABLE IF NOT EXISTS do_not_contact_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone TEXT,
  email TEXT,
  reason TEXT,
  added_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX idx_dnc_phone ON do_not_contact_list(org_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_dnc_email ON do_not_contact_list(org_id, email) WHERE email IS NOT NULL;

-- ============================================================
-- 20. webhook_events_out
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_events_out (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_events_pending ON webhook_events_out(status, attempts) WHERE status = 'pending' AND attempts < 3;

-- ============================================================
-- 21. webhook_subscriptions
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL,
  secret TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 22. contact_imports
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  field_mapping JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  total_rows INTEGER,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_log JSONB,
  duplicate_strategy TEXT NOT NULL DEFAULT 'skip' CHECK (duplicate_strategy IN ('skip', 'update', 'create_new')),
  imported_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 23. org_email_daily_stats
-- ============================================================
CREATE TABLE IF NOT EXISTS org_email_daily_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  opened_count INTEGER NOT NULL DEFAULT 0,
  clicked_count INTEGER NOT NULL DEFAULT 0,
  bounced_count INTEGER NOT NULL DEFAULT 0,
  complained_count INTEGER NOT NULL DEFAULT 0,
  unsubscribed_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(org_id, date)
);

CREATE INDEX idx_email_stats_org ON org_email_daily_stats(org_id, date DESC);

-- ============================================================
-- 24. contact_merge_log
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_merge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  surviving_contact_id UUID NOT NULL REFERENCES contacts(id),
  merged_contact_id UUID NOT NULL,
  merged_contact_snapshot JSONB NOT NULL,
  merged_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 25. response_time_log
-- ============================================================
CREATE TABLE IF NOT EXISTS response_time_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'voice', 'email')),
  inbound_at TIMESTAMPTZ NOT NULL,
  first_reply_at TIMESTAMPTZ,
  response_seconds INTEGER,
  responder_id UUID REFERENCES team_members(id),
  inbound_ref_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_response_time_org ON response_time_log(org_id, created_at DESC);
CREATE INDEX idx_response_time_responder ON response_time_log(responder_id, created_at DESC);
CREATE INDEX idx_response_time_pending ON response_time_log(org_id) WHERE first_reply_at IS NULL;

-- ============================================================
-- 26. user_saved_filters
-- ============================================================
CREATE TABLE IF NOT EXISTS user_saved_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filter_config JSONB NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TRIGGERS: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'team_members', 'auto_assignment_rules', 'contacts', 'conversations',
    'org_email_config', 'email_campaigns', 'email_templates', 'sms_templates',
    'sequences', 'tasks', 'webhook_subscriptions'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
      tbl
    );
  END LOOP;
END;
$$;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Helper function to get user's org_ids
CREATE OR REPLACE FUNCTION get_user_org_ids()
RETURNS SETOF UUID AS $$
  SELECT org_id FROM team_members WHERE user_id = auth.uid() AND is_active = true;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Enable RLS on all tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'team_members', 'auto_assignment_rules', 'contacts', 'conversations',
    'messages', 'call_logs', 'org_email_config', 'email_campaigns',
    'email_sends', 'email_templates', 'sms_templates', 'sequences',
    'sequence_steps', 'sequence_enrollments', 'tasks', 'contact_notes',
    'contact_lifecycle_events', 'activity_log', 'do_not_contact_list',
    'webhook_events_out', 'webhook_subscriptions', 'contact_imports',
    'org_email_daily_stats', 'contact_merge_log', 'response_time_log',
    'user_saved_filters'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END;
$$;

-- Org-scoped policies (tables with org_id)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'team_members', 'auto_assignment_rules', 'contacts',
    'org_email_config', 'email_campaigns', 'email_sends', 'email_templates',
    'sms_templates', 'sequences', 'tasks', 'contact_lifecycle_events',
    'activity_log', 'do_not_contact_list', 'webhook_events_out',
    'webhook_subscriptions', 'contact_imports', 'org_email_daily_stats',
    'contact_merge_log', 'response_time_log'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY "%1$s_org_access" ON %1$s FOR ALL USING (org_id IN (SELECT get_user_org_ids()))',
      tbl
    );
  END LOOP;
END;
$$;

-- Contact-scoped policies (tables joined through contacts)
CREATE POLICY "conversations_access" ON conversations FOR ALL
  USING (contact_id IN (SELECT id FROM contacts WHERE org_id IN (SELECT get_user_org_ids())));

CREATE POLICY "messages_access" ON messages FOR ALL
  USING (conversation_id IN (
    SELECT c.id FROM conversations c
    JOIN contacts ct ON c.contact_id = ct.id
    WHERE ct.org_id IN (SELECT get_user_org_ids())
  ));

CREATE POLICY "call_logs_access" ON call_logs FOR ALL
  USING (contact_id IN (SELECT id FROM contacts WHERE org_id IN (SELECT get_user_org_ids())));

CREATE POLICY "contact_notes_access" ON contact_notes FOR ALL
  USING (contact_id IN (SELECT id FROM contacts WHERE org_id IN (SELECT get_user_org_ids())));

CREATE POLICY "sequence_steps_access" ON sequence_steps FOR ALL
  USING (sequence_id IN (SELECT id FROM sequences WHERE org_id IN (SELECT get_user_org_ids())));

CREATE POLICY "sequence_enrollments_access" ON sequence_enrollments FOR ALL
  USING (sequence_id IN (SELECT id FROM sequences WHERE org_id IN (SELECT get_user_org_ids())));

-- User-scoped
CREATE POLICY "saved_filters_access" ON user_saved_filters FOR ALL
  USING (user_id = auth.uid());

-- ============================================================
-- REALTIME: Enable for key tables
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE call_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE activity_log;
