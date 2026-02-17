// ═══════════════════════════════════════════════════════════════
// NPU CRM Communications Module — Type Definitions
// Matches the 26-table Supabase schema from 001_complete_schema.sql
// ═══════════════════════════════════════════════════════════════

// ─── Core Entities ───

export interface CrmContact {
  id: string
  org_id: string
  first_name: string
  last_name: string
  phone?: string | null
  email?: string | null
  sms_consent: boolean
  email_consent: boolean
  email_consent_at?: string | null
  email_unsubscribed_at?: string | null
  do_not_contact: boolean
  tags: string[]
  pipeline_stage?: string | null
  assigned_to?: string | null
  source?: string | null
  notes?: string | null
  last_contacted_at?: string | null
  merged_into_id?: string | null
  created_at: string
  updated_at: string
  // Joined fields (not in DB, populated by queries)
  assigned_member?: TeamMember | null
  health_score?: number | null
  health_tier?: HealthTier | null
  // v3 extended fields (custom JSONB or additional columns)
  custom_fields?: Record<string, any>
  // Identity graph + attribution
  identity_id?: string | null
  acquisition_source?: string | null
  acquisition_campaign?: string | null
  acquisition_utm?: Record<string, string> | null
  // Mastermind platform link
  mastermind_user_id?: string | null
  mastermind_status?: 'prospect' | 'enrolled' | 'active' | 'completed' | 'graduated' | 'alumni' | null
  // Sensorium EHR (future)
  ehr_patient_id?: string | null
}

export interface TeamMember {
  id: string
  org_id: string
  user_id: string | null
  display_name: string
  email: string | null
  role: 'super_admin' | 'admin' | 'team_member' | 'facilitator' | 'participant'
  job_title?: string | null
  avatar_url?: string | null
  slack_user_id?: string | null
  slack_display_name?: string | null
  phone?: string | null
  status: 'active' | 'invited' | 'inactive'
  permissions: Record<string, any>
  auto_assign_weight?: number
  created_at: string
  updated_at: string
}

export interface AutoAssignmentRule {
  id: string
  org_id: string
  name: string
  rule_type: 'round_robin' | 'tag_match' | 'pipeline_match' | 'source_match'
  match_field?: string | null
  match_value?: string | null
  assign_to?: string | null
  round_robin_pool?: string[] | null
  last_assigned_to?: string | null
  priority: number
  is_active: boolean
  created_at: string
  updated_at: string
}

// ─── Conversations & Messages ───

export interface Conversation {
  id: string
  contact_id: string
  channel: 'sms' | 'voice' | 'email'
  last_message_at?: string | null
  unread_count: number
  snoozed_until?: string | null
  created_at: string
  updated_at: string
  // Joined
  contact?: CrmContact | null
}

export interface Message {
  id: string
  conversation_id: string
  direction: 'inbound' | 'outbound'
  body: string
  status: 'queued' | 'scheduled' | 'sent' | 'delivered' | 'failed' | 'received'
  twilio_sid?: string | null
  sent_by?: string | null
  scheduled_for?: string | null
  sent_at?: string | null
  created_at: string
}

export interface CallLog {
  id: string
  conversation_id?: string | null
  contact_id: string
  direction: 'inbound' | 'outbound'
  status: 'ringing' | 'in-progress' | 'completed' | 'missed' | 'voicemail'
  duration_seconds?: number | null
  recording_url?: string | null
  transcription?: string | null
  ai_summary?: string | null
  sentiment?: Sentiment | null
  called_by?: string | null
  started_at: string
  ended_at?: string | null
  created_at: string
}

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'concerned'

// ─── Email ───

export interface OrgEmailConfig {
  id: string
  org_id: string
  provider: 'gmail_workspace' | 'resend' | 'smtp'
  sending_email: string
  sending_name: string
  daily_send_limit: number
  batch_size: number
  batch_delay_seconds: number
  warmup_enabled: boolean
  is_verified: boolean
  webhook_url?: string | null
  test_email?: string | null
  created_at: string
  updated_at: string
}

export interface EmailCampaign {
  id: string
  org_id: string
  name: string
  subject: string
  body_html: string
  status: CampaignStatus
  filter_criteria?: Record<string, unknown> | null
  scheduled_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  total_recipients?: number | null
  sent_count: number
  failed_count: number
  created_by?: string | null
  created_at: string
  updated_at: string
}

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'completed' | 'failed'

export interface EmailSend {
  id: string
  campaign_id?: string | null
  contact_id: string
  to_email: string
  status: 'queued' | 'sending' | 'sent' | 'delivered' | 'bounced' | 'failed'
  provider_message_id?: string | null
  opened_at?: string | null
  clicked_at?: string | null
  bounced_at?: string | null
  unsubscribed_at?: string | null
  error_message?: string | null
  sent_at?: string | null
  batch_number?: number | null
  created_at: string
}

