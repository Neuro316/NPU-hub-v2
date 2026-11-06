-- 2026-11-06_podcast_host_followups.sql  (data fix, not a migration: no schema change)
--
-- STATUS: APPLIED to production 2026-11-06 on Cameron's go, merge included. Every count in the report matched; allowed read 115. Do not re-run.
--
-- Scope: live Neuro Progeny contacts only. Each item aborts the whole file if it would touch a different
-- number of rows, and the last statement prints the report.
--
--   Item    Change                                                      Expected
--   EMAIL   add an address where the contact's email is blank                  4
--   GRANT   marketing email grant, Mindi Lobuzzetta and Nick Urban             2
--   MERGE   Nate Selger into Nate Sleger                                       1
--   REPOINT rows moved by merge_contact_repoint                                2
--   TEST    tag teset quarantine:test-record                                   1
--   ALLOWED change in email marketing allowed                                 +2
--
-- EMAIL MARKETING ALLOWED, Neuro Progeny live contacts: 113 + 2 = 115.
-- Lisa Boate gets no grant until Cameron confirms the address is theirs. Michelle Freedberg gets no grant:
-- info@beforeboca.com is a shared business inbox, kept for normal correspondence only.
--
-- MERGE BASIS: both records have a blank phone and company, and no email thread names Selger. The match is
-- the podcast. The Selger row was created 0.26 seconds after the Begin Within Health Show appearance was
-- saved, the same gap as the other hosts saved that session, and Sleger was created 42 seconds later.
-- linkHostContact creates a contact when a host name is saved or changed, so this reads as a corrected typo.
--
-- THE MERGE follows POST /api/contacts/merge step by step: snapshot, guard, merge_contact_repoint,
-- most-restrictive consent, merge_union_tags, merged_into_id, release the guard. Two differences:
--   1. It also keeps the loser's contact_interaction_score row in the snapshot, because the repoint deletes it.
--   2. It writes no contact_merged event. The route's logActivity insert names columns activity_log does not
--      have, so that event has never been written. contact_merge_log is the record.
--
-- SENDS NOTHING: gate_live_sends stays off and no campaign's live_enabled changes.
--
-- ROLLBACK:
--   begin;
--   alter table public.consent_events disable trigger consent_events_append_only;
--   delete from public.consent_events where source = 'existing_relationship_2026_11' and evidence ->> 'method' = 'ruling_2026_11_06_podcast_followups';
--   alter table public.consent_events enable trigger consent_events_append_only;
--   update public.contacts set email = null where id in (select contact_id from public.contact_timeline
--     where source_table = 'data_fix:2026-11-06_podcast_host_followups' and event_type = 'data_hygiene' and metadata ? 'added_email');
--   update public.contacts set tags = array_remove(tags, 'quarantine:test-record') where id = 'e0014a34-7144-40e1-a470-d514df686c75';
--   delete from public.contact_timeline where source_table = 'data_fix:2026-11-06_podcast_host_followups';
--   update public.contacts set merged_into_id = null where id = '07ca77a6-eecf-48fa-be4e-283904c6c11a';
--   insert into public.contact_interaction_score
--     select (jsonb_populate_record(null::public.contact_interaction_score, m.merge_details -> 'loser_interaction_score')).*
--       from public.contact_merge_log m
--      where m.loser_id = '07ca77a6-eecf-48fa-be4e-283904c6c11a' and m.merge_details -> 'loser_interaction_score' <> 'null'::jsonb;
--   delete from public.contact_merge_log where loser_id = '07ca77a6-eecf-48fa-be4e-283904c6c11a';
--   commit;

begin;
select set_config('app.suppress_enrollment_trigger', 'on', true);

create temp table followup_report (item text primary key, contacts int, expected int) on commit drop;

do $$
declare
  v_org     constant uuid := '00000000-0000-0000-0000-000000000001';
  v_mindi   constant uuid := '7e58cf59-2c56-4f95-9d12-703772ec6da0';
  v_nick    constant uuid := 'b31f17ec-7136-47b0-8ca6-bf2beaa479f8';
  v_lisa    constant uuid := '9a341fd9-86c6-4886-9f89-44802fd73126';
  v_michelle constant uuid := 'c230b5d9-2476-4b2c-848f-fd4cdb25abe0';
  v_winner  constant uuid := '3ab93352-8437-4457-bba0-686bd38d1b98';  -- Nate Sleger
  v_loser   constant uuid := '07ca77a6-eecf-48fa-be4e-283904c6c11a';  -- Nate Selger
  v_teset   constant uuid := 'e0014a34-7144-40e1-a470-d514df686c75';
  v_actor   constant uuid := '22456608-5f7d-495e-af02-7037fea125cc';  -- Cameron, as on earlier merges
  v_source  constant text := 'data_fix:2026-11-06_podcast_host_followups';
  w public.contacts%rowtype;
  l public.contacts%rowtype;
  v_resolved jsonb;
  v_repoint jsonb;
  v_before int;
  v_after int;
  v_n int;
