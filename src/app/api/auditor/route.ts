import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const maxDuration = 55

// ═══════════════════════════════════════════════════════════════════
// COMPLETE SITE MAP - Every page, table, API, link connection
// ═══════════════════════════════════════════════════════════════════

const SITE_MAP: Array<{
  page: string; path: string; module: string;
  tables: string[]; apis: string[]; linksTo: string[];
  components: string[]; hooks: string[];
  description: string; status: 'production' | 'beta' | 'stub';
}> = [
  { page: 'Dashboard', path: '/', module: 'core', tables: ['campaigns','ideas','journey_cards','kanban_tasks','media_assets','org_settings','social_posts','team_profiles'], apis: [], linksTo: ['/analytics','/team'], components: [], hooks: ['use-task-data','use-journey-data'], description: 'Main dashboard with KPI cards, recent activity, quick actions', status: 'production' },
  { page: 'CRM Hub', path: '/crm', module: 'crm', tables: [], apis: [], linksTo: ['/crm/contacts','/crm/campaigns','/crm/pipelines','/crm/tasks','/crm/dialer','/crm/network'], components: [], hooks: [], description: 'CRM landing page with module links', status: 'production' },
  { page: 'CRM Contacts', path: '/crm/contacts', module: 'crm', tables: ['contacts','org_settings'], apis: ['/api/ai'], linksTo: [], components: ['crm/contact-detail','crm/contact-comm-panel','crm/email-composer','crm/twilio-comms'], hooks: ['use-team-data'], description: '23-column configurable contact table with AI autofill, drag-reorder, pipeline column, custom_fields JSONB', status: 'production' },
  { page: 'CRM Conversations', path: '/crm/conversations', module: 'crm', tables: ['conversations','crm_messages','call_logs'], apis: ['/api/sms/send'], linksTo: [], components: [], hooks: [], description: 'Unified inbox for SMS, email, call conversations', status: 'production' },
  { page: 'CRM Dialer', path: '/crm/dialer', module: 'crm', tables: ['contacts'], apis: ['/api/voice/token'], linksTo: [], components: ['crm/twilio-comms'], hooks: [], description: 'Click-to-call dialer with Twilio voice SDK', status: 'production' },
  { page: 'CRM Messages', path: '/crm/messages', module: 'crm', tables: [], apis: ['/api/sms/send'], linksTo: [], components: [], hooks: [], description: 'SMS messaging interface', status: 'beta' },
  { page: 'CRM Pipelines', path: '/crm/pipelines', module: 'crm', tables: ['org_settings'], apis: [], linksTo: [], components: ['crm/pipeline-resources'], hooks: [], description: 'Visual pipeline manager with drag-drop stages', status: 'production' },
  { page: 'CRM Tasks', path: '/crm/tasks', module: 'crm', tables: [], apis: ['/api/send-resources'], linksTo: [], components: ['crm/crm-task-card'], hooks: [], description: 'CRM-specific task management', status: 'production' },
  { page: 'CRM Network', path: '/crm/network', module: 'crm', tables: [], apis: ['/api/crm/network/insights'], linksTo: [], components: [], hooks: [], description: 'Relationship network visualization and gap analysis', status: 'production' },
  { page: 'CRM Sequences', path: '/crm/sequences', module: 'crm', tables: [], apis: [], linksTo: [], components: [], hooks: [], description: 'Automated email/SMS sequences', status: 'stub' },
  { page: 'CRM Import', path: '/crm/import', module: 'crm', tables: ['contacts','contact_import_batches','contact_relationships','org_settings'], apis: [], linksTo: ['/crm/contacts','/crm/import/history','/crm/network'], components: [], hooks: [], description: 'CSV import with field mapping and duplicate detection', status: 'production' },
  { page: 'CRM Import History', path: '/crm/import/history', module: 'crm', tables: ['contact_import_batches','contacts'], apis: [], linksTo: ['/crm/import'], components: [], hooks: [], description: 'Import batch history with rollback capability', status: 'production' },
  { page: 'CRM Settings', path: '/crm/settings', module: 'crm', tables: ['org_settings','org_email_configs','contact_tag_definitions','relationship_types'], apis: ['/api/twilio/test'], linksTo: ['/team','/api/backup'], components: [], hooks: [], description: 'Twilio, email, tags, pipelines, relationship types config', status: 'production' },
  { page: 'CRM Analytics', path: '/crm/analytics', module: 'crm', tables: [], apis: [], linksTo: [], components: [], hooks: [], description: 'CRM analytics and reporting', status: 'stub' },
  { page: 'CRM Campaigns', path: '/crm/campaigns', module: 'crm', tables: [], apis: [], linksTo: [], components: [], hooks: [], description: 'CRM campaign management', status: 'stub' },
  { page: 'Campaigns', path: '/campaigns', module: 'marketing', tables: ['campaigns','campaign_automations','email_campaigns','team_profiles'], apis: [], linksTo: [], components: ['campaigns/campaign-flow-builder'], hooks: [], description: 'Campaign builder with flow automation and email integration', status: 'production' },
  { page: 'Social Media', path: '/social', module: 'marketing', tables: ['social_posts','brand_profiles'], apis: ['/api/ai','/api/transcript'], linksTo: ['/calendar','/media','/settings'], components: [], hooks: ['use-media-data'], description: 'AI CMO with canvas designer, PNG/JPG export, post categories, brand guide', status: 'production' },
  { page: 'ICP Profiles', path: '/icps', module: 'marketing', tables: [], apis: [], linksTo: [], components: [], hooks: [], description: 'Ideal Customer Profile builder', status: 'stub' },
  { page: 'Analytics', path: '/analytics', module: 'marketing', tables: [], apis: [], linksTo: ['/crm/analytics'], components: [], hooks: [], description: 'Analytics hub', status: 'stub' },
  { page: 'Media Library', path: '/media', module: 'content', tables: [], apis: [], linksTo: [], components: [], hooks: ['use-media-data'], description: 'Image/video asset management with collections and tags', status: 'production' },
  { page: 'Calendar', path: '/calendar', module: 'content', tables: ['ehr_session_notes','social_posts','email_campaigns','team_profiles'], apis: ['/api/ai'], linksTo: [], components: [], hooks: [], description: 'Unified calendar with sessions, social posts, campaigns', status: 'production' },
  { page: 'ShipIt Journal', path: '/shipit', module: 'content', tables: ['shipit_projects'], apis: ['/api/ai','/api/google'], linksTo: [], components: [], hooks: [], description: 'Project journal with AI assistance', status: 'production' },
  { page: 'Ideas', path: '/ideas', module: 'content', tables: ['ideas'], apis: [], linksTo: [], components: [], hooks: [], description: 'Idea capture and prioritization board', status: 'production' },
  { page: 'Company Library', path: '/library', module: 'content', tables: ['company_library'], apis: [], linksTo: [], components: [], hooks: [], description: 'Shared company documents', status: 'production' },
  { page: 'Task Manager', path: '/tasks', module: 'operations', tables: [], apis: [], linksTo: [], components: ['tasks/kanban-column','tasks/task-card','tasks/task-detail'], hooks: ['use-task-data'], description: 'Kanban board with drag-drop, card-task links', status: 'production' },
  { page: 'Journey Builder', path: '/journeys', module: 'operations', tables: [], apis: ['/api/ai'], linksTo: [], components: ['journey/card-detail-panel','journey/flow-card','journey/journey-card-item','journey/path-row','journey/phase-column'], hooks: ['use-journey-data'], description: 'Customer journey map with phases, paths, cards, task linking', status: 'production' },
  { page: 'SOPs', path: '/sops', module: 'operations', tables: [], apis: [], linksTo: [], components: [], hooks: [], description: 'Standard Operating Procedures', status: 'stub' },
  { page: 'Tickets', path: '/tickets', module: 'operations', tables: [], apis: [], linksTo: [], components: [], hooks: [], description: 'Support ticket management', status: 'stub' },
  { page: 'Media Appearances', path: '/media-appearances', module: 'operations', tables: [], apis: [], linksTo: [], components: [], hooks: [], description: 'Podcast, press, speaking tracker', status: 'stub' },
  { page: 'AI Advisory', path: '/advisory', module: 'ai', tables: ['ai_conversations','brand_profiles','company_library'], apis: ['/api/ai','/api/google'], linksTo: [], components: [], hooks: [], description: 'AI advisory board with multiple advisor personas', status: 'production' },
  { page: 'Team', path: '/team', module: 'admin', tables: [], apis: [], linksTo: [], components: ['team/member-detail'], hooks: ['use-team-data','use-permissions'], description: 'Team member management', status: 'production' },
  { page: 'Integrations', path: '/integrations', module: 'admin', tables: [], apis: ['/api/send-resources'], linksTo: [], components: [], hooks: [], description: 'Third-party integrations', status: 'beta' },
  { page: 'Settings', path: '/settings', module: 'admin', tables: ['brand_profiles'], apis: ['/api/ai'], linksTo: [], components: [], hooks: [], description: 'Brand guide, AI prompts, email templates', status: 'production' },
  { page: 'NeuroReport', path: '/ehr/neuroreport', module: 'ehr', tables: [], apis: [], linksTo: ['https://neuroreport.app'], components: [], hooks: [], description: 'NeuroReport clinical assessment', status: 'production' },
  { page: 'Session Notes', path: '/ehr/sessions', module: 'ehr', tables: ['contacts','ehr_session_notes','ehr_protocols','ehr_protocol_history','ehr_reports','ehr_form_submissions'], apis: ['/api/ai'], linksTo: [], components: [], hooks: [], description: 'Clinical session notes with 9 modality protocols', status: 'production' },
  { page: 'EHR Forms', path: '/ehr/forms', module: 'ehr', tables: ['ehr_form_templates','ehr_form_submissions','contacts','company_library'], apis: ['/api/ai'], linksTo: [], components: [], hooks: [], description: 'AI form builder with WYSIWYG editor', status: 'production' },
  { page: 'Accounting', path: '/ehr/accounting', module: 'ehr', tables: ['acct_clients','acct_clinics','acct_payments','acct_services','acct_checks','acct_locations','acct_marketing_charges','org_settings'], apis: [], linksTo: [], components: [], hooks: [], description: 'Multi-org accounting with waterfall splits', status: 'production' },
]

