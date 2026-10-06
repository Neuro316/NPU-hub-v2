-- supabase/branch-bootstrap/hub_214_dependencies.sql
-- BRANCH ONLY (hub-rls-214). Never run against htfrfaxlcuyawtlztxxm.
--
-- The tables, helpers, policies and grants hub_214 touches, copied from the live catalog on
-- 2026-10-02 (pg_attribute, pg_get_functiondef, pg_policy, aclexplode). Foreign keys are left out:
-- no policy here reads one. Columns, defaults and nullability are as live.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_role' and typnamespace = 'public'::regnamespace) then
    create type public.user_role as enum ('participant', 'facilitator', 'admin', 'superadmin');
  end if;
end $$;

create table public.profiles (id uuid not null primary key, email text not null, full_name text not null default '',
  role public.user_role not null default 'participant', organization_id uuid);
create table public.org_members (id uuid not null default gen_random_uuid() primary key, user_id uuid, organization_id uuid,
  role text default 'member', created_at timestamptz default now(), status text default 'active');
create table public.team_profiles (id uuid not null default gen_random_uuid() primary key, org_id uuid not null, user_id uuid,
  display_name text not null, email text, role text default 'team_member', status text default 'active');
create table public.sequences (id uuid not null default gen_random_uuid() primary key, org_id uuid not null, name text not null,
  description text, is_active boolean not null default true, trigger_event text, enrollment_count integer default 0, created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), campaign_id uuid);
create table public.sequence_steps (id uuid not null default gen_random_uuid() primary key, sequence_id uuid not null,
  step_order integer not null, channel text not null, delay_minutes integer not null default 0, subject text, body text,
  template_id uuid, task_title text, task_description text, created_at timestamptz not null default now(),
  step_type text not null default 'message', kind text, asset_id uuid, ai_run_id uuid, ai_reviewed_at timestamptz);
create table public.sequence_enrollments (id uuid not null default gen_random_uuid() primary key, sequence_id uuid not null,
  contact_id uuid not null, current_step integer not null default 0, status text not null default 'active', next_step_at timestamptz,
  enrolled_at timestamptz not null default now(), completed_at timestamptz, created_at timestamptz not null default now(),
  campaign_enrollment_id uuid);
create table public.email_campaigns (id uuid not null default gen_random_uuid() primary key, org_id uuid not null, name text not null,
  subject text not null, body_html text, body_text text, from_name text, reply_to text, status text not null default 'draft',
  scheduled_at timestamptz, started_at timestamptz, completed_at timestamptz, total_recipients integer default 0,
  sent_count integer default 0, failed_count integer default 0, filter_tags text[], filter_stages text[], exclude_tags text[],
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.email_sends (id uuid not null default gen_random_uuid() primary key, campaign_id uuid not null,
  contact_id uuid not null, status text not null default 'queued', sent_at timestamptz, opened_at timestamptz,
  clicked_at timestamptz, error_message text, external_message_id text, created_at timestamptz not null default now());

-- helpers, verbatim from pg_get_functiondef
CREATE OR REPLACE FUNCTION public.user_org_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp' AS $function$ SELECT organization_id FROM org_members WHERE user_id = auth.uid() $function$;
CREATE OR REPLACE FUNCTION public.hub_team_org_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO '' AS $function$ select tp.org_id from public.team_profiles tp where tp.user_id = auth.uid() and tp.status = 'active' $function$;
revoke execute on function public.user_org_ids() from public;
grant execute on function public.user_org_ids() to anon, authenticated;
revoke execute on function public.hub_team_org_ids() from public;
grant execute on function public.hub_team_org_ids() to authenticated;

-- grants as live: authenticated holds SELECT, INSERT, UPDATE, DELETE on all eight; anon holds nothing
do $$ declare t text; begin
  foreach t in array array['profiles','org_members','team_profiles','sequences','sequence_steps','sequence_enrollments','email_campaigns','email_sends'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- policies, verbatim from pg_policy (name, command, roles, USING, WITH CHECK)
create policy "Users can view their own memberships" on public.org_members for select to public using (user_id = auth.uid());
create policy sequences_org_policy on public.sequences for all to authenticated
  using (org_id in (select user_org_ids() as user_org_ids)) with check (org_id in (select user_org_ids() as user_org_ids));
create policy email_campaigns_org_policy on public.email_campaigns for all to authenticated
  using (org_id in (select user_org_ids() as user_org_ids)) with check (org_id in (select user_org_ids() as user_org_ids));
create policy sequence_steps_via_seq on public.sequence_steps for all to public using (sequence_id in ( select sequences.id
   from sequences where (sequences.org_id in ( select sequences.org_id from org_members where (org_members.user_id = auth.uid()))))));
create policy sequence_enrollments_via_seq on public.sequence_enrollments for all to public using (sequence_id in ( select sequences.id
   from sequences where (sequences.org_id in ( select sequences.org_id from org_members where (org_members.user_id = auth.uid()))))));
create policy email_sends_via_campaign on public.email_sends for all to public using (campaign_id in ( select email_campaigns.id
   from email_campaigns where (email_campaigns.org_id in ( select email_campaigns.org_id from org_members where (org_members.user_id = auth.uid()))))));
-- profiles and team_profiles carry live policies that no expression under test reads (both helpers
-- are SECURITY DEFINER), so they are left closed here: RLS on, no policy.
