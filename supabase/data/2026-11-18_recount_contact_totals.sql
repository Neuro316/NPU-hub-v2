-- 2026-11-18_recount_contact_totals.sql  (data fix, Running List q34)
--
-- STATUS: PROPOSED 2026-11-18. NOT RUN. Needs a go. Nonprod first, then production (htfrfaxlcuyawtlztxxm),
-- like a migration, by the Hub chat. Apply it only AFTER the q34 code (PR fix/q34-followups) is deployed to
-- production: until then the app routes keep adding a second count and the totals drift again.
--
-- WHY: contacts' call and text totals were added twice per touch, once by the database triggers and once by app
-- routes (voice/token, sms/send, twilio/inbound-sms, and call-status for talk time). q34 leaves the triggers as the
-- one writer. Read only on production, 18 Nov: stored totals 153 calls, 485 texts, 541 s of talk time against
-- 87 call_logs rows, 381 crm_messages rows in a contact's conversation and 407 s in call_logs; 25 contacts differ.
--
-- WHAT IT DOES: sets, for every contact whose stored value differs, the totals the triggers would have produced
-- from the real rows, counted exactly as the triggers count:
--   total_calls, total_inbound_calls, total_outbound_calls   call_logs where contact_id = the contact (by direction)
--   total_call_duration_seconds                               sum(call_logs.duration_seconds) for the contact
--   total_texts, total_inbound_texts, total_outbound_texts   crm_messages in a conversation whose contact_id is the
--                                                             contact (by message direction). As the trigger does,
--                                                             this includes the 18 messages filed under voice
--                                                             conversations on 18 Nov (all msg_type 'sms')
-- NOT TOUCHED: total_emails. There is no email trigger on production; the only writer is the email composer, which
--   was never doubled, and email_sends is empty while every total_emails is 0. Also not touched: last_call_at,
--   last_text_at, last_contacted_at.
--
-- SIDE EFFECTS: each changed contact's updated_at moves (trg_updated_at). The other contacts triggers ignore a
--   change to these columns. call_logs and crm_messages are locked against inserts for the moment the update
--   takes, so a call or text arriving mid-run cannot be lost between the count and the write.
--
-- THE SAVED COPY: hub_backup.contact_totals_20261118, in a schema the Data API does not expose, with no grants to
--   anon or authenticated. It is the only DDL here and exists for the rollback. Drop it once the read-back is
--   accepted (last line of the rollback section).
--
-- IDEMPOTENT: a second run saves no new copy (the copy is taken once) and updates no row (every row already
--   matches).

begin;

lock table public.call_logs, public.crm_messages in share mode;

create schema if not exists hub_backup;
revoke all on schema hub_backup from public, anon, authenticated;

create table if not exists hub_backup.contact_totals_20261118 as
select id, total_calls, total_inbound_calls, total_outbound_calls, total_call_duration_seconds,
       total_texts, total_inbound_texts, total_outbound_texts, now() as saved_at
from public.contacts;
revoke all on hub_backup.contact_totals_20261118 from public, anon, authenticated;

with calls as (
  select contact_id,
         count(*) as n,
         count(*) filter (where direction = 'inbound') as n_in,
         count(*) filter (where direction = 'outbound') as n_out,
         coalesce(sum(coalesce(duration_seconds, 0)), 0) as secs
  from public.call_logs where contact_id is not null group by contact_id
), texts as (
  select v.contact_id,
         count(*) as n,
         count(*) filter (where m.direction = 'inbound') as n_in,
         count(*) filter (where m.direction = 'outbound') as n_out
  from public.crm_messages m join public.conversations v on v.id = m.conversation_id
  where v.contact_id is not null group by v.contact_id
), want as (
  select c.id,
         coalesce(k.n, 0)::int as total_calls, coalesce(k.n_in, 0)::int as total_inbound_calls,
         coalesce(k.n_out, 0)::int as total_outbound_calls, coalesce(k.secs, 0)::int as total_call_duration_seconds,
         coalesce(t.n, 0)::int as total_texts, coalesce(t.n_in, 0)::int as total_inbound_texts,
         coalesce(t.n_out, 0)::int as total_outbound_texts
  from public.contacts c left join calls k on k.contact_id = c.id left join texts t on t.contact_id = c.id
)
update public.contacts c set
  total_calls = w.total_calls, total_inbound_calls = w.total_inbound_calls, total_outbound_calls = w.total_outbound_calls,
  total_call_duration_seconds = w.total_call_duration_seconds,
  total_texts = w.total_texts, total_inbound_texts = w.total_inbound_texts, total_outbound_texts = w.total_outbound_texts
