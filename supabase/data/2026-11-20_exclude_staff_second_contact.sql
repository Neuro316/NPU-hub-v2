-- supabase/data/2026-11-20_exclude_staff_second_contact.sql
--
-- STATUS: PROPOSED 2026-11-20. NOT RUN. For a go of the Hub chat, production (htfrfaxlcuyawtlztxxm) only.
--
-- WHY: fix/touchpoint-staff-rule-narrow counts a platform admin as staff only when they own or administer the Hub's
-- own org. Shane's second address (contact 565c274f-d459-479e-abcc-9749ea8955f9) belongs to a profile that is an admin
-- of a DIFFERENT org (his own), not of Neuro Progeny, and it has no team_profiles row. So under the narrowed rule it is
-- no longer staff, and its inbound_no_reply card would come back on the next run.
-- This keeps that one contact out by the shared test filter's exclusion list (hub_metric_exclusions, kind 'contact'),
-- which the touchpoint monitor already honours, and which also keeps it out of the Growth Dashboard (right for a staff
-- member's own address). Nothing else changes.
--
-- READ-BACK:
--   select kind, decision, contact_id, reason from public.hub_metric_exclusions
--    where contact_id = '565c274f-d459-479e-abcc-9749ea8955f9';                       -- one row, exclude
--
-- ROLLBACK:
--   begin;
--   delete from public.hub_metric_exclusions
--    where kind = 'contact' and contact_id = '565c274f-d459-479e-abcc-9749ea8955f9' and reason like 'q35 staff second address%';
--   commit;

begin;
insert into public.hub_metric_exclusions (kind, decision, contact_id, reason)
select 'contact', 'exclude', '565c274f-d459-479e-abcc-9749ea8955f9', 'q35 staff second address (Shane), not a lead or a client'
 where not exists (select 1 from public.hub_metric_exclusions where kind = 'contact' and contact_id = '565c274f-d459-479e-abcc-9749ea8955f9');
-- expect: INSERT 0 1
commit;
