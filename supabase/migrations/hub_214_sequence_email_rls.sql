-- hub_214_sequence_email_rls.sql
-- STATUS: DRAFT, NOT APPLIED. Branch-tested on hub-rls-214. Apply to production only on Cameron's go.
--
-- What it fixes (read-only investigation and branch matrix, 2026-10-02):
--   sequence_enrollments_via_seq, sequence_steps_via_seq and email_sends_via_campaign are TO PUBLIC,
--   FOR ALL, with no WITH CHECK, and their innermost subquery selects the OUTER table's column
--   (SELECT sequences.org_id FROM org_members ...), so it only asks "is the caller in any org".
--   sequences_org_policy and email_campaigns_org_policy are scoped by org but through user_org_ids(),
--   which admits every org member, University participants included (10 of the 21 live members),
--   so the message content in email_campaigns and the steps' parents were open to participants.
--
-- What it does: every policy on the five tables becomes per command, TO authenticated, scoped to the
-- orgs where the caller has an ACTIVE team_profiles row (public.hub_team_org_ids(), ruled 2026-10-02).
--   SELECT and DELETE carry USING; INSERT carries WITH CHECK; UPDATE carries both. Postgres accepts no
--   other clauses on those commands, so every clause each command can have is stated explicitly.
-- Child rows are scoped through their PARENT's org by two SECURITY DEFINER lookups, not through a
-- subquery on the parent: a subquery would inherit the parent table's own policy (borrowed
-- protection), and 2 of the 10 live staff team rows have no org_members row.
-- Grants are unchanged: authenticated keeps SELECT, INSERT, UPDATE, DELETE; anon has none.
--
-- Known and NOT changed here (reported separately): hub_team_org_ids() checks status only, not role,
-- while withStaff also requires role in (super_admin, admin, team_member). Today there are 0 active
-- team rows with any other role.

-- ── ROLLBACK (written first; the pre-images are copied from pg_catalog on 2026-10-02) ──
-- begin;
-- drop policy if exists sequences_select on public.sequences;
-- drop policy if exists sequences_insert on public.sequences;
-- drop policy if exists sequences_update on public.sequences;
-- drop policy if exists sequences_delete on public.sequences;
-- drop policy if exists sequence_steps_select on public.sequence_steps;
-- drop policy if exists sequence_steps_insert on public.sequence_steps;
-- drop policy if exists sequence_steps_update on public.sequence_steps;
-- drop policy if exists sequence_steps_delete on public.sequence_steps;
-- drop policy if exists sequence_enrollments_select on public.sequence_enrollments;
-- drop policy if exists sequence_enrollments_insert on public.sequence_enrollments;
-- drop policy if exists sequence_enrollments_update on public.sequence_enrollments;
-- drop policy if exists sequence_enrollments_delete on public.sequence_enrollments;
-- drop policy if exists email_campaigns_select on public.email_campaigns;
-- drop policy if exists email_campaigns_insert on public.email_campaigns;
-- drop policy if exists email_campaigns_update on public.email_campaigns;
-- drop policy if exists email_campaigns_delete on public.email_campaigns;
-- drop policy if exists email_sends_select on public.email_sends;
-- drop policy if exists email_sends_insert on public.email_sends;
-- drop policy if exists email_sends_update on public.email_sends;
-- drop policy if exists email_sends_delete on public.email_sends;
-- create policy sequences_org_policy on public.sequences as permissive for all to authenticated
--   using (org_id in (select user_org_ids() as user_org_ids)) with check (org_id in (select user_org_ids() as user_org_ids));
-- create policy email_campaigns_org_policy on public.email_campaigns as permissive for all to authenticated
--   using (org_id in (select user_org_ids() as user_org_ids)) with check (org_id in (select user_org_ids() as user_org_ids));
-- create policy sequence_steps_via_seq on public.sequence_steps as permissive for all to public
--   using (sequence_id in ( select sequences.id from sequences where (sequences.org_id in ( select sequences.org_id from org_members where (org_members.user_id = auth.uid())))));
-- create policy sequence_enrollments_via_seq on public.sequence_enrollments as permissive for all to public
--   using (sequence_id in ( select sequences.id from sequences where (sequences.org_id in ( select sequences.org_id from org_members where (org_members.user_id = auth.uid())))));
-- create policy email_sends_via_campaign on public.email_sends as permissive for all to public
--   using (campaign_id in ( select email_campaigns.id from email_campaigns where (email_campaigns.org_id in ( select email_campaigns.org_id from org_members where (org_members.user_id = auth.uid())))));
-- drop function if exists public.hub_sequence_org(uuid);
-- drop function if exists public.hub_email_campaign_org(uuid);
-- commit;

begin;

