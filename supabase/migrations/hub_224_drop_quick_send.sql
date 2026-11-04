-- hub_224_drop_quick_send.sql
--
-- STATUS: PROPOSED, NOT APPLIED. Waiting for Cameron's go. Production only
-- (htfrfaxlcuyawtlztxxm); the Hub has no nonprod.
--
-- Hub band (200+). Checked 2026-11-04: files stop at hub_223, no hub_224 or 224.
--
-- PURPOSE: remove Quick Send's database objects. Quick Send (PR #13) was dropped from
-- release #17 on 2026-11-04 (revert 458f8a7) and never reached main; the Resource Library
-- (hub_222) is the one way to email documents to a contact. hub_215 created these and
-- nothing reads them now.
--
-- WHAT IT REMOVES (read on 2026-11-04):
--   hub_quick_send_sends        0 rows
--   hub_quick_send_items        0 rows
--   hub_quick_send_categories   6 rows, the seeded defaults (Programs, Office Services,
--                               Supplements and Techniques, for Neuro Progeny and Sensorium)
--   their indexes and the three *_staff_read policies (dropped with the tables)
--   org_settings 'crm_quick_send', one row for Neuro Progeny
--     (1337d718-9e1a-454f-a973-cd4e23e5d696): from_name "Neuro Progeny",
--     from_email cameron@neuroprogeny.com. No secret in it.
--
-- NOT TOUCHED: media_assets and the media-library bucket (shared with the platform;
-- hub_215 never changed them), contact_timeline (0 'quick_send' rows), hub_215's ledger row
-- (it stays as the record that hub_215 ran). Checked: no foreign key from any other table,
-- no view, trigger or function depends on the three tables.
--
-- SAFETY: the first block refuses to run if anyone has used Quick Send since the read
-- above, so no send record or item is lost silently.
--
-- ROLLBACK: re-run the body of hub_215_quick_send.sql (it recreates the tables, policies,
-- grants and default categories), then:
--   insert into public.org_settings (id, org_id, setting_key, setting_value)
--   values ('1337d718-9e1a-454f-a973-cd4e23e5d696', '00000000-0000-0000-0000-000000000001',
--           'crm_quick_send', '{"from_name":"Neuro Progeny","from_email":"cameron@neuroprogeny.com"}');

begin;

do $$
begin
  if exists (select 1 from public.hub_quick_send_sends) or exists (select 1 from public.hub_quick_send_items) then
    raise exception 'hub_224: Quick Send has send records or items; stop and review before dropping';
  end if;
end $$;

drop table public.hub_quick_send_sends;
drop table public.hub_quick_send_items;
drop table public.hub_quick_send_categories;

delete from public.org_settings
 where id = '1337d718-9e1a-454f-a973-cd4e23e5d696'
   and setting_key = 'crm_quick_send';

commit;