const API_ROUTES: Array<{
  path: string; method: string; name: string; module: string;
  tables: string[]; externalService?: string; critical: boolean; description: string;
}> = [
  { path: '/api/ai', method: 'POST', name: 'AI Engine', module: 'core', tables: [], externalService: 'Anthropic Claude', critical: true, description: 'Central AI endpoint' },
  { path: '/api/contacts/search', method: 'POST', name: 'Contact Search', module: 'crm', tables: ['contacts'], critical: true, description: 'Full-text contact search' },
  { path: '/api/contacts/bulk-action', method: 'POST', name: 'Bulk Actions', module: 'crm', tables: ['contacts'], critical: false, description: 'Mass update/delete' },
  { path: '/api/contacts/consent', method: 'POST', name: 'Consent', module: 'crm', tables: ['contacts','do_not_contact_list'], critical: false, description: 'Opt-in/out tracking' },
  { path: '/api/contacts/merge', method: 'POST', name: 'Contact Merge', module: 'crm', tables: ['contacts','contact_merge_log'], critical: false, description: 'Duplicate merge' },
  { path: '/api/crm/tags', method: 'GET', name: 'CRM Tags', module: 'crm', tables: ['tags'], critical: false, description: 'Tag management' },
  { path: '/api/crm/relationships', method: 'POST', name: 'Relationships', module: 'crm', tables: ['contact_relationships'], critical: false, description: 'Contact relationships' },
  { path: '/api/crm/network/insights', method: 'GET', name: 'Network Insights', module: 'crm', tables: ['network_events'], critical: false, description: 'AI network analysis' },
  { path: '/api/crm/network/scores', method: 'GET', name: 'Network Scores', module: 'crm', tables: ['contact_interaction_score'], critical: false, description: 'Health scoring' },
  { path: '/api/email/send', method: 'POST', name: 'Email Send', module: 'email', tables: ['email_sends'], externalService: 'SMTP', critical: true, description: 'Send emails' },
  { path: '/api/email/ai-draft', method: 'POST', name: 'AI Email Draft', module: 'email', tables: [], externalService: 'Anthropic Claude', critical: false, description: 'AI email drafts' },
  { path: '/api/email/campaign/launch', method: 'POST', name: 'Campaign Launch', module: 'email', tables: ['email_campaigns'], critical: false, description: 'Launch campaigns' },
  { path: '/api/email/campaign/process-queue', method: 'POST', name: 'Campaign Queue', module: 'email', tables: ['email_campaigns','email_sends'], critical: false, description: 'Process queue' },
  { path: '/api/email/webhook-inbound', method: 'POST', name: 'Inbound Email', module: 'email', tables: ['conversations','crm_messages'], critical: false, description: 'Email webhooks' },
  { path: '/api/sms/send', method: 'POST', name: 'SMS Send', module: 'sms', tables: ['crm_messages'], externalService: 'Twilio', critical: false, description: 'Send SMS' },
  { path: '/api/sms/schedule', method: 'POST', name: 'SMS Schedule', module: 'sms', tables: ['crm_messages'], externalService: 'Twilio', critical: false, description: 'Schedule SMS' },
  { path: '/api/sms/process-scheduled', method: 'POST', name: 'SMS Scheduler', module: 'sms', tables: ['crm_messages'], externalService: 'Twilio', critical: false, description: 'Cron: process SMS' },
  { path: '/api/voice/token', method: 'GET', name: 'Voice Token', module: 'voice', tables: [], externalService: 'Twilio', critical: false, description: 'Twilio voice SDK token' },
  { path: '/api/voice/end', method: 'POST', name: 'End Call', module: 'voice', tables: ['call_logs'], externalService: 'Twilio', critical: false, description: 'End voice call' },
  { path: '/api/twilio/call-status', method: 'POST', name: 'Call Status', module: 'twilio', tables: ['call_logs'], externalService: 'Twilio', critical: false, description: 'Call status webhook' },
  { path: '/api/twilio/inbound-call', method: 'POST', name: 'Inbound Call', module: 'twilio', tables: ['call_logs'], externalService: 'Twilio', critical: false, description: 'Handle inbound calls' },
  { path: '/api/twilio/inbound-sms', method: 'POST', name: 'Inbound SMS', module: 'twilio', tables: ['crm_messages','conversations'], externalService: 'Twilio', critical: false, description: 'Handle inbound SMS' },
  { path: '/api/twilio/recording-ready', method: 'POST', name: 'Recording Ready', module: 'twilio', tables: ['call_logs'], externalService: 'Twilio', critical: false, description: 'Process recordings' },
  { path: '/api/twilio/test', method: 'GET', name: 'Twilio Test', module: 'twilio', tables: [], externalService: 'Twilio', critical: false, description: 'Connectivity test' },
  { path: '/api/transcript', method: 'POST', name: 'Transcript', module: 'content', tables: [], externalService: 'YouTube/Deepgram', critical: false, description: 'Extract transcripts' },
  { path: '/api/google', method: 'POST', name: 'Google Apps Script', module: 'integrations', tables: ['org_settings'], externalService: 'Google Apps Script', critical: false, description: 'Apps Script proxy' },
  { path: '/api/tasks', method: 'GET', name: 'Tasks API', module: 'operations', tables: ['tasks'], critical: false, description: 'Task CRUD' },
  { path: '/api/tasks/sync-to-hub', method: 'POST', name: 'Task Sync', module: 'operations', tables: ['tasks','kanban_tasks'], critical: false, description: 'CRM→Kanban sync' },
  { path: '/api/sequences/enroll', method: 'POST', name: 'Seq Enroll', module: 'automation', tables: ['sequence_enrollments'], critical: false, description: 'Sequence enrollment' },
  { path: '/api/sequences/process-step', method: 'POST', name: 'Seq Step', module: 'automation', tables: ['sequence_enrollments','sequence_steps'], critical: false, description: 'Process sequence steps' },
  { path: '/api/send-resources', method: 'POST', name: 'Send Resources', module: 'operations', tables: ['pipeline_resources'], externalService: 'SMTP', critical: false, description: 'Email resources' },
  { path: '/api/identity/resolve', method: 'POST', name: 'Identity', module: 'analytics', tables: ['identity_graph'], critical: false, description: 'Cross-device identity' },
  { path: '/api/funnel/track', method: 'POST', name: 'Funnel Track', module: 'analytics', tables: ['unified_funnel_events'], critical: false, description: 'Funnel tracking' },
  { path: '/api/stats/daily-rollup', method: 'GET', name: 'Daily Rollup', module: 'analytics', tables: ['org_email_daily_stats'], critical: false, description: 'Daily stats aggregation' },
  { path: '/api/backup', method: 'GET', name: 'DB Backup', module: 'admin', tables: [], critical: false, description: 'Database backup' },
  { path: '/api/webhooks/dispatch', method: 'POST', name: 'Webhooks', module: 'integrations', tables: ['webhook_subscriptions','webhook_events_out'], critical: false, description: 'Webhook dispatch' },
  { path: '/api/inbox/snooze', method: 'POST', name: 'Inbox Snooze', module: 'crm', tables: ['conversations'], critical: false, description: 'Snooze threads' },
  { path: '/api/inbox/process-unsnooze', method: 'POST', name: 'Unsnooze', module: 'crm', tables: ['conversations'], critical: false, description: 'Cron: unsnooze' },
  { path: '/api/maintenance/cleanup-recordings', method: 'POST', name: 'Cleanup', module: 'admin', tables: ['call_logs'], critical: false, description: 'Cleanup recordings' },
]

