-- hub_227_podcast_hosts_email_allowed.sql
--
-- STATUS: APPLIED to production 2026-11-06 on Cameron's go. Production only (the Hub has no nonprod).
--
-- Hub band (200+). pf_NNN numbers are the platform's and are not a collision (ruling 2026-10-04).
--
-- PURPOSE: Cameron ruled on 2026-11-06 that all podcast hosts are email allowed. 20 hosts with the source
-- media_appearance have a valid email and no consent record, so each gets one grant. hub_225 left that
-- source out of its backfill. The Hub shows no pipeline or conversation for them, so the grant rests on
-- Cameron's ruling, and the evidence says so. The source is existing_relationship_2026_11 because
-- consent_events_check requires it, or import, or the text shown, for a grant. evidence.method tells these apart.
--
-- NOT COVERED: 6 others on the Podcast hosts and media list have no valid email: Lisa Boate, Michelle
-- Freedberg, Mindi Lobuzzetta, Nick Urban, Nate Selger and a contact named teset.
--
-- SKIPS anyone tagged a test record, flagged do-not-contact, unsubscribed, on the do-not-contact list,
-- suppressed, or already in the ledger. None of the 20 was when read on 2026-11-06. A skip fails the count.
--
-- EMAIL MARKETING ALLOWED, Neuro Progeny live contacts: 93 + 20 = 113.
--
-- SENDS NOTHING: gate_live_sends stays off and no campaign's live_enabled changes.
--
-- ROLLBACK:
--   begin;
--   alter table public.consent_events disable trigger consent_events_append_only;
--   delete from public.consent_events where source = 'existing_relationship_2026_11' and evidence ->> 'method' = 'ruling_hub_227';
--   alter table public.consent_events enable trigger consent_events_append_only;
--   delete from supabase_migrations.schema_migrations where name = 'hub_227_podcast_hosts_email_allowed';
--   commit;

begin;

do $$
declare
  v_n int;
begin
  insert into public.consent_events (org_id, contact_id, address, channel, kind, action, basis, source, evidence)
  select b.org_id, b.id, lower(btrim(b.email)), 'email', 'marketing', 'granted', 'existing_relationship',
         'existing_relationship_2026_11',
         jsonb_build_object('method', 'ruling_hub_227', 'contact_source', b.source,
           'note', 'All podcast hosts are email allowed (Cameron, 2026-11-06).')
    from public.contacts b
    join (values
      ('4856ac18-88c7-407a-8681-5dd1575f2c8b'::uuid),  -- Jeff Armstrong
      ('cb27f10f-a212-48f3-a584-fa479bf78f66'::uuid),  -- Debra Atkinson
      ('1c75d888-df40-432d-8a62-72eac64d8187'::uuid),  -- Matt Bennett
      ('0bc6c382-10aa-4311-ad4f-d301ff092dc5'::uuid),  -- Diane Carbo
      ('25935f20-3511-44e7-a7ee-da6a845a2f25'::uuid),  -- Takilla Combs
      ('43d4b16d-a01e-49f8-a329-b175aa36864c'::uuid),  -- Denise Eckert
      ('32ba10de-4f25-47c5-9e2c-cb6c7734fa5f'::uuid),  -- Dave Gosselin
      ('ca136977-bd76-40c5-b8c2-502be75a568a'::uuid),  -- Heather Gray
      ('781f804e-f692-41ec-8a35-26535044c588'::uuid),  -- Jane Hogan
      ('3415626e-5ba0-4801-b72d-b17e760937e1'::uuid),  -- Carla Loomis
      ('c2ee1221-e20f-453d-97bb-b521ae50aa7c'::uuid),  -- Anne Marie Constanzo
      ('7d437c80-5ca6-4fd6-8cd9-b285f58756d7'::uuid),  -- Al Pirnia
      ('6ca019a6-470e-412d-91be-e2485ac50bfb'::uuid),  -- Kelly Rae
      ('c15ace61-c725-490d-bf2a-0c89971ea6e1'::uuid),  -- Erick Rheam
      ('292e0058-51a6-4d62-accf-07f17a3771d3'::uuid),  -- Aakash Shah
      ('3ab93352-8437-4457-bba0-686bd38d1b98'::uuid),  -- Nate Sleger
      ('1f405baa-0620-4451-bc99-df8a114014fe'::uuid),  -- David Traster
      ('0978d76f-e9bb-4e5d-a5f4-0359d5d1d37d'::uuid),  -- Ryan Van Ornum
      ('9c10dba6-77e9-4e92-9dbe-4fe634196478'::uuid),  -- Brooke Wagner
      ('f76b6d91-3f2a-4488-a335-1988185a912e'::uuid)   -- Sarah Young
    ) v(id) on v.id = b.id
   where b.merged_into_id is null and b.archived_at is null
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
  -- Exactly 20 when read on 2026-11-06. Any other count means stop and look.
  if v_n <> 20 then
    raise exception 'hub_227: would write % rows, expected exactly 20', v_n;
  end if;
  raise notice 'hub_227: granted % podcast hosts', v_n;
end $$;

commit;
