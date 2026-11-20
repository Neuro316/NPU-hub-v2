-- supabase/data/2026-11-20_queued_texts_status.sql
--
-- STATUS: PROPOSED 2026-11-20. NOT RUN. A one-time data fix for the go of the Hub chat, production
-- (htfrfaxlcuyawtlztxxm) only (nonprod has no such rows). No schema change, nothing else touched.
--
-- WHY (Running List q43): 26 outbound texts sit at status 'queued'. All 26 have a Twilio sid, so Twilio accepted them.
--   - 3 carry a carrier error code (30034 twice, 30007 once). An error code arrives only with the FINAL undelivered
--     callback, which maps to 'failed'; a later, out-of-order "sending"/"accepted" callback then set them back to
--     'queued'. They failed. This is the bug fix/text-status-forward-only closes.
--   - 23 carry no error code: 10 were sent before the status callback route reached main (2026-08-02 17:49 UTC) and
--     never had a callback; 13 were sent after it and were most likely regressed from 'sent' or 'delivered' by the same
--     late callback. The Hub cannot tell which. The check constraint has no 'unknown' status.
--
-- RECOMMENDATION:
--   PART 1, run it: the 3 with an error code go to 'failed'.
--   PART 2, Option A (recommended): the 23 STAY 'queued'. Marking them failed would claim a failure nobody observed,
--     and most of their neighbours were delivered. 'queued' honestly means "Twilio accepted it, outcome unknown", and
--     the one touch rule (q41) already counts an accepted text. If the true outcome matters, look the 23 sids up in
--     the Twilio console (read-only) and set each to what Twilio reports.
--   PART 2, Option B (not recommended): set the 23 to 'failed' too. Only if Cameron rules that an unconfirmed text
--     counts as not delivered.
-- Each part lists its row ids, so it touches exactly these rows and nothing that changes in the meantime: every
-- update also requires the row to still be outbound and 'queued'.
--
-- READ-BACK (before and after):
--   select status, (error_code is not null) as has_code, count(*) from public.crm_messages
--    where direction = 'outbound' and status in ('queued', 'failed') group by 1, 2 order by 1, 2;
--   -- before: queued/false 23, queued/true 3; after PART 1: queued/false 23, failed/true +3
--
-- ROLLBACK (PART 1; and PART 2 Option B if it was run): put exactly the same ids back to 'queued'.
--   begin;
--   update public.crm_messages set status = 'queued'
--    where id in ('661523d5-ef35-42f4-8630-4091f7062a0a', 'f34fcbfa-d5d9-4e13-993c-9dd5371c390b', '8b8c7ba3-8bf2-4292-923e-68e63ad0e8e4')
--      and direction = 'outbound' and status = 'failed';
--   -- Option B only:
--   -- update public.crm_messages set status = 'queued' where id in (<the 23 ids below>) and direction = 'outbound' and status = 'failed';
--   commit;

-- ── PART 1: the 3 texts with a carrier error code -> failed ────────────────────────────────────────────────────
begin;
update public.crm_messages set status = 'failed'
 where id in ('661523d5-ef35-42f4-8630-4091f7062a0a', 'f34fcbfa-d5d9-4e13-993c-9dd5371c390b', '8b8c7ba3-8bf2-4292-923e-68e63ad0e8e4')
   and direction = 'outbound' and status = 'queued' and error_code is not null;
-- expect: UPDATE 3
commit;

-- ── PART 2, Option A (recommended): no statement. The 23 stay 'queued'. ─────────────────────────────────────────

-- ── PART 2, Option B (not recommended; only on a ruling): the 23 without an error code -> failed ──────────────────
-- begin;
-- update public.crm_messages set status = 'failed'
--  where id in ('fbc841f0-365e-4d61-b41c-12ae72d920ee', '6d60f94e-41f8-44cb-b5fc-26a9c56ec973', '188a6149-1163-4981-8f38-3e40f1a387fc',
--               '47b28c50-2820-4286-b206-70992ea087ec', '6c096ffe-deac-4590-bd78-4a1607390ab1', 'e4da0237-df4d-440e-9e17-edd68b084a61',
--               '0dbb1819-117c-439f-b739-76afeb63d011', '7350b654-ddc3-4cea-848b-5f804e489fd9', '6ca3dff3-82d3-4856-ab5e-f58ae5555d25',
--               'f866c503-f09b-45bd-afd3-f4864652d7db', 'a6c90090-1137-4357-94c3-771fc07becd4', '02ae0f50-60e4-4c52-86f3-e05eafbc5f47',
--               'e3f7e5e7-81cd-41f0-9650-6c32408fa31b', 'b106f9d4-c52f-461b-95fd-1d0dc44392cc', 'ecc3e1c7-c2fe-42a2-ab0d-185b6f79243f',
--               'e9384481-fbfb-4058-a8cc-78bd4e20e94c', '682949aa-8b32-4134-a01c-b54e213f876a', '0ac3e1cb-32b3-4cbc-9097-65e489d9e8d3',
--               'a6275c4a-36d7-47b8-b403-c2db96286a49', '1f7cea0f-e38a-4903-aab4-b8a85397ab7f', '7d6fa108-338b-44f9-9c02-ac103a02098e',
--               '4121655a-5ca6-45fd-81bf-117c58d89b04', 'b4eac53f-21ec-48ff-846f-92d2a58311f4')
--    and direction = 'outbound' and status = 'queued' and error_code is null;
-- -- expect: UPDATE 23
-- commit;