begin
  select count(*) into v_before from public.contacts c
   where c.org_id = v_org and c.merged_into_id is null and c.archived_at is null
     and public.hub_email_marketing_allowed(c.id);

  -- EMAIL: only where blank, and only where no other contact already holds the address
  with upd as (
    update public.contacts c set email = v.email
      from (values
        (v_mindi,    'mindilobuzzettalmhc@mllmhc.com'),
        (v_nick,     'nick@outliyr.com'),
        (v_lisa,     'lboatewellness@gmail.com'),
        (v_michelle, 'info@beforeboca.com')
      ) v(id, email)
     where c.id = v.id and c.org_id = v_org and c.merged_into_id is null and c.archived_at is null
       and nullif(btrim(c.email), '') is null
       and not exists (select 1 from public.contacts o where o.org_id = v_org and o.id <> c.id and lower(btrim(o.email)) = v.email)
    returning c.id, c.org_id, c.email)
  insert into public.contact_timeline (org_id, contact_id, event_type, title, metadata, source_table, occurred_at)
  select u.org_id, u.id, 'data_hygiene', 'Email added from correspondence',
         jsonb_build_object('added_email', u.email), v_source, now()
    from upd u;
  get diagnostics v_n = row_count;
  insert into followup_report values ('EMAIL', v_n, 4);

  -- GRANT: same basis, source, evidence shape and skips as hub_227, for Mindi and Nick only
  insert into public.consent_events (org_id, contact_id, address, channel, kind, action, basis, source, evidence)
  select b.org_id, b.id, lower(btrim(b.email)), 'email', 'marketing', 'granted', 'existing_relationship',
         'existing_relationship_2026_11',
         jsonb_build_object('method', 'ruling_2026_11_06_podcast_followups', 'contact_source', b.source,
           'address_source', 'direct correspondence in Gmail',
           'note', 'All podcast hosts are email allowed (Cameron, 2026-11-06). Address confirmed by their own emails.')
    from public.contacts b
   where b.id in (v_mindi, v_nick)
     and b.merged_into_id is null and b.archived_at is null
     and lower(btrim(b.email)) ~ '^[^@\s:]+@[^@\s]+\.[a-z]{2,}$'
     and not coalesce(b.tags, '{}') @> array['quarantine:test-record']
     and not public.hub_contact_has_real_dnc(b.id)
     and b.email_unsubscribed_at is null
     and not exists (select 1 from public.do_not_contact_list d where d.org_id = b.org_id and lower(btrim(d.email)) = lower(btrim(b.email)))
     and not exists (select 1 from public.suppressions s where s.org_id = b.org_id and s.channel = 'email' and s.address = lower(btrim(b.email)))
     and not exists (select 1 from public.consent_events e where e.channel = 'email' and e.kind = 'marketing'
                      and (e.contact_id in (select public.hub_contact_family(b.id))
                           or (e.org_id = b.org_id and e.address = lower(btrim(b.email)))));
  get diagnostics v_n = row_count;
  insert into followup_report values ('GRANT', v_n, 2);

  -- MERGE: Selger into Sleger, in the route's order
  select * into w from public.contacts where id = v_winner for update;
  select * into l from public.contacts where id = v_loser for update;
  if w.id is null or l.id is null then raise exception 'followups: a Nate record is missing'; end if;
  if w.org_id <> v_org or l.org_id <> v_org then raise exception 'followups: a Nate record is in another org'; end if;
  if w.merged_into_id is not null or l.merged_into_id is not null then raise exception 'followups: a Nate record is already merged'; end if;
  if nullif(btrim(l.email), '') is not null or nullif(btrim(l.phone), '') is not null then
    raise exception 'followups: Selger now holds an email or phone, stop and look';
  end if;

  v_resolved := jsonb_build_object(
    'email_consent', coalesce(w.email_consent, false) and coalesce(l.email_consent, false),
    'sms_consent', coalesce(w.sms_consent, false) and coalesce(l.sms_consent, false),
    'terms_accepted', coalesce(w.terms_accepted, false) or coalesce(l.terms_accepted, false),
    'email_consent_at', coalesce(w.email_consent_at, l.email_consent_at),
    'sms_consent_at', coalesce(w.sms_consent_at, l.sms_consent_at),
    'terms_accepted_at', coalesce(w.terms_accepted_at, l.terms_accepted_at),
    'email_unsubscribed_at', coalesce(w.email_unsubscribed_at, l.email_unsubscribed_at));

  insert into public.contact_merge_log (org_id, winner_id, loser_id, merged_by, merge_details)
  values (v_org, v_winner, v_loser,
    (select t.id from public.team_members t where t.user_id = v_actor and t.org_id = v_org limit 1),
    jsonb_build_object(
      'reason', 'Cameron ruling 2026-11-06: Selger is a typo of Sleger, matched on the Begin Within Health Show appearance',
      'merged_by_user_id', v_actor,
      'loser_snapshot', to_jsonb(l),
      'winner_snapshot_before', to_jsonb(w),
      'loser_interaction_score', (select to_jsonb(s) from public.contact_interaction_score s where s.contact_id = v_loser),
      'consent_resolution', jsonb_build_object(
        'rule', 'most_restrictive_wins', 'applied_at', now(),
        'note', 'Per-channel booleans AND-ed; terms_accepted OR-ed; evidence timestamps coalesced, winner first.',
        'resolved', v_resolved, 'rejected_caller_fields', '{}'::jsonb)));

  perform public.guard_entry_events(v_org, array[v_winner, v_loser], 'contact_merge', 10);

  v_repoint := public.merge_contact_repoint(v_loser, v_winner);
  insert into followup_report values ('REPOINT', (v_repoint ->> 'total')::int, 2);

  update public.contacts set
    email_consent = coalesce(w.email_consent, false) and coalesce(l.email_consent, false),
    sms_consent = coalesce(w.sms_consent, false) and coalesce(l.sms_consent, false),
    terms_accepted = coalesce(w.terms_accepted, false) or coalesce(l.terms_accepted, false),
    email_consent_at = coalesce(w.email_consent_at, l.email_consent_at),
    sms_consent_at = coalesce(w.sms_consent_at, l.sms_consent_at),
    terms_accepted_at = coalesce(w.terms_accepted_at, l.terms_accepted_at),
    email_unsubscribed_at = coalesce(w.email_unsubscribed_at, l.email_unsubscribed_at)
   where id = v_winner;

  perform public.merge_union_tags(v_winner,
    array(select distinct t from unnest(coalesce(w.tags, '{}') || coalesce(l.tags, '{}')) as t order by t));

  update public.contacts set merged_into_id = v_winner where id = v_loser and merged_into_id is null;
  get diagnostics v_n = row_count;
  insert into followup_report values ('MERGE', v_n, 1);

  -- clock_timestamp, because ends_at must be later than starts_at and now() is fixed for the transaction
  update public.entry_event_guards set ends_at = clock_timestamp()
   where contact_id in (v_winner, v_loser) and reason = 'contact_merge' and ends_at > now();

  -- TEST
  with upd as (
    update public.contacts set tags = array_append(tags, 'quarantine:test-record')
     where id = v_teset and org_id = v_org and merged_into_id is null
       and not coalesce(tags, '{}') @> array['quarantine:test-record']
    returning id, org_id)
  insert into public.contact_timeline (org_id, contact_id, event_type, title, metadata, source_table, occurred_at)
  select u.org_id, u.id, 'data_hygiene', 'Tagged as a test record',
         jsonb_build_object('added_tag', 'quarantine:test-record'), v_source, now()
    from upd u;
  get diagnostics v_n = row_count;
  insert into followup_report values ('TEST', v_n, 1);

  -- ALLOWED: measured in this transaction, so a signup elsewhere cannot fail it
  select count(*) into v_after from public.contacts c
   where c.org_id = v_org and c.merged_into_id is null and c.archived_at is null
     and public.hub_email_marketing_allowed(c.id);
  insert into followup_report values ('ALLOWED change', v_after - v_before, 2);

  if not public.hub_email_marketing_allowed(v_mindi) or not public.hub_email_marketing_allowed(v_nick) then
    raise exception 'followups: Mindi or Nick does not read as allowed';
  end if;
  if public.hub_email_marketing_allowed(v_lisa) or public.hub_email_marketing_allowed(v_michelle) then
    raise exception 'followups: Lisa or Michelle reads as allowed';
  end if;
  if not public.hub_email_marketing_allowed(v_winner) then
    raise exception 'followups: Nate Sleger lost their grant in the merge';
  end if;

  if exists (select 1 from followup_report where contacts <> expected) then
    raise exception 'followups: a count differs from what was reviewed: %',
      (select string_agg(item || ' got ' || contacts || ' expected ' || expected, '; ') from followup_report where contacts <> expected);
  end if;
end $$;

select * from followup_report order by item;
commit;
