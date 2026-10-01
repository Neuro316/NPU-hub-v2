-- BRANCH ONLY. NEVER APPLY TO THE LIVE PROJECT.
--
-- Supabase branches of htfrfaxlcuyawtlztxxm fail their migration replay (status
-- MIGRATIONS_FAILED, 0 tables), so hub_211 cannot be tested on a replayed schema.
-- This file recreates ONLY the objects hub_211 depends on, copied from live
-- pg_catalog on 2026-09-30 (columns, defaults, NOT NULL, PK/unique/check
-- constraints, and FKs between these objects or to auth.users). Policies,
-- triggers and indexes on these tables are NOT copied: hub_211 does not depend on
-- them, and the tests exercise hub_211's own functions and policies.
--
-- Objects copied by hand (the Stage 1 results list these):
--   type  public.user_role
--   table public.organizations, public.profiles, public.team_profiles,
--         public.contacts, public.org_settings, public.sequences,
--         public.sequence_steps, public.sequence_enrollments,
--         public.do_not_contact_list, public.campaigns, public.contact_timeline

create type public.user_role as enum ('participant','facilitator','admin','superadmin');

create table public.organizations (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  owner_id uuid,
  logo_url text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  show_financials_to_admin boolean default true,
  show_financials_to_facilitator boolean default false,
  marketplace_isolation boolean default false not null,
  listed_in_global_store boolean default true not null,
  created_by uuid
);
create table public.profiles (
  id uuid not null,
  email text not null,
  full_name text default ''::text not null,
  avatar_url text,
  role public.user_role default 'participant'::public.user_role not null,
  organization_id uuid,
  xreg_participant_id text,
  date_of_birth date,
  gender text,
  location_city text,
  location_state text,
  location_country text default 'US'::text,
  timezone text default 'America/New_York'::text,
  primary_motivation text,
  referral_source text,
  icp_segment text,
  occupation text,
  industry text,
  notification_preferences jsonb default '{"sms": false, "push": true, "email": true}'::jsonb,
  display_preferences jsonb default '{"theme": "auto", "data_density": "standard"}'::jsonb,
  onboarding_completed boolean default false,
  onboarded_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  settings jsonb default '{}'::jsonb,
  xreg_user_id text,
  status text default 'active'::text,
  phone text,
  facilitator_profile jsonb,
  bio text,
  profile_visibility jsonb default '{}'::jsonb not null,
  population_type text
);
create table public.team_profiles (
  id uuid default extensions.uuid_generate_v4() not null,
  org_id uuid not null,
  user_id uuid,
  display_name text not null,
  email text,
  role text default 'team_member'::text,
  job_title text,
  avatar_url text,
  slack_user_id text,
  slack_display_name text,
  phone text,
  status text default 'active'::text,
  permissions jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
create table public.contacts (
  id uuid default gen_random_uuid() not null,
  org_id uuid not null,
  first_name text not null,
  last_name text not null,
  phone text,
  email text,
  sms_consent boolean default false not null,
  email_consent boolean default false not null,
  email_consent_at timestamp with time zone,
  email_unsubscribed_at timestamp with time zone,
  do_not_contact boolean default false not null,
  tags text[] default '{}'::text[],
  pipeline_stage text,
  assigned_to uuid,
  source text,
  notes text,
  last_contacted_at timestamp with time zone,
  merged_into_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  search_vector tsvector generated always as (((setweight(to_tsvector('english'::regconfig, COALESCE(first_name, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(last_name, ''::text)), 'A'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(email, ''::text)), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(notes, ''::text)), 'C'::"char")) stored,
  identity_id uuid,
  custom_fields jsonb default '{}'::jsonb,
  health_score integer default 50,
  health_tier text default 'stable'::text,
  acquisition_source text,
  acquisition_campaign text,
  acquisition_utm jsonb,
  mastermind_user_id uuid,
  mastermind_status text,
  ehr_patient_id text,
  total_calls integer default 0,
  total_texts integer default 0,
  total_emails integer default 0,
  last_call_at timestamp with time zone,
  last_text_at timestamp with time zone,
  last_email_at timestamp with time zone,
  total_inbound_calls integer default 0,
  total_outbound_calls integer default 0,
  total_inbound_texts integer default 0,
  total_outbound_texts integer default 0,
  total_call_duration_seconds integer default 0,
  pipeline_id text,
  address_city text,
  address_state text,
  preferred_name text,
  reason_for_contact text,
  occupation text,
  instagram_handle text,
  linkedin_url text,
  contact_type text,
  population_served text,
  preferred_outreach_strategy text,
  topics_of_interest text[] default '{}'::text[],
  presentation_topics text[] default '{}'::text[],
  publications text,
  key_differentiator text,
  twitter_handle text,
  facebook_url text,
  youtube_url text,
  tiktok_handle text,
  website_url text,
  blog_url text,
  social_follow_suggestion boolean default false,
  ai_research_notes text,
  ai_connection_discoveries jsonb default '[]'::jsonb,
  import_batch_id uuid,
  referred_by_contact_id uuid,
  referral_depth integer default 0,
  engagement_response_rate numeric(5,2),
  top_responding_topics text[] default '{}'::text[],
  last_enriched_at timestamp with time zone,
  industry text,
  company text,
  timezone text,
  preferred_contact_method text,
  how_heard_about_us text,
  emergency_contact_name text,
  emergency_contact_phone text,
  date_of_birth date,
  archived_at timestamp with time zone,
  enrolled_services jsonb default '[]'::jsonb,
  consent_forms jsonb default '[]'::jsonb,
  neuroreport_linked boolean default false,
  neuroreport_linked_at timestamp with time zone,
  neuroreport_patient_id text,
  neuroreport_program text,
  auto_tags text[] default '{}'::text[],
  enrollment_type text,
  sms_consent_at timestamp with time zone,
  terms_accepted boolean default false,
  terms_accepted_at timestamp with time zone,
  pipeline text default 'new_lead'::text,
  avatar_url text,
  xreg_user_id text,
  xreg_email_confirmed boolean default false,
  subscription_status text,
  subscription_plan text,
  outreach_rank integer,
  platform text,
  profile_handle text,
  primary_niche text,
  audience_type text,
  fit_category text,
  alignment_score integer,
  commercial_relevance_score integer,
  outreach_ease_score integer,
  credibility_score integer,
  outreach_total_score integer,
  priority_tier text,
  offer_angle text,
  outreach_opener text,
  outreach_status text,
  outreach_last_touch date,
  outreach_next_step text,
  outreach_response_summary text,
  outreach_follow_up_date date,
  partnership_type text,
  outreach_owner text,
  outreach_strategy text,
  instagram_followers integer,
  linkedin_followers integer,
  youtube_subscribers integer,
  tiktok_followers integer,
  facebook_followers integer,
  twitter_followers integer,
  podcast_listeners integer,
  email_list_subscribers integer,
  total_est_reach integer,
  est_audience_size text,
  engagement_rate text,
  content_frequency text,
  content_type text,
  market_segment text,
  geographic_market text,
  competitor_partnerships text,
  market_opportunity_notes text,
  revenue_potential text,
  npu_sensorium_fit text,
  outreach_sequence_started date,
  followup_day3_message text,
  followup_day7_message text,
  followup_day10_message text,
  due_date date,
  due_date_action text,
  due_date_notified boolean default false,
  due_date_channel text default '#ops'::text,
  intake_completed boolean default false,
  intake_date date,
  enrollment_status text default 'prospect'::text,
  program_start_date date,
  program_end_date date,
  university_user_id text,
  community_user_id text,
  emergency_contact jsonb,
  medical_notes text,
  clinical_notes text,
  address_street text,
  address_zip text
);
create table public.org_settings (
  id uuid default extensions.uuid_generate_v4() not null,
  org_id uuid not null,
  setting_key text not null,
  setting_value jsonb default '{}'::jsonb,
  updated_at timestamp with time zone default now()
);
create table public.sequences (
  id uuid default gen_random_uuid() not null,
  org_id uuid not null,
  name text not null,
  description text,
  is_active boolean default true not null,
  trigger_event text,
  enrollment_count integer default 0,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.sequence_steps (
  id uuid default gen_random_uuid() not null,
  sequence_id uuid not null,
  step_order integer not null,
  channel text not null,
  delay_minutes integer default 0 not null,
  subject text,
  body text,
  template_id uuid,
  task_title text,
  task_description text,
  created_at timestamp with time zone default now() not null
);
create table public.sequence_enrollments (
  id uuid default gen_random_uuid() not null,
  sequence_id uuid not null,
  contact_id uuid not null,
  current_step integer default 0 not null,
  status text default 'active'::text not null,
  next_step_at timestamp with time zone,
  enrolled_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);
create table public.do_not_contact_list (
  id uuid default gen_random_uuid() not null,
  org_id uuid not null,
  phone text,
  email text,
  reason text,
  added_by uuid,
  created_at timestamp with time zone default now() not null
);
create table public.campaigns (
  id uuid default extensions.uuid_generate_v4() not null,
  org_id uuid not null,
  brand text default 'np'::text,
  name text not null,
  description text,
  icp_id uuid,
  quiz_id uuid,
  status text default 'draft'::text,
  budget double precision,
  start_date date,
  end_date date,
  goals jsonb default '{}'::jsonb,
  post_ids uuid[] default '{}'::uuid[],
  funnel_config jsonb default '{}'::jsonb,
  ai_suggestions jsonb default '{}'::jsonb,
  custom_fields jsonb default '{}'::jsonb,
  created_by uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  template_key text,
  phases jsonb default '[]'::jsonb
);
create table public.contact_timeline (
  id uuid default gen_random_uuid() not null,
  org_id uuid not null,
  contact_id uuid not null,
  event_type text not null,
  title text not null,
  description text,
  metadata jsonb default '{}'::jsonb,
  source_table text,
  source_id uuid,
  actor_type text default 'system'::text,
  actor_id uuid,
  occurred_at timestamp with time zone default now() not null
);

alter table public.organizations add constraint organizations_pkey PRIMARY KEY (id);
alter table public.organizations add constraint organizations_slug_key UNIQUE (slug);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
alter table public.organizations add constraint fk_org_owner FOREIGN KEY (owner_id) REFERENCES public.profiles(id);
alter table public.team_profiles add constraint team_profiles_pkey PRIMARY KEY (id);
alter table public.team_profiles add constraint team_profiles_org_id_email_key UNIQUE (org_id, email);
alter table public.team_profiles add constraint team_profiles_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
alter table public.team_profiles add constraint team_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.team_profiles add constraint team_profiles_role_check CHECK ((role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'team_member'::text, 'facilitator'::text, 'participant'::text])));
alter table public.team_profiles add constraint team_profiles_status_check CHECK ((status = ANY (ARRAY['active'::text, 'invited'::text, 'inactive'::text])));
alter table public.contacts add constraint contacts_pkey PRIMARY KEY (id);
alter table public.contacts add constraint contacts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
alter table public.org_settings add constraint org_settings_pkey PRIMARY KEY (id);
alter table public.org_settings add constraint org_settings_org_id_setting_key_key UNIQUE (org_id, setting_key);
alter table public.org_settings add constraint org_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
alter table public.sequences add constraint sequences_pkey PRIMARY KEY (id);
alter table public.sequences add constraint sequences_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
alter table public.sequence_steps add constraint sequence_steps_pkey PRIMARY KEY (id);
alter table public.sequence_steps add constraint sequence_steps_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.sequences(id) ON DELETE CASCADE;
alter table public.sequence_steps add constraint sequence_steps_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'sms'::text, 'task'::text, 'wait'::text])));
alter table public.sequence_enrollments add constraint sequence_enrollments_pkey PRIMARY KEY (id);
alter table public.sequence_enrollments add constraint sequence_enrollments_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.sequences(id) ON DELETE CASCADE;
alter table public.sequence_enrollments add constraint sequence_enrollments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'paused'::text, 'failed'::text, 'unenrolled'::text])));
alter table public.do_not_contact_list add constraint do_not_contact_list_pkey PRIMARY KEY (id);
alter table public.do_not_contact_list add constraint do_not_contact_list_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
alter table public.do_not_contact_list add constraint dnc_at_least_one CHECK (((phone IS NOT NULL) OR (email IS NOT NULL)));
alter table public.campaigns add constraint campaigns_pkey PRIMARY KEY (id);
alter table public.campaigns add constraint campaigns_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
alter table public.campaigns add constraint campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text, 'completed'::text, 'archived'::text])));
alter table public.contact_timeline add constraint contact_timeline_pkey PRIMARY KEY (id);
alter table public.contact_timeline add constraint contact_timeline_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- the two org rows and the pipeline JSON shape the backfill reads, fixture values only
insert into public.organizations (id, name, slug) values
  ('00000000-0000-0000-0000-000000000001', 'Neuro Progeny', 'neuro-progeny'),
  ('b9fd8b2e-ded6-468b-ab1e-10b50ca40629', 'Sensorium Neuro Wellness', 'sensorium');
