-- hub_248_text_waiting_kind.sql
--
-- STATUS: PROPOSED 2026-11-23. NOT APPLIED. Needs a go. Applied by the Hub chat: nonprod (cpasntagxhxitavivwlb)
-- first, then production (htfrfaxlcuyawtlztxxm), then NOTIFY pgrst and a read-back.
-- Hub band. hub_247 (priority feedback) is the last; this is 248.
--
-- PURPOSE: the unanswered text alert (rules set by Cameron on 2026-11-23; src/lib/touchpoints/text-alerts.ts) keeps
--   its state in hub_touchpoint_situations as kind 'text_waiting_1h': one row per thread waiting an hour or more on a
--   reply, so a post can say New (first time listed) or Still waiting, and the row clears when someone replies. The
--   only change is the kind check, which hub_245 wrote as a fixed list. No new table, column or index:
--     situation_key  '<contact>:text_waiting_1h:<first unanswered inbound id>', unique per org as before
--     one open row per contact and kind (the existing partial unique index) is what the alert needs: one thread per person
--     detail         message_id, conversation_id, line name, received_at, alerted_at. Ids, a line name and times only:
--                    never the message text, a name or a phone number.
--   Until this is applied the alert writes nothing and posts nothing (it reports hub_248_pending); the q35 cards,
--   the 24-hour text_no_reply card included, are unchanged.
--
-- READ-BACK:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'hub_touchpoint_situations_kind_check';
--     -- lists six kinds, text_waiting_1h last
--   select count(*) from public.hub_touchpoint_situations where kind = 'text_waiting_1h';   -- 0
--
-- ROLLBACK (removes the alert's rows first, since the old check would reject them):
--   begin;
--   delete from public.hub_touchpoint_situations where kind = 'text_waiting_1h';
--   alter table public.hub_touchpoint_situations drop constraint hub_touchpoint_situations_kind_check;
--   alter table public.hub_touchpoint_situations add constraint hub_touchpoint_situations_kind_check
--     check (kind in ('booking_link_not_booked', 'inbound_no_reply', 'text_no_reply', 'coursework_quiet', 'discovery_no_followup'));
--   delete from supabase_migrations.schema_migrations where name = 'hub_248_text_waiting_kind';
--   commit;
--   (contact_timeline entries text_waiting_alert stay; they hold a line name and minutes only.)

begin;

alter table public.hub_touchpoint_situations drop constraint hub_touchpoint_situations_kind_check;
alter table public.hub_touchpoint_situations add constraint hub_touchpoint_situations_kind_check
  check (kind in ('booking_link_not_booked', 'inbound_no_reply', 'text_no_reply', 'coursework_quiet', 'discovery_no_followup', 'text_waiting_1h'));

comment on table public.hub_touchpoint_situations is
  'q35 touchpoint monitor: one row per waiting-on-us situation, and (text_waiting_1h) per text thread listed in the unanswered text alert. Ids and times only. Staff of the org read; service role writes.';

commit;
