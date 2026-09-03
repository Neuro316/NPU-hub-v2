-- 206_repair_accounting_crm_links.sql
--
-- OUTPUT ONLY — NOT APPLIED. Review before running in the Supabase SQL Editor.
--
-- Repairs the data damage left by the accounting CRM-enrol defects fixed in
-- /api/accounting/clients and /api/accounting/payments. Three separate faults,
-- three separate statements, each independently revertible.
--
-- Scope: Neuro Progeny clinic clients only (acct_clinics.is_neuro_progeny).
-- Nothing here touches Sensorium accounting rows or any other org's contacts.
--
-- RE-MEASURED 2026-09-03, AFTER the fix was deployed (970ca13) and confirmed
-- working by the operator. Counts are from live data at commit time, not from
-- the earlier investigation — the routes have been in use and rows have moved:
-- NP clients went 18 -> 15 as the operator deleted the duplicate and test rows.
--
--   NP accounting clients ................................. 15   (was 18)
--   with at least one payment ............................. 13   (was 12)
--   stage-move failures provable from data ................  0   <- see note A
--   enrol orphans, contact exists but link is null ........  2   (S1) unchanged
--   dangling links, contact no longer exists ..............  2   (S2) unchanged
--   contacts written to an off-pipeline stage .............  1   (S3) unchanged
--   failed adds with no contact at all ....................  1   <- NOT repaired
--                                                                  (was 4)
-- All four repair targets are unchanged. Re-verified individually:
--   Adam Hill        still unlinked, exactly 1 non-merged NP name match
--   Dylan Constance  still unlinked, exactly 1 non-merged NP name match
--   Mary-Lynn Manley still dangling, 0 name matches
--   Elizabeth Nelson still dangling, 0 name matches
--   Dyann Meyers     still the only contact on stage 'Paid'
--
-- NOTE A — the stage-move count is 0, not the larger number I predicted.
-- 11 NP clients with payments sit at a stage other than the paid stage, but 9 of
-- them are at DEMONSTRABLY LATER stages ('Started course', 'Completed Course
-- moving to nurture', 'Equipment is shipped…'), which is legitimate forward
-- progress and must not be rewound. The other 2 are the dangling links in S2.
-- The silent stage-move defect was real and is fixed in code, but it left no
-- repairable damage: the clients it would have advanced were advanced by hand.

begin;

-- ── S1. Enrol orphans — relink, do not create ───────────────────────────────
-- The contact was created but `page.tsx:1651` wrote enrolled_contact_id with no
-- .select() and no row check, so a zero-row UPDATE returned success and the link
-- was lost. Both contacts still exist and each matches exactly ONE non-merged NP
-- contact by full name (verified: 1 and 1, not 0 and not 2).
--
--   Adam Hill        acct client 1274e0de… -> contact 5cec6f56…  (stage: Started course)
--   Dylan Constance  acct client f8ce6c3d… -> contact 6c3f7e36…  (stage: Signed up)
--
-- Stages are left exactly as they are. This restores the link only.
update public.acct_clients c
set enrolled_contact_id = ct.id::text
from public.contacts ct
where c.enrolled_contact_id is null
  and ct.org_id = '00000000-0000-0000-0000-000000000001'
  and ct.merged_into_id is null
  and lower(ct.first_name || ' ' || ct.last_name) = lower(c.name)
  and c.name in ('Adam Hill', 'Dylan Constance')
  and exists (
    select 1 from public.acct_locations l
    join public.acct_clinics cl on cl.id = l.clinic_id and cl.is_neuro_progeny is true
    where l.id = c.location_id
  );
-- Expect exactly 2 rows.

-- ── S2. Dangling links — null them ──────────────────────────────────────────
-- acct_clients.enrolled_contact_id is TEXT with NO foreign key to contacts.id
-- (uuid), so nothing stopped these from outliving the row they point at. Both
-- targets are gone from `contacts` entirely — not merged away, absent — and
-- neither name matches any surviving NP contact (verified: 0 and 0), so there is
-- nothing to relink them to.
--
--   Mary-Lynn Manley  -> 83ad17f8-bff7-41ac-bf25-271b18d30338  (absent)
--   Elizabeth Nelson  -> c06e2771-d8fa-47fa-b801-a030feec4e80  (absent)
--
-- Nulling is the honest state: the app currently believes these two are enrolled
-- and will not re-enrol them. After this they read as un-enrolled, which is true.
-- It does NOT create contacts for them — whether they should be re-enrolled is a
-- judgement about live clients, not a repair.
update public.acct_clients c
set enrolled_contact_id = null
where c.enrolled_contact_id is not null
  and not exists (
    select 1 from public.contacts ct where ct.id = c.enrolled_contact_id::uuid
  )
  and exists (
    select 1 from public.acct_locations l
    join public.acct_clinics cl on cl.id = l.clinic_id and cl.is_neuro_progeny is true
    where l.id = c.location_id
  );
-- Expect exactly 2 rows.

-- ── S3. Off-pipeline stage value ────────────────────────────────────────────
-- NP_STAGE_PAID was the string 'Paid'. That is NOT a stage in
-- pipeline-1771530511407 — its 8 stages are, in order:
--   1 Signed up - add user email used to sign up in Circle; …
--   2 Paid/ payment plan          <- the real one
--   3 Equipment is shipped or Picked up …
--   4 Onboarding Email Sent
--   5 RSVP'd for Kickoff call
--   6 Started course
--   7 Completed Course moving to nurture
--   8 Completed course Joined Alumni Membership
-- So every successful move-to-paid wrote a stage that renders in no column. It
-- succeeded exactly once, on the last day this path worked at all.
--
--   Dyann Meyers  73790e4d…  created 2026-07-28, stage 'Paid'
--
-- Guarded on the exact literal so it cannot touch 'Paid/ payment plan'.
update public.contacts
set pipeline_stage = 'Paid/ payment plan'
where org_id = '00000000-0000-0000-0000-000000000001'
  and pipeline_id = 'pipeline-1771530511407'
  and pipeline_stage = 'Paid';
-- Expect exactly 1 row.

commit;

-- ─── VERIFICATION — run AFTER, all four must hold ───────────────────────────
--
-- V1 — no NP accounting client points at a contact that does not exist:
--   select count(*) from acct_clients c
--   join acct_locations l on l.id = c.location_id
--   join acct_clinics cl on cl.id = l.clinic_id and cl.is_neuro_progeny is true
--   where c.enrolled_contact_id is not null
--     and not exists (select 1 from contacts ct where ct.id = c.enrolled_contact_id::uuid);
--   EXPECT 0  (was 2)
--
-- V2 — Adam Hill and Dylan Constance are linked:
--   select name, enrolled_contact_id from acct_clients
--   where name in ('Adam Hill','Dylan Constance');
--   EXPECT both non-null
--
-- V3 — no contact left on the off-pipeline stage:
--   select count(*) from contacts
--   where org_id='00000000-0000-0000-0000-000000000001' and pipeline_stage='Paid';
--   EXPECT 0  (was 1)
--
-- V4 — nothing was rewound. These 9 must still be at their later stages:
--   select ct.pipeline_stage, count(*) from acct_clients c
--   join acct_locations l on l.id=c.location_id
--   join acct_clinics cl on cl.id=l.clinic_id and cl.is_neuro_progeny is true
--   join contacts ct on ct.id=c.enrolled_contact_id::uuid
--   group by 1 order by 2 desc;
--   EXPECT, 12 rows total (simulated against live data before writing this):
--          'Started course' 7
--          'Completed Course moving to nurture' 1
--          'Completed course Joined Alumni Membership ' 1
--          'Equipment is shipped or Picked up - trigger auto email with tracking ' 1
--          'Paid/ payment plan' 1
--          'Signed up' 1
--
-- ─── DELIBERATELY NOT REPAIRED ──────────────────────────────────────────────
--
-- ONE acct_clients row from 2026-09-03 has no contact and no name match. It is
-- one of the adds that actually threw the reported error. It needs a person,
-- not SQL:
--
--   Megan Pomphrey   created 2026-09-03, no contact, 0 name matches
--
-- The other three in this group are already gone: the operator deleted the
-- duplicate 'Megan Pomphrey' (a retry 27 minutes after the error), the
-- incomplete 'Megan' and the test row 'jhtf' — which is what was recommended.
--
-- Creating a CRM contact for the survivor from SQL would guess at a live
-- client's identity. Recommend the operator re-save it in the UI, which now
-- works and enrols through /api/accounting/clients.
--
-- ─── FILED, NOT BUILT ───────────────────────────────────────────────────────
--
-- 1. `acct_clinics.crm_org_id uuid references organizations(id)`.
--    The enrol target is currently derived from `is_neuro_progeny` mapped to a
--    server-side constant. It cannot be read from the clinic row, because all
--    three clinics carry Sensorium in `acct_clinics.org_id` — including the
--    Neuro Progeny one — so that column names the OWNING org, never the target.
--    A real column would remove the constant. Not bundled with a fix.
--
-- 2. `acct_clients.enrolled_contact_id` is TEXT with no FK to contacts(id).
--    That is what allowed S2's dangling rows. Typing it as uuid with a nullable
--    FK (on delete set null) would make S2 impossible to recur. Requires
--    validating every existing value casts cleanly first.