const REQUIRED_ENV = [
  { key: 'NEXT_PUBLIC_SUPABASE_URL', module: 'core', critical: true },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', module: 'core', critical: true },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', module: 'core', critical: true },
  { key: 'ANTHROPIC_API_KEY', module: 'ai', critical: true },
  { key: 'TWILIO_ACCOUNT_SID', module: 'twilio', critical: false },
  { key: 'TWILIO_AUTH_TOKEN', module: 'twilio', critical: false },
  { key: 'TWILIO_API_KEY', module: 'twilio', critical: false },
  { key: 'TWILIO_API_SECRET', module: 'twilio', critical: false },
  { key: 'TWILIO_PHONE_NUMBER', module: 'twilio', critical: false },
  { key: 'TWILIO_TWIML_APP_SID', module: 'twilio', critical: false },
  { key: 'TWILIO_MESSAGING_SERVICE_SID', module: 'twilio', critical: false },
  { key: 'DEEPGRAM_API_KEY', module: 'content', critical: false },
  { key: 'APPS_SCRIPT_URL', module: 'integrations', critical: false },
  { key: 'CRON_SECRET', module: 'admin', critical: false },
  { key: 'NEXT_PUBLIC_APP_URL', module: 'core', critical: false },
]

const ALL_TABLES: Array<{ name: string; module: string; usedBy: string[] }> = [
  { name: 'organizations', module: 'core', usedBy: ['workspace-context'] },
  { name: 'org_members', module: 'core', usedBy: ['workspace-context'] },
  { name: 'org_settings', module: 'core', usedBy: ['dashboard','crm/contacts','crm/pipelines','crm/settings','crm/import','ehr/accounting'] },
  { name: 'contacts', module: 'crm', usedBy: ['crm/contacts','crm/dialer','crm/import','ehr/sessions','ehr/forms'] },
  { name: 'contact_notes', module: 'crm', usedBy: ['crm-client'] },
  { name: 'contact_tags', module: 'crm', usedBy: ['crm-client'] },
  { name: 'contact_tag_definitions', module: 'crm', usedBy: ['crm/settings','crm-client'] },
  { name: 'contact_tag_categories', module: 'crm', usedBy: ['crm-client'] },
  { name: 'contact_timeline', module: 'crm', usedBy: ['contact-detail','identity-client'] },
  { name: 'contact_relationships', module: 'crm', usedBy: ['crm/import','crm-client'] },
  { name: 'contact_import_batches', module: 'crm', usedBy: ['crm/import','crm/import/history'] },
  { name: 'contact_merge_log', module: 'crm', usedBy: ['contacts/merge'] },
  { name: 'contact_engagement_topics', module: 'crm', usedBy: ['contact-detail'] },
  { name: 'contact_interaction_score', module: 'crm', usedBy: ['crm-client'] },
  { name: 'contact_lifecycle_events', module: 'crm', usedBy: ['crm-client','crm-server'] },
  { name: 'contact_lifecycle_summary', module: 'crm', usedBy: ['identity-client'] },
  { name: 'crm_tasks', module: 'crm', usedBy: ['crm/tasks'] },
  { name: 'crm_messages', module: 'crm', usedBy: ['crm/conversations','crm-client'] },
  { name: 'crm_activity_log', module: 'crm', usedBy: [] },
  { name: 'conversations', module: 'crm', usedBy: ['crm/conversations','crm-client','crm-server'] },
  { name: 'campaigns', module: 'marketing', usedBy: ['campaigns','dashboard'] },
  { name: 'campaign_automations', module: 'marketing', usedBy: ['campaigns'] },
  { name: 'email_campaigns', module: 'email', usedBy: ['campaigns','calendar','crm-client'] },
  { name: 'email_sends', module: 'email', usedBy: ['crm-server'] },
  { name: 'sequences', module: 'automation', usedBy: ['crm-client'] },
  { name: 'sequence_steps', module: 'automation', usedBy: ['crm-client'] },
  { name: 'sequence_enrollments', module: 'automation', usedBy: ['crm-client'] },
  { name: 'journey_cards', module: 'operations', usedBy: ['dashboard','use-journey-data'] },
  { name: 'journey_phases', module: 'operations', usedBy: ['use-journey-data'] },
  { name: 'card_task_links', module: 'operations', usedBy: ['use-task-data'] },
  { name: 'kanban_tasks', module: 'operations', usedBy: ['dashboard','use-task-data'] },
  { name: 'kanban_columns', module: 'operations', usedBy: ['crm-client','use-task-data'] },
  { name: 'tasks', module: 'operations', usedBy: ['crm-task-card','crm-client'] },
  { name: 'task_comments', module: 'operations', usedBy: ['use-task-data'] },
  { name: 'social_posts', module: 'marketing', usedBy: ['social','dashboard','calendar'] },
  { name: 'brand_profiles', module: 'marketing', usedBy: ['social','settings','advisory'] },
  { name: 'media_assets', module: 'content', usedBy: ['dashboard','crm-task-card','use-media-data'] },
  { name: 'media_collections', module: 'content', usedBy: ['use-media-data'] },
  { name: 'company_library', module: 'content', usedBy: ['library','advisory'] },
  { name: 'ideas', module: 'content', usedBy: ['ideas','dashboard'] },
  { name: 'shipit_projects', module: 'content', usedBy: ['shipit'] },
  { name: 'ehr_session_notes', module: 'ehr', usedBy: ['ehr/sessions','calendar'] },
  { name: 'ehr_protocols', module: 'ehr', usedBy: ['ehr/sessions'] },
  { name: 'ehr_protocol_history', module: 'ehr', usedBy: ['ehr/sessions'] },
  { name: 'ehr_reports', module: 'ehr', usedBy: ['ehr/sessions'] },
  { name: 'ehr_form_templates', module: 'ehr', usedBy: ['ehr/forms'] },
  { name: 'ehr_form_submissions', module: 'ehr', usedBy: ['ehr/forms','ehr/sessions'] },
  { name: 'acct_clients', module: 'accounting', usedBy: ['ehr/accounting'] },
  { name: 'acct_clinics', module: 'accounting', usedBy: ['ehr/accounting'] },
  { name: 'acct_payments', module: 'accounting', usedBy: ['ehr/accounting'] },
  { name: 'acct_services', module: 'accounting', usedBy: ['ehr/accounting'] },
  { name: 'acct_checks', module: 'accounting', usedBy: ['ehr/accounting'] },
  { name: 'acct_locations', module: 'accounting', usedBy: ['ehr/accounting'] },
  { name: 'acct_marketing_charges', module: 'accounting', usedBy: ['ehr/accounting'] },
  { name: 'call_logs', module: 'voice', usedBy: ['crm/conversations','crm-client','crm-server'] },
  { name: 'do_not_contact_list', module: 'compliance', usedBy: ['crm-server'] },
  { name: 'activity_log', module: 'core', usedBy: ['crm-client','crm-server'] },
  { name: 'team_members', module: 'admin', usedBy: [] },
  { name: 'team_profiles', module: 'admin', usedBy: ['dashboard','campaigns','calendar','contact-detail'] },
  { name: 'user_saved_filters', module: 'crm', usedBy: ['crm-client'] },
  { name: 'identity_graph', module: 'analytics', usedBy: ['identity-client'] },
  { name: 'unified_funnel_events', module: 'analytics', usedBy: ['identity-client'] },
  { name: 'attribution_effectiveness', module: 'analytics', usedBy: ['identity-client'] },
  { name: 'network_events', module: 'crm', usedBy: ['crm-client'] },
  { name: 'network_gap_analysis', module: 'crm', usedBy: [] },
  { name: 'relationship_types', module: 'crm', usedBy: ['crm/settings','crm-client'] },
  { name: 'org_email_config', module: 'email', usedBy: ['email-composer'] },
  { name: 'org_email_configs', module: 'email', usedBy: ['crm/settings'] },
  { name: 'org_email_daily_stats', module: 'email', usedBy: ['crm-client'] },
  { name: 'response_time_log', module: 'crm', usedBy: ['crm-server'] },
  { name: 'auto_assignment_rules', module: 'crm', usedBy: ['crm-server'] },
  { name: 'tags', module: 'crm', usedBy: [] },
  { name: 'webhook_subscriptions', module: 'integrations', usedBy: [] },
  { name: 'webhook_events_out', module: 'integrations', usedBy: ['crm-server'] },
  { name: 'pipeline_resources', module: 'crm', usedBy: ['pipeline-resources','contact-detail','email-composer'] },
  { name: 'ai_conversations', module: 'ai', usedBy: ['advisory'] },
  { name: 'platform_formats', module: 'marketing', usedBy: ['use-social-data'] },
]