from want w
where w.id = c.id
  and (coalesce(c.total_calls, 0), coalesce(c.total_inbound_calls, 0), coalesce(c.total_outbound_calls, 0),
       coalesce(c.total_call_duration_seconds, 0), coalesce(c.total_texts, 0), coalesce(c.total_inbound_texts, 0),
       coalesce(c.total_outbound_texts, 0))
      is distinct from
      (w.total_calls, w.total_inbound_calls, w.total_outbound_calls, w.total_call_duration_seconds,
       w.total_texts, w.total_inbound_texts, w.total_outbound_texts);

commit;

-- READ-BACK (expect: mismatched 0; calls 87, texts 381 and seconds 407 on production, or the counts at apply time;
-- changed equals the number of contacts the update reported; backup_rows equals the contacts count):
--
-- select
--   (select count(*) from public.contacts c
--     where coalesce(c.total_calls, 0) <> (select count(*) from public.call_logs l where l.contact_id = c.id)
--        or coalesce(c.total_texts, 0) <> (select count(*) from public.crm_messages m
--                                           join public.conversations v on v.id = m.conversation_id where v.contact_id = c.id)
--        or coalesce(c.total_call_duration_seconds, 0) <> (select coalesce(sum(coalesce(l.duration_seconds, 0)), 0)
--                                                           from public.call_logs l where l.contact_id = c.id)) as mismatched,
--   (select sum(total_calls) from public.contacts) as calls,
--   (select sum(total_texts) from public.contacts) as texts,
--   (select sum(total_call_duration_seconds) from public.contacts) as seconds,
--   (select count(*) from public.contacts c join hub_backup.contact_totals_20261118 b on b.id = c.id
--     where (c.total_calls, c.total_texts, c.total_call_duration_seconds)
--           is distinct from (b.total_calls, b.total_texts, b.total_call_duration_seconds)) as changed,
--   (select count(*) from hub_backup.contact_totals_20261118) as backup_rows,
--   (select count(*) from public.contacts) as contacts;
--
-- ROLLBACK (restores every saved value; contacts created after the copy are not in it and keep theirs):
--
-- begin;
-- update public.contacts c set
--   total_calls = b.total_calls, total_inbound_calls = b.total_inbound_calls, total_outbound_calls = b.total_outbound_calls,
--   total_call_duration_seconds = b.total_call_duration_seconds,
--   total_texts = b.total_texts, total_inbound_texts = b.total_inbound_texts, total_outbound_texts = b.total_outbound_texts
-- from hub_backup.contact_totals_20261118 b
-- where b.id = c.id
--   and (c.total_calls, c.total_inbound_calls, c.total_outbound_calls, c.total_call_duration_seconds,
--        c.total_texts, c.total_inbound_texts, c.total_outbound_texts)
--       is distinct from
--       (b.total_calls, b.total_inbound_calls, b.total_outbound_calls, b.total_call_duration_seconds,
--        b.total_texts, b.total_inbound_texts, b.total_outbound_texts);
-- commit;
--
-- AFTER THE READ-BACK IS ACCEPTED (removes the saved copy; no rollback after this):
-- drop table hub_backup.contact_totals_20261118; drop schema hub_backup;