export interface EmailTemplate {
  id: string
  org_id: string
  name: string
  subject: string
  body_html: string
  category?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface SmsTemplate {
  id: string
  org_id: string
  name: string
  body: string
  category?: string | null
  created_at: string
  updated_at: string
}

// ─── Sequences ───

export interface Sequence {
  id: string
  org_id: string
  name: string
  description?: string | null
  trigger_type: 'manual' | 'tag_added' | 'pipeline_change' | 'form_submit' | 'lifecycle_event'
  trigger_value?: string | null
  is_active: boolean
  created_by?: string | null
  created_at: string
  updated_at: string
  steps?: SequenceStep[]
}

export interface SequenceStep {
  id: string
  sequence_id: string
  step_order: number
  channel: 'sms' | 'email'
  delay_minutes: number
  subject?: string | null
  body: string
  template_id?: string | null
  created_at: string
}

export interface SequenceEnrollment {
  id: string
  sequence_id: string
  contact_id: string
  current_step: number
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  next_step_at?: string | null
  enrolled_at: string
  enrolled_by?: string | null
  completed_at?: string | null
  created_at: string
}

// ─── Tasks ───

export interface CrmTask {
  id: string
  org_id: string
  contact_id?: string | null
  title: string
  description?: string | null
  status: 'todo' | 'in_progress' | 'done' | 'cancelled'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assigned_to: string
  created_by?: string | null
  source: 'manual' | 'ai_call' | 'ai_sms' | 'sequence' | 'campaign'
  source_ref_id?: string | null
  due_date?: string | null
  completed_at?: string | null
  created_at: string
  updated_at: string
  // Joined
  contact?: CrmContact | null
  assigned_member?: TeamMember | null
  custom_fields?: Record<string, any>
}

// ─── Activity & Lifecycle ───

export interface ContactNote {
  id: string
  org_id?: string
  contact_id: string
  author_id: string
  body: string
  type?: string
  is_pinned: boolean
  created_at: string
}

export interface LifecycleEvent {
  id: string
  contact_id: string
  org_id: string
  event_type: 'enrolled' | 'completed_week' | 'graduated' | 'referred' | 'churned' | 'reactivated' | 'custom'
  event_value?: string | null
  metadata?: Record<string, unknown> | null
  recorded_by?: string | null
  occurred_at: string
  created_at: string
}

export interface ActivityLogEntry {
  id: string
  contact_id: string
  org_id: string
  event_type: string
  event_data?: Record<string, unknown> | null
  ref_table?: string | null
  ref_id?: string | null
  actor_id?: string | null
  occurred_at: string
  created_at: string
}

// ─── Infrastructure ───

export interface DoNotContactEntry {
  id: string
  org_id: string
  phone?: string | null
  email?: string | null
  reason?: string | null
  added_by?: string | null
  created_at: string
}

export interface WebhookSubscription {
  id: string
  org_id: string
  url: string
  events: string[]
  secret: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ContactImport {
  id: string
  org_id: string
  file_name: string
  file_url: string
  field_mapping: Record<string, string>
  status: 'pending' | 'processing' | 'completed' | 'failed'
  total_rows?: number | null
  imported_count: number
  skipped_count: number
  error_count: number
  error_log?: Array<{ row: number; error: string }> | null
  duplicate_strategy: 'skip' | 'update' | 'create_new'
  imported_by?: string | null
  created_at: string
}

export interface OrgEmailDailyStats {
  id: string
  org_id: string
  date: string
  sent_count: number
  delivered_count: number
  opened_count: number
  clicked_count: number
  bounced_count: number
  complained_count: number
  unsubscribed_count: number
}

export interface ContactMergeLog {
  id: string
  org_id: string
  surviving_contact_id: string
  merged_contact_id: string
  merged_contact_snapshot: Record<string, unknown>
  merged_by: string
  created_at: string
}

export interface ResponseTimeEntry {
  id: string
  org_id: string
  contact_id: string
  channel: 'sms' | 'voice' | 'email'
  inbound_at: string
  first_reply_at?: string | null
  response_seconds?: number | null
  responder_id?: string | null
  inbound_ref_id?: string | null
  created_at: string
}

export interface SavedFilter {
  id: string
  user_id: string
  org_id: string
  name: string
  filter_config: Record<string, unknown>
  is_default: boolean
  created_at: string
}

// ─── Health Score ───

export type HealthTier = 'thriving' | 'stable' | 'at_risk' | 'critical'

export interface ContactHealthScore {
  contact_id: string
  score: number
  tier: HealthTier
  factors: {
    recency: number
    their_response: number
    our_response: number
    sentiment: number
    engagement: number
    lifecycle: number
  }
}

// ─── Statistics ───

export interface OverviewKPIs {
  total_contacts: number
  new_contacts: number
  active_conversations: number
  unread_messages: number
  tasks_open: number
  tasks_completed: number
  avg_response_time_seconds: number
  contacts_stale_14d: number
}

export interface TeamMemberStats {
  member_id: string
  display_name: string
  messages_sent: number
  calls_made: number
  avg_response_seconds: number
  fastest_response_seconds: number
  tasks_completed: number
  tasks_overdue: number
  contacts_assigned: number
}

// ─── Pipeline Config ───

export const PIPELINE_STAGES = [
  'New Lead',
  'Contacted',
  'Qualified',
  'Proposal',
  'Negotiation',
  'Won',
  'Lost',
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export const STAGE_COLORS: Record<string, string> = {
  'New Lead': '#228DC4',
  'Contacted': '#2A9D8F',
  'Qualified': '#3DB5A6',
  'Proposal': '#FBBF24',
  'Negotiation': '#E76F51',
  'Won': '#34D399',
  'Lost': '#F87171',
}

// ─── Webhook Payload ───

export interface EmailWebhookPayload {
  action: 'send'
  to: string
  from_name: string
  subject: string
  body_html: string
  reply_to?: string
  metadata: {
    send_id: string
    campaign_id?: string
    org_id: string
  }
}

// ─── API Request Types ───

export interface BulkActionRequest {
  contact_ids: string[]
  action: 'add_tags' | 'remove_tags' | 'set_pipeline_stage' | 'assign_to' | 'enroll_sequence' | 'add_to_dnc' | 'remove_from_dnc'
  params: Record<string, unknown>
}

export interface ContactSearchParams {
  q?: string
  tags?: string[]
  pipeline_stage?: string
  assigned_to?: string
  last_contacted_before?: string
  last_contacted_after?: string
  has_phone?: boolean
  has_email?: boolean
  sms_consent?: boolean
  email_consent?: boolean
  limit?: number
  offset?: number
}