const FIELD_CONNECTIONS: Array<{
  from: string; fromField: string; to: string; toField: string;
  type: 'foreign_key' | 'reciprocal' | 'lookup' | 'jsonb_ref';
  description: string;
}> = [
  { from: 'contacts', fromField: 'org_id', to: 'organizations', toField: 'id', type: 'foreign_key', description: 'Contact belongs to organization' },
  { from: 'contacts', fromField: 'pipeline_id', to: 'org_settings(pipelines)', toField: 'id', type: 'jsonb_ref', description: 'Contact pipeline stage assignment' },
  { from: 'contacts', fromField: 'custom_fields', to: 'org_settings(columns)', toField: 'column_config', type: 'jsonb_ref', description: 'Extended contact fields stored in JSONB' },
  { from: 'contacts', fromField: 'assigned_to', to: 'team_profiles', toField: 'id', type: 'lookup', description: 'Contact assigned to team member' },
  { from: 'contact_tags', fromField: 'tag_id', to: 'contact_tag_definitions', toField: 'id', type: 'foreign_key', description: 'Tag assignment references definition' },
  { from: 'contact_tags', fromField: 'contact_id', to: 'contacts', toField: 'id', type: 'foreign_key', description: 'Tag belongs to contact' },
  { from: 'contact_relationships', fromField: 'contact_id', to: 'contacts', toField: 'id', type: 'foreign_key', description: 'Relationship source contact' },
  { from: 'contact_relationships', fromField: 'related_contact_id', to: 'contacts', toField: 'id', type: 'reciprocal', description: 'Relationship target (bidirectional)' },
  { from: 'contact_relationships', fromField: 'relationship_type', to: 'relationship_types', toField: 'id', type: 'lookup', description: 'Relationship type definition' },
  { from: 'journey_cards', fromField: 'phase_id', to: 'journey_phases', toField: 'id', type: 'foreign_key', description: 'Card belongs to journey phase' },
  { from: 'card_task_links', fromField: 'card_id', to: 'journey_cards', toField: 'id', type: 'reciprocal', description: 'Links journey card → kanban task' },
  { from: 'card_task_links', fromField: 'task_id', to: 'kanban_tasks', toField: 'id', type: 'reciprocal', description: 'Links kanban task → journey card' },
  { from: 'kanban_tasks', fromField: 'column_id', to: 'kanban_columns', toField: 'id', type: 'foreign_key', description: 'Task in kanban column' },
  { from: 'kanban_tasks', fromField: 'assigned_to', to: 'team_profiles', toField: 'id', type: 'lookup', description: 'Task assigned to team member' },
  { from: 'crm_tasks', fromField: 'contact_id', to: 'contacts', toField: 'id', type: 'foreign_key', description: 'CRM task linked to contact' },
  { from: 'crm_messages', fromField: 'contact_id', to: 'contacts', toField: 'id', type: 'foreign_key', description: 'Message belongs to contact' },
  { from: 'crm_messages', fromField: 'conversation_id', to: 'conversations', toField: 'id', type: 'foreign_key', description: 'Message in conversation thread' },
  { from: 'email_sends', fromField: 'contact_id', to: 'contacts', toField: 'id', type: 'foreign_key', description: 'Email sent to contact' },
  { from: 'email_sends', fromField: 'campaign_id', to: 'email_campaigns', toField: 'id', type: 'foreign_key', description: 'Email part of campaign' },
  { from: 'sequence_enrollments', fromField: 'contact_id', to: 'contacts', toField: 'id', type: 'foreign_key', description: 'Contact enrolled in sequence' },
  { from: 'sequence_enrollments', fromField: 'sequence_id', to: 'sequences', toField: 'id', type: 'foreign_key', description: 'Enrollment references sequence' },
  { from: 'sequence_steps', fromField: 'sequence_id', to: 'sequences', toField: 'id', type: 'foreign_key', description: 'Step belongs to sequence' },
  { from: 'ehr_session_notes', fromField: 'contact_id', to: 'contacts', toField: 'id', type: 'foreign_key', description: 'Session for client' },
  { from: 'ehr_form_submissions', fromField: 'contact_id', to: 'contacts', toField: 'id', type: 'foreign_key', description: 'Form filled by client' },
  { from: 'ehr_form_submissions', fromField: 'template_id', to: 'ehr_form_templates', toField: 'id', type: 'foreign_key', description: 'Submission uses template' },
  { from: 'ehr_protocols', fromField: 'contact_id', to: 'contacts', toField: 'id', type: 'foreign_key', description: 'Protocol for client' },
  { from: 'social_posts', fromField: 'custom_fields.category', to: 'UI_enum', toField: 'announcement|event|evergreen|draft', type: 'jsonb_ref', description: 'Post categorization in JSONB' },
  { from: 'social_posts', fromField: 'custom_fields.media', to: 'media_assets', toField: 'id', type: 'jsonb_ref', description: 'Social post media refs in JSONB' },
  { from: 'pipeline_resources', fromField: 'pipeline_id', to: 'org_settings(pipelines)', toField: 'id', type: 'jsonb_ref', description: 'Resource attached to pipeline' },
  { from: 'brand_profiles', fromField: 'org_id', to: 'organizations', toField: 'id', type: 'foreign_key', description: 'Brand profile belongs to org' },
  { from: 'call_logs', fromField: 'contact_id', to: 'contacts', toField: 'id', type: 'foreign_key', description: 'Call linked to contact' },
  { from: 'acct_payments', fromField: 'client_id', to: 'acct_clients', toField: 'id', type: 'foreign_key', description: 'Payment from client' },
  { from: 'acct_payments', fromField: 'clinic_id', to: 'acct_clinics', toField: 'id', type: 'foreign_key', description: 'Payment at clinic' },
]

