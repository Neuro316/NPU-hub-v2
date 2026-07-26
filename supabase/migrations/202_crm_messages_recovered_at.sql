-- 202_crm_messages_recovered_at.sql
-- STATUS: APPLIED 2026-07-26 via apply_migration, registered in schema_migrations
-- as 202_crm_messages_recovered_at. Verified after apply: column is
-- timestamptz, nullable, NO default, comment present, 0 of 11 rows populated.
--
-- WHY
-- The 2026-07-24 incident lost every inbound SMS to +18289009821, which pointed at
-- demo.twilio.com instead of the Hub webhook. The approved recovery plan backfills
-- those messages into their real conversation threads with their ORIGINAL
-- timestamps, marked as recovered rather than newly received.
--
-- WHY NOT msg_type='sms_recovered', WHICH WAS THE FIRST PLAN
-- It cannot be applied. crm_messages carries:
--     crm_messages_msg_type_check  CHECK (msg_type = ANY (ARRAY['sms','mms']))
-- so every recovered row would fail with 23514. Widening that CHECK was the
-- alternative and was rejected: msg_type describes WHAT A MESSAGE IS, and a
-- recovered SMS is still an SMS. Overloading it would make the column mean two
-- unrelated things and would silently break any future reader that assumes the
-- two-value domain.
--
-- recovered_at records WHEN THE ROW WAS RECONSTRUCTED, which is the fact we
-- actually need, and leaves msg_type semantically true. NULL means "arrived
-- normally", which is correct for every existing row without touching one of them.
--
-- SAFETY ON THE SHARED DATABASE (htfrfaxlcuyawtlztxxm)
--   * ADDITIVE and NULLABLE with no default -> no table rewrite, no lock beyond a
--     brief ACCESS EXCLUSIVE for the catalog update, no backfill of existing rows.
--   * NO existing row changes. NO constraint changes. NO policy changes.
--   * Column-level grants are INHERITED from the table; migration 030 governs new
--     TABLES, not new columns, so no grant statement is needed or wanted here.
--   * RLS is untouched. crm_messages is governed by the platform-owned policy
--     crm_messages_org_via_conversation (platform migration 067e), which scopes
--     through conversations and is column-agnostic.
--
-- CROSS-REPO READ SURFACE (verified read-only 2026-07-26)
--   * neuroreport-app  : ZERO references to crm_messages, anywhere.
--   * npu-platform-v2  : ZERO references in src/. Every hit is in docs/ or in
--                        supabase/migrations/ (061, 067c, 067e) and concerns RLS
--                        policy only. The platform manages the POLICY on this
--                        table but reads no columns from it.
--   Therefore no application code in either other repo can be affected by an
--   added nullable column.
--
-- NUMBERING
-- 200 and 201 are reserved for consent_events and message_sends by the build
-- notes in HUB_Bulk_Campaigns_Design.md sections 4.2.1 and 4.3.1, already
-- committed. This P0 remediation jumps ahead of them in TIME but keeps their
-- numbers free, so this takes 202. Application order need not match numeric
-- order: schema_migrations keys on the timestamp version, per section 13.1.

alter table public.crm_messages
  add column if not exists recovered_at timestamptz;

comment on column public.crm_messages.recovered_at is
  'Set when this row was reconstructed from an external source rather than received live. '
  'NULL = arrived normally through the webhook or send path. Non-null = backfilled, and the '
  'value is when the recovery ran (sent_at keeps the message''s original time). '
  'First use: recovering inbound SMS lost while +18289009821 pointed at demo.twilio.com, '
  '2026-07-24.';

-- VERIFY (run after apply; both must hold)
--   select count(*) from crm_messages where recovered_at is not null;   -- expect 0
--   select a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull
--     from pg_class c
--     join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
--     join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
--    where c.relname='crm_messages' and a.attname='recovered_at';
--   -- expect: recovered_at | timestamp with time zone | f
