-- 078_repair_buyertest1_stray_repoint.sql  (APPLIED 2026-07-23)
-- Undo the two rows the FAILED Cameron/buyertest1 merges repointed.
--
-- Two merge attempts (07-23 00:17, 00:18) ran merge_contact_repoint, moving every
-- buyertest1-owned row onto Cameron's real contact, then died on the lifecycle
-- label bug before flagging the loser. The pair was never meant to be merged --
-- buyertest1 is a Stripe test buyer, a different entity.
--
-- Provenance for each row moved back:
--   np_client_records 537502dc : xreg_email = cameron.s.allen+buyertest1@gmail.com
--   contact_timeline  081386fa : occurred_at 17:49:45.991 == buyertest1.updated_at
--                                to the millisecond; records the "-> Paid/ payment
--                                plan" transition the Mastermind checkout wrote
--                                for THAT contact.
-- Everything else on 4cb236f6 stays: the cameron.s.allen@gmail.com rows belong
-- there via migration 072, a deliberate completed merge.

update np_client_records set contact_id = '5921c286-8dbd-4e53-b253-642bb6061c39'
 where id = '537502dc-e21e-40ff-b5d5-ae19999ca0c3'
   and contact_id = '4cb236f6-30c8-4d24-a91a-9db786425cee';

update contact_timeline set contact_id = '5921c286-8dbd-4e53-b253-642bb6061c39'
 where id = '081386fa-b1a5-4e20-aebe-848c11690dad'
   and contact_id = '4cb236f6-30c8-4d24-a91a-9db786425cee';

insert into contact_merge_log (org_id, winner_id, loser_id, merged_by, merge_details)
values ('00000000-0000-0000-0000-000000000001',
        '5921c286-8dbd-4e53-b253-642bb6061c39','5921c286-8dbd-4e53-b253-642bb6061c39', null,
        jsonb_build_object(
          'reason','REPAIR: returned rows stranded on 4cb236f6 by two failed merge attempts. Not a merge.',
          'applied_by','migration 078',
          'rows_returned', jsonb_build_array(
            jsonb_build_object('table','np_client_records','id','537502dc-e21e-40ff-b5d5-ae19999ca0c3'),
            jsonb_build_object('table','contact_timeline','id','081386fa-b1a5-4e20-aebe-848c11690dad')),
          'note','Cameron/buyertest1 are DIFFERENT ENTITIES and must be dismissed, never merged.'));

-- Verification: expect 0
--   select count(*) from np_client_records
--    where contact_id='4cb236f6-30c8-4d24-a91a-9db786425cee'
--      and xreg_email='cameron.s.allen+buyertest1@gmail.com';