export async function GET(req: NextRequest) {
  const startTime = Date.now()
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )

  const results: Record<string, any> = { scanTime: new Date().toISOString() }
  results.siteMap = SITE_MAP
  results.apiRoutes = API_ROUTES
  results.fieldConnections = FIELD_CONNECTIONS

  // ── ENV ──
  results.env = REQUIRED_ENV.map(env => ({
    ...env,
    status: process.env[env.key] ? 'ok' : env.critical ? 'error' : 'warning',
    masked: process.env[env.key]
      ? (env.key.includes('KEY') || env.key.includes('SECRET') || env.key.includes('TOKEN') || env.key.includes('SID') ? '***' + (process.env[env.key]?.slice(-4) || '') : process.env[env.key]!.slice(0, 50))
      : 'NOT SET',
  }))

  // ── TABLE HEALTH ──
  const tableHealth: Array<{ name: string; module: string; status: string; rows: number; error?: string; usedBy: string[] }> = []
  for (const t of ALL_TABLES) {
    try {
      const { count, error } = await supabase.from(t.name).select('*', { count: 'exact', head: true })
      tableHealth.push(error
        ? { name: t.name, module: t.module, status: error.message.includes('does not exist') ? 'missing' : 'error', rows: 0, error: error.message, usedBy: t.usedBy }
        : { name: t.name, module: t.module, status: 'ok', rows: count || 0, usedBy: t.usedBy })
    } catch (e: any) { tableHealth.push({ name: t.name, module: t.module, status: 'error', rows: 0, error: e.message, usedBy: t.usedBy }) }
  }
  results.tableHealth = tableHealth

  // ── CROSS-REFERENCE INTEGRITY ──
  const integrity: Array<{ check: string; status: string; detail: string; fix?: string }> = []

  try {
    const { data: cards } = await supabase.from('journey_cards').select('id, phase_id').limit(500)
    const { data: phases } = await supabase.from('journey_phases').select('id').limit(500)
    const phaseIds = new Set((phases || []).map(p => p.id))
    const orphaned = (cards || []).filter(c => c.phase_id && !phaseIds.has(c.phase_id))
    integrity.push({ check: 'journey_cards → journey_phases', status: orphaned.length ? 'warning' : 'ok', detail: orphaned.length ? `${orphaned.length} orphaned card-phase refs` : `${cards?.length || 0} cards valid`, fix: orphaned.length ? `DELETE FROM journey_cards WHERE phase_id NOT IN (SELECT id FROM journey_phases)` : undefined })
  } catch { integrity.push({ check: 'journey_cards → phases', status: 'skip', detail: 'Not accessible' }) }

  try {
    const { data: links } = await supabase.from('card_task_links').select('card_id, task_id').limit(500)
    if (links && links.length) {
      const { data: cards } = await supabase.from('journey_cards').select('id').limit(1000)
      const { data: tasks } = await supabase.from('kanban_tasks').select('id').limit(1000)
      const cIds = new Set((cards || []).map(c => c.id)), tIds = new Set((tasks || []).map(t => t.id))
      const bc = links.filter(l => !cIds.has(l.card_id)), bt = links.filter(l => !tIds.has(l.task_id))
      integrity.push({ check: 'card_task_links reciprocal', status: (bc.length || bt.length) ? 'warning' : 'ok', detail: `${links.length} links. ${bc.length} orphan cards, ${bt.length} orphan tasks`, fix: (bc.length || bt.length) ? `DELETE FROM card_task_links WHERE card_id NOT IN (SELECT id FROM journey_cards) OR task_id NOT IN (SELECT id FROM kanban_tasks)` : undefined })
    } else integrity.push({ check: 'card_task_links', status: 'ok', detail: 'Empty table' })
  } catch { integrity.push({ check: 'card_task_links', status: 'skip', detail: 'Not accessible' }) }

  try {
    const { count: total } = await supabase.from('contacts').select('*', { count: 'exact', head: true })
    const { count: inPipeline } = await supabase.from('contacts').select('*', { count: 'exact', head: true }).not('pipeline_id', 'is', null)
    integrity.push({ check: 'contacts pipeline coverage', status: 'ok', detail: `${inPipeline||0}/${total||0} in pipelines` })
  } catch { integrity.push({ check: 'contacts pipeline', status: 'skip', detail: 'N/A' }) }

  try {
    const { data: enr } = await supabase.from('sequence_enrollments').select('sequence_id, status').limit(500)
    if (enr?.length) {
      const { data: seqs } = await supabase.from('sequences').select('id').limit(200)
      const sIds = new Set((seqs||[]).map(s=>s.id))
      const orph = enr.filter(e => !sIds.has(e.sequence_id))
      integrity.push({ check: 'sequence_enrollments → sequences', status: orph.length ? 'warning':'ok', detail: `${enr.length} enrollments, ${orph.length} orphaned`, fix: orph.length ? `DELETE FROM sequence_enrollments WHERE sequence_id NOT IN (SELECT id FROM sequences)` : undefined })
    } else integrity.push({ check: 'sequence_enrollments', status: 'ok', detail: 'None yet' })
  } catch { integrity.push({ check: 'sequence_enrollments', status: 'skip', detail: 'N/A' }) }

  try {
    const { data: subs } = await supabase.from('ehr_form_submissions').select('template_id').limit(500)
    const { data: tpls } = await supabase.from('ehr_form_templates').select('id').limit(200)
    const tIds = new Set((tpls||[]).map(t=>t.id))
    const orph = (subs||[]).filter(s => s.template_id && !tIds.has(s.template_id))
    integrity.push({ check: 'form_submissions → templates', status: orph.length?'warning':'ok', detail: `${subs?.length||0} submissions, ${orph.length} orphaned` })
  } catch { integrity.push({ check: 'form_submissions → templates', status: 'skip', detail: 'N/A' }) }

  try {
    const { data: orgs } = await supabase.from('organizations').select('id, name').limit(20)
    for (const org of orgs || []) {
      const { count } = await supabase.from('org_settings').select('*', { count: 'exact', head: true }).eq('org_id', org.id)
      integrity.push({ check: `org_settings "${org.name}"`, status: (count||0)>0?'ok':'warning', detail: `${count||0} settings`, fix: (count||0)===0?'Navigate to CRM Settings to configure':undefined })
    }
  } catch {}

  try {
    const { data: brands } = await supabase.from('brand_profiles').select('org_id, brand_key, updated_at').limit(20)
    const stale = (brands||[]).filter(b => (Date.now() - new Date(b.updated_at).getTime()) > 90*86400000)
    integrity.push({ check: 'brand_profiles freshness', status: stale.length?'info':'ok', detail: `${brands?.length||0} profiles. ${stale.length} stale (90+ days)` })
  } catch { integrity.push({ check: 'brand_profiles', status: 'skip', detail: 'N/A' }) }

  results.integrity = integrity

  // ── DEPENDENCY CASCADE CHAINS ──
  // For each broken table/integration, trace what pages/APIs/components break
  const cascades: Array<{ source: string; sourceType: string; status: string; affects: Array<{ type: string; name: string; path?: string }> }> = []
  for (const t of tableHealth.filter(t => t.status !== 'ok')) {
    const affected: Array<{ type: string; name: string; path?: string }> = []
    for (const page of SITE_MAP) { if (page.tables.includes(t.name)) affected.push({ type: 'page', name: page.page, path: page.path }) }
    for (const api of API_ROUTES) { if (api.tables.includes(t.name)) affected.push({ type: 'api', name: api.name, path: api.path }) }
    for (const conn of FIELD_CONNECTIONS) { if (conn.from === t.name || conn.to === t.name) affected.push({ type: 'connection', name: `${conn.from}.${conn.fromField} → ${conn.to}.${conn.toField}` }) }
    if (affected.length > 0) cascades.push({ source: t.name, sourceType: 'table', status: t.status, affects: affected })
  }
  for (const e of results.env.filter((e: any) => e.status !== 'ok' && e.critical)) {
    const affected: Array<{ type: string; name: string; path?: string }> = []
    if (e.key === 'ANTHROPIC_API_KEY') { for (const p of SITE_MAP) { if (p.apis.includes('/api/ai')) affected.push({ type: 'page', name: p.page, path: p.path }) }; affected.push({ type: 'api', name: 'AI Engine', path: '/api/ai' }) }
    if (e.key.startsWith('TWILIO')) { for (const a of API_ROUTES.filter(a => a.module === 'twilio' || a.module === 'voice' || a.module === 'sms')) affected.push({ type: 'api', name: a.name, path: a.path }) }
    if (e.key.includes('SUPABASE')) { affected.push({ type: 'system', name: 'ALL database operations' }) }
    if (affected.length > 0) cascades.push({ source: e.key, sourceType: 'env', status: e.status, affects: affected })
  }
  results.cascades = cascades

  // ── DEAD CODE / ORPHAN DETECTION ──
  const orphans: Array<{ type: string; name: string; detail: string; severity: 'info' | 'warning' }> = []
  // Tables with zero usage in codebase
  for (const t of ALL_TABLES) { if (t.usedBy.length === 0) orphans.push({ type: 'table', name: t.name, detail: 'Referenced in schema but no page, component, or lib queries this table', severity: 'info' }) }
  // Stub pages (built but empty)
  for (const p of SITE_MAP) { if (p.status === 'stub') orphans.push({ type: 'page', name: `${p.page} (${p.path})`, detail: `Stub page — route exists but no database queries or functionality built`, severity: 'warning' }) }
  // Pages with no tables AND no APIs (potentially not functional)
  for (const p of SITE_MAP) { if (p.status === 'production' && p.tables.length === 0 && p.apis.length === 0 && p.hooks.length === 0 && p.components.length === 0) orphans.push({ type: 'page', name: `${p.page} (${p.path})`, detail: 'Production page with no direct table queries, API calls, hooks, or components — may delegate all logic to child components or be a layout page', severity: 'info' }) }
  results.orphans = orphans

  // ── DATA FRESHNESS ──
  const freshness: Array<{ table: string; lastActivity: string | null; status: string; detail: string }> = []
  const freshnessChecks = [
    { table: 'contacts', col: 'updated_at', label: 'Contact updates' },
    { table: 'crm_messages', col: 'created_at', label: 'Messages' },
    { table: 'email_sends', col: 'created_at', label: 'Email sends' },
    { table: 'ehr_session_notes', col: 'created_at', label: 'Session notes' },
    { table: 'social_posts', col: 'created_at', label: 'Social posts' },
    { table: 'call_logs', col: 'created_at', label: 'Call logs' },
    { table: 'activity_log', col: 'created_at', label: 'Activity log' },
    { table: 'kanban_tasks', col: 'updated_at', label: 'Task updates' },
    { table: 'ehr_form_submissions', col: 'created_at', label: 'Form submissions' },
    { table: 'journey_cards', col: 'updated_at', label: 'Journey cards' },
  ]
  for (const fc of freshnessChecks) {
    try {
      const { data: row } = await supabase.from(fc.table).select(fc.col).order(fc.col, { ascending: false }).limit(1)
      const firstRow = row?.[0] as Record<string, any> | undefined
      if (firstRow && firstRow[fc.col]) {
        const last = new Date(firstRow[fc.col])
        const hoursAgo = Math.round((Date.now() - last.getTime()) / 3600000)
        const daysAgo = Math.round(hoursAgo / 24)
        freshness.push({ table: fc.table, lastActivity: last.toISOString(), status: daysAgo > 30 ? 'stale' : daysAgo > 7 ? 'aging' : 'fresh', detail: daysAgo > 0 ? `${daysAgo} days ago` : `${hoursAgo} hours ago` })
      } else { freshness.push({ table: fc.table, lastActivity: null, status: 'empty', detail: 'No data' }) }
    } catch { freshness.push({ table: fc.table, lastActivity: null, status: 'error', detail: 'Could not query' }) }
  }
  results.freshness = freshness

  // ── EXTERNAL SERVICE STATUS ──
  const services: Array<{ name: string; status: string; detail: string; latency?: number }> = []
  // Supabase
  const sbStart = Date.now()
  try {
    const { error } = await supabase.from('organizations').select('id').limit(1)
    services.push({ name: 'Supabase Database', status: error ? 'error' : 'ok', detail: error ? error.message : 'Connected', latency: Date.now() - sbStart })
  } catch (e: any) { services.push({ name: 'Supabase Database', status: 'error', detail: e.message, latency: Date.now() - sbStart }) }
  // Anthropic
  services.push({ name: 'Anthropic Claude', status: process.env.ANTHROPIC_API_KEY ? 'configured' : 'missing', detail: process.env.ANTHROPIC_API_KEY ? 'API key set' : 'ANTHROPIC_API_KEY not configured' })
  // Twilio
  const twilioKeys = ['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_PHONE_NUMBER']
  const twilioSet = twilioKeys.filter(k => process.env[k]).length
  services.push({ name: 'Twilio (Voice + SMS)', status: twilioSet === twilioKeys.length ? 'configured' : twilioSet > 0 ? 'partial' : 'missing', detail: `${twilioSet}/${twilioKeys.length} required keys set` })
  // Deepgram
  services.push({ name: 'Deepgram (Transcription)', status: process.env.DEEPGRAM_API_KEY ? 'configured' : 'missing', detail: process.env.DEEPGRAM_API_KEY ? 'API key set' : 'Optional — used for voice transcription' })
  // Google Apps Script
  services.push({ name: 'Google Apps Script', status: process.env.APPS_SCRIPT_URL ? 'configured' : 'missing', detail: process.env.APPS_SCRIPT_URL ? 'URL configured' : 'Optional — NSCI and assessment tools' })
  results.services = services

  // ── CLAUDE REPAIR PROMPT GENERATOR ──
  // Build a comprehensive, copy-paste-ready prompt for Claude to fix all issues
  const allIssues: Array<{ category: string; severity: string; item: string; detail: string; fix?: string; affectedPages?: string[]; affectedApis?: string[] }> = []
  for (const t of tableHealth.filter(t => t.status !== 'ok')) {
    const pages = SITE_MAP.filter(p => p.tables.includes(t.name)).map(p => p.path)
    const apis = API_ROUTES.filter(a => a.tables.includes(t.name)).map(a => a.path)
    allIssues.push({ category: 'DATABASE', severity: t.status === 'missing' ? 'critical' : 'error', item: t.name, detail: t.error || `Table ${t.status}`, fix: t.status === 'missing' ? `CREATE TABLE ${t.name} (...) — check Supabase migrations` : undefined, affectedPages: pages.length ? pages : undefined, affectedApis: apis.length ? apis : undefined })
  }
  for (const i of integrity.filter(i => i.status === 'warning' || i.status === 'error')) {
    allIssues.push({ category: 'INTEGRITY', severity: i.status === 'error' ? 'critical' : 'warning', item: i.check, detail: i.detail, fix: i.fix || undefined })
  }
  for (const e of results.env.filter((e: any) => e.status !== 'ok')) {
    allIssues.push({ category: 'ENVIRONMENT', severity: e.critical ? 'critical' : 'warning', item: e.key, detail: `Not set — required for ${e.module} module` })
  }
  for (const f of freshness.filter(f => f.status === 'stale')) {
    allIssues.push({ category: 'DATA_FRESHNESS', severity: 'info', item: f.table, detail: `Last activity: ${f.detail}` })
  }
  for (const s of services.filter(s => s.status === 'error' || s.status === 'missing')) {
    allIssues.push({ category: 'SERVICE', severity: s.status === 'error' ? 'critical' : 'warning', item: s.name, detail: s.detail })
  }

  // Generate the structured Claude prompt
  let claudePrompt = ''
  if (allIssues.length > 0) {
    claudePrompt = `# NPU Hub System Audit — ${allIssues.length} Issues Detected
Scan time: ${new Date().toISOString()}
Health score: ${Math.round(((tableHealth.filter(t=>t.status==='ok').length/ALL_TABLES.length)*40)+((results.env.filter((e:any)=>e.status==='ok').length/REQUIRED_ENV.length)*20)+((integrity.filter(i=>i.status==='ok').length/Math.max(integrity.length,1))*25)+((SITE_MAP.filter(p=>p.status==='production').length/SITE_MAP.length)*15))}/100

## Tech Stack
- Framework: Next.js 14 (App Router) with TypeScript
- Database: Supabase (PostgreSQL with RLS)
- Auth: Supabase Auth with org_members table for multi-tenant isolation
- Hosting: Vercel
- Integrations: Twilio (voice/SMS), Anthropic Claude (AI), Deepgram (transcription), Google Apps Script
- Key patterns: Multi-org via org_id + RLS, custom_fields JSONB for extensible schemas, workspace-context.tsx for org switching

## File Structure
- Pages: src/app/(dashboard)/[page]/page.tsx
- API routes: src/app/api/[endpoint]/route.ts
- Components: src/components/[module]/[component].tsx
- Hooks: src/lib/hooks/[hook].ts
- Core libs: src/lib/crm-client.ts, crm-server.ts, workspace-context.tsx

## Issues Found
`
    const grouped: Record<string, typeof allIssues> = {}
    for (const issue of allIssues) {
      if (!grouped[issue.category]) grouped[issue.category] = []
      grouped[issue.category].push(issue)
    }
    for (const [cat, issues] of Object.entries(grouped)) {
      claudePrompt += `\n### ${cat} (${issues.length})\n`
      for (const issue of issues) {
        claudePrompt += `- [${issue.severity.toUpperCase()}] **${issue.item}**: ${issue.detail}\n`
        if (issue.fix) claudePrompt += `  Known fix: \`${issue.fix}\`\n`
        if (issue.affectedPages?.length) claudePrompt += `  Breaks pages: ${issue.affectedPages.join(', ')}\n`
        if (issue.affectedApis?.length) claudePrompt += `  Breaks APIs: ${issue.affectedApis.join(', ')}\n`
      }
    }
    claudePrompt += `
## What I Need From You
For EACH issue above:
1. **Root Cause** — Why this is happening (missing migration, config drift, code mismatch, etc.)
2. **Exact Fix** — Provide the specific SQL, TypeScript code change, or Vercel env var to set. Include the full file path.
3. **Verification** — How to confirm the fix worked (SQL query, API test, page check)
4. **Prevention** — What to add so this doesn't recur (migration script, validation, monitoring)

Prioritize CRITICAL issues first. For missing tables, provide the full CREATE TABLE SQL with all columns and RLS policies matching the org_id pattern. For broken field connections, provide the ALTER TABLE or data migration SQL. For missing env vars, state exactly what the value should look like and where to set it in Vercel.
`
  }
  results.claudePrompt = claudePrompt
  results.allIssues = allIssues

  // ── SUMMARY ──
  const tOk = tableHealth.filter(t=>t.status==='ok').length
  const tMiss = tableHealth.filter(t=>t.status==='missing').length
  const tErr = tableHealth.filter(t=>t.status==='error').length
  const eOk = results.env.filter((e:any)=>e.status==='ok').length
  const iOk = integrity.filter(i=>i.status==='ok').length
  const iWarn = integrity.filter(i=>i.status==='warning').length
  const prodP = SITE_MAP.filter(p=>p.status==='production').length

  results.summary = {
    overallScore: Math.round(((tOk/ALL_TABLES.length)*40)+((eOk/REQUIRED_ENV.length)*20)+((iOk/Math.max(integrity.length,1))*25)+((prodP/SITE_MAP.length)*15)),
    tables: { total: ALL_TABLES.length, ok: tOk, missing: tMiss, error: tErr },
    env: { total: REQUIRED_ENV.length, ok: eOk, missing: REQUIRED_ENV.length - eOk },
    integrity: { total: integrity.length, ok: iOk, warnings: iWarn, errors: integrity.filter(i=>i.status==='error').length },
    pages: { total: SITE_MAP.length, production: prodP, beta: SITE_MAP.filter(p=>p.status==='beta').length, stub: SITE_MAP.filter(p=>p.status==='stub').length },
    apis: { total: API_ROUTES.length, critical: API_ROUTES.filter(a=>a.critical).length },
    connections: FIELD_CONNECTIONS.length,
    cascades: cascades.length,
    orphans: orphans.length,
    services: { total: services.length, ok: services.filter(s=>s.status==='ok'||s.status==='configured').length, issues: services.filter(s=>s.status==='error'||s.status==='missing').length },
    freshness: { fresh: freshness.filter(f=>f.status==='fresh').length, stale: freshness.filter(f=>f.status==='stale').length, aging: freshness.filter(f=>f.status==='aging').length },
    totalIssues: allIssues.length,
    scanMs: Date.now()-startTime,
  }

  return NextResponse.json(results)
}