-- the parent-org lookups: SECURITY DEFINER so no caller's RLS on the parent decides the answer
create function public.hub_sequence_org(p_sequence_id uuid) returns uuid
  language sql stable security definer set search_path = ''
  as $$ select s.org_id from public.sequences s where s.id = p_sequence_id $$;
create function public.hub_email_campaign_org(p_campaign_id uuid) returns uuid
  language sql stable security definer set search_path = ''
  as $$ select c.org_id from public.email_campaigns c where c.id = p_campaign_id $$;
revoke execute on function public.hub_sequence_org(uuid) from public;
revoke execute on function public.hub_email_campaign_org(uuid) from public;
grant execute on function public.hub_sequence_org(uuid) to authenticated;
grant execute on function public.hub_email_campaign_org(uuid) to authenticated;

drop policy sequences_org_policy on public.sequences;
drop policy email_campaigns_org_policy on public.email_campaigns;
drop policy sequence_steps_via_seq on public.sequence_steps;
drop policy sequence_enrollments_via_seq on public.sequence_enrollments;
drop policy email_sends_via_campaign on public.email_sends;

-- sequences: its own org
create policy sequences_select on public.sequences for select to authenticated
  using (org_id in (select public.hub_team_org_ids()));
create policy sequences_insert on public.sequences for insert to authenticated
  with check (org_id in (select public.hub_team_org_ids()));
create policy sequences_update on public.sequences for update to authenticated
  using (org_id in (select public.hub_team_org_ids())) with check (org_id in (select public.hub_team_org_ids()));
create policy sequences_delete on public.sequences for delete to authenticated
  using (org_id in (select public.hub_team_org_ids()));

-- sequence_steps: the parent sequence's org
create policy sequence_steps_select on public.sequence_steps for select to authenticated
  using (public.hub_sequence_org(sequence_id) in (select public.hub_team_org_ids()));
create policy sequence_steps_insert on public.sequence_steps for insert to authenticated
  with check (public.hub_sequence_org(sequence_id) in (select public.hub_team_org_ids()));
create policy sequence_steps_update on public.sequence_steps for update to authenticated
  using (public.hub_sequence_org(sequence_id) in (select public.hub_team_org_ids()))
  with check (public.hub_sequence_org(sequence_id) in (select public.hub_team_org_ids()));
create policy sequence_steps_delete on public.sequence_steps for delete to authenticated
  using (public.hub_sequence_org(sequence_id) in (select public.hub_team_org_ids()));

-- sequence_enrollments: the parent sequence's org
create policy sequence_enrollments_select on public.sequence_enrollments for select to authenticated
  using (public.hub_sequence_org(sequence_id) in (select public.hub_team_org_ids()));
create policy sequence_enrollments_insert on public.sequence_enrollments for insert to authenticated
  with check (public.hub_sequence_org(sequence_id) in (select public.hub_team_org_ids()));
create policy sequence_enrollments_update on public.sequence_enrollments for update to authenticated
  using (public.hub_sequence_org(sequence_id) in (select public.hub_team_org_ids()))
  with check (public.hub_sequence_org(sequence_id) in (select public.hub_team_org_ids()));
create policy sequence_enrollments_delete on public.sequence_enrollments for delete to authenticated
  using (public.hub_sequence_org(sequence_id) in (select public.hub_team_org_ids()));

-- email_campaigns (where the message content lives): its own org
create policy email_campaigns_select on public.email_campaigns for select to authenticated
  using (org_id in (select public.hub_team_org_ids()));
create policy email_campaigns_insert on public.email_campaigns for insert to authenticated
  with check (org_id in (select public.hub_team_org_ids()));
create policy email_campaigns_update on public.email_campaigns for update to authenticated
  using (org_id in (select public.hub_team_org_ids())) with check (org_id in (select public.hub_team_org_ids()));
create policy email_campaigns_delete on public.email_campaigns for delete to authenticated
  using (org_id in (select public.hub_team_org_ids()));

-- email_sends: the parent campaign's org
create policy email_sends_select on public.email_sends for select to authenticated
  using (public.hub_email_campaign_org(campaign_id) in (select public.hub_team_org_ids()));
create policy email_sends_insert on public.email_sends for insert to authenticated
  with check (public.hub_email_campaign_org(campaign_id) in (select public.hub_team_org_ids()));
create policy email_sends_update on public.email_sends for update to authenticated
  using (public.hub_email_campaign_org(campaign_id) in (select public.hub_team_org_ids()))
  with check (public.hub_email_campaign_org(campaign_id) in (select public.hub_team_org_ids()));
create policy email_sends_delete on public.email_sends for delete to authenticated
  using (public.hub_email_campaign_org(campaign_id) in (select public.hub_team_org_ids()));

commit;
