-- 2026-11-05_hub_hygiene.sql  (data fix, not a migration: no schema change)
--
-- STATUS: APPLIED to production 2026-11-06 on Cameron's go. Every count in the report matched. Do not re-run.
--
-- Rulings are in docs/plans/hub-data-hygiene-review.md. Scope: live Neuro Progeny contacts only
-- (not merged, not archived). Sensorium is untouched (P1 and P2 skipped).
--
-- BEFORE AND AFTER, recounted 2026-11-06 with the same numbers. Each item aborts the whole file if it would touch a different
-- number of contacts, and the last statement prints the same table from the live data.
--
--   Item  Change                                            Contacts  Before -> After
--   D2    copy phone from platform profile                         2  blank phone 2 -> 0
--   D3    link to the matching profile by exact email              2  unlinked 2 -> 0 (23 unmatched, see review doc)
--   P6    Hazel: tag test, clear pipeline. Test Test: clear        2  on a Sensorium pipeline 2 -> 0
--   TEST  tag the 11 test or house accounts                       11  current clients untagged 11 -> 0
--   T1    mastermind -> Mastermind                                 1  1 -> 0
--   T2    podcast, Podcast -> podcast_host                         3  3 -> 0 (podcast_host 27 -> 30)
--   T3    merge the 10 interest pairs                             90  old tag names 14 -> 0 (per pair in the report)
--   T4    delete comma-split fragments                            16  16 -> 0
--   T5    rank-N tag -> outreach_rank, delete tag                100  tag 100 -> 0, outreach_rank 0 -> 100
--   T6    URL tags: 2 moved to fields, 13 duplicates deleted       8  URL tags 26 -> 11 (11 kept, no field)
--   T7    US state or DC tag -> address_state, delete tag         35  35 -> 0 (no other two-letter tags exist)
--   T9    delete Instagram and LinkedIn tags                     100  100 -> 0
--   S1    blank source -> proposed value                          91  91 -> 0
--   S2    city -> address_city, source -> prospect_unknown        31  31 -> 0
--   S2b   SC, AZ: fix swapped city and state, same source          2  2 -> 0
--   S3    URL source -> instagram_, linkedin_ or web_research    109  109 -> 0
--   S4    Import, Other, Website, Podcast, Workshop to lowercase  16  16 -> 0
--   LIST  Clarity graduates: by stage, no Clarity purchase rule    1  members 0 -> 25
--
-- ORDER: apply this file first, then hub_226. hub_226 refuses to run until Hazel Thornton is tagged,
-- so she does not get a marketing consent row.
--
-- NOT CHANGED: T10 keeps quarantine:test-record. P1, P2, P7 and T8 were ruled out. The neuro@ and
-- sgranau+test4@ phones are not copied. D1 is handled by hub_226.
--
-- SENDS NOTHING. app.suppress_enrollment_trigger is set for this transaction, which both tag
-- triggers honour. That matters: adding the tag Mastermind (T1) would otherwise fire
-- handle_contact_tag_change, because stripe_product_tag_map marks it creates_participant, and that
-- could create a participant or change a profile's role.
--
-- SIDE EFFECTS, stated: trg_updated_at bumps contacts.updated_at on every changed row. Clearing the
-- two P6 pipelines writes one pipeline_changed timeline row each through trg_pipeline_timeline.
--
-- BEFORE-IMAGES: one contact_timeline row per changed contact, event_type 'data_hygiene', with the
-- previous values in metadata.before. This also keeps every original URL that S3 overwrites,
-- including the 12 sources holding several URLs. It shows on the contact's timeline.
--
-- ROLLBACK:
--   begin;
--   select set_config('app.suppress_enrollment_trigger', 'on', true);
--   update public.contacts c set
--     tags = array(select jsonb_array_elements_text(t.metadata->'before'->'tags')),
--     source = t.metadata->'before'->>'source', phone = t.metadata->'before'->>'phone',
--     address_city = t.metadata->'before'->>'address_city', address_state = t.metadata->'before'->>'address_state',
--     outreach_rank = (t.metadata->'before'->>'outreach_rank')::int, website_url = t.metadata->'before'->>'website_url',
--     twitter_handle = t.metadata->'before'->>'twitter_handle',
--     mastermind_user_id = (t.metadata->'before'->>'mastermind_user_id')::uuid,
--     pipeline_id = t.metadata->'before'->>'pipeline_id', pipeline_stage = t.metadata->'before'->>'pipeline_stage'
--   from public.contact_timeline t
--   where t.contact_id = c.id and t.source_table = 'data_fix:2026-11-05_hub_hygiene';
--   delete from public.contact_timeline where source_table = 'data_fix:2026-11-05_hub_hygiene';
--   update public.smart_lists set definition = '{"match":"all","rules":[{"op":"any","field":"purchase","value":["clarity-protocol","program:8414e3df-c030-414b-badf-f6ebdfbb4c98"]},{"op":"in","field":"stage","value":["Completed Course moving to nurture","Completed course Joined Alumni Membership "]},{"op":"none","field":"purchase","value":["capacity-protocol-p2-mv52xan3","program:a4f974c3-7b8f-49e1-bea0-46c0a63aa16f","program:c891d8b1-a2c3-4e10-9c8d-65949ae7be70","program:c184f807-b48f-44f8-9287-f099d93e16ec"]}]}'::jsonb
--    where org_id = '00000000-0000-0000-0000-000000000001' and seed_key = 'clarity_grads_no_capacity';
--   commit;

begin;
select set_config('app.suppress_enrollment_trigger', 'on', true);

create temp table hygiene_before on commit drop as
  select id, org_id, source, tags, phone, address_city, address_state, outreach_rank, website_url, twitter_handle, mastermind_user_id, pipeline_id, pipeline_stage
    from public.contacts
   where org_id = '00000000-0000-0000-0000-000000000001' and merged_into_id is null and archived_at is null;

create temp table hygiene_report (item text primary key, contacts int, expected int) on commit drop;

do $$
declare
  v_org constant uuid := '00000000-0000-0000-0000-000000000001';
  v_n int;
  r record;
  v_cities constant text[] := array['Denver','Chicago','Colorado Springs','Laguna Hills','Wellington','Rocklin','South Pasadena',
    'Los Angeles','Laguna Beach','Santa Barbara','Pittsburgh','Seattle','West Sacramento','Aventura','Virginia Beach','Scottsdale',
    'Stamford','Albany','Kirkland','Miami','Silver Spring','Duluth','Nashville','New York','Salt Lake City','Dallas','Culver City','Carmel','Dover'];
  v_states constant text[] := array['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
    'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA',
    'WA','WV','WI','WY','DC'];
begin
  -- D2: two phones from platform profiles, E.164, only where the contact has none
  update public.contacts c set phone = v.phone
    from (values
      ('47321419-2bf0-46e2-a89a-4bce6a5b5c86'::uuid, '+18283616183'),  -- Ted Adams
      ('ad0a94f9-743a-44d5-9b2a-ea6fe6a2fa77'::uuid, '+15619018965')   -- Sarah Leslie
    ) v(id, phone)
   where c.id = v.id and coalesce(c.phone, '') = '';
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('D2', v_n, 2);

  -- D3: only an exact email match counts. Neither profile has an enrollment or entitlement yet.
  update public.contacts c set mastermind_user_id = v.pid
    from (values
      ('beeef527-b3a4-4e6b-a49d-a2ff22e771d4'::uuid, 'a9d5fc1e-2601-45bc-8140-6182ad7e1397'::uuid),  -- Brian Lawrence, salukifire@yahoo.com
      ('9f24fa39-e132-4867-8ca8-4b7d18ba80a1'::uuid, '25a9afd8-bada-4090-acba-cba47f0485bd'::uuid)   -- Jeremy Dalidowitz, jmd2377@gmail.com, on a merged duplicate
    ) v(id, pid)
   where c.id = v.id and c.mastermind_user_id is null;
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('D3', v_n, 2);

  -- P6: Hazel Thornton is tagged and cleared, Test Test is cleared
  update public.contacts set tags = array_append(tags, 'quarantine:test-record'), pipeline_id = null, pipeline_stage = null
   where id = 'e734ad21-76fd-468c-8893-f3229dd1c6aa' and pipeline_id = 'pipeline-1771564632133'
     and not coalesce(tags, '{}') @> array['quarantine:test-record'];
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('P6 Hazel Thornton', v_n, 1);
  update public.contacts set pipeline_id = null, pipeline_stage = null
   where id = '6482fcaa-a12f-4fbd-ac8b-15e4c579e3d7' and pipeline_id = 'pipeline-1774977289414';
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('P6 Test Test', v_n, 1);

  -- TEST: the 11 test or house accounts among the 27 current clients
  update public.contacts set tags = array_append(tags, 'quarantine:test-record')
   where org_id = v_org and merged_into_id is null and not coalesce(tags, '{}') @> array['quarantine:test-record']
     and id in (
       'ab24b9ae-ff14-45e8-91f0-c3b9017f6d13',  -- test coach 2, cameron.s.allen+coach2@gmail.com
       'f71d4f89-3f5a-48fb-a798-088dee60d8ce',  -- xreg test, cameron.s.allen+xregtest1@gmail.com
       'a0ee9c98-d0bf-4491-b1a0-9f78c8554a75',  -- Multi org test, cameron.s.allen+test@gmail.com
       'c6fca4aa-ac70-4ab2-bd94-c149e65b9095',  -- Slack Test, cameron.s.allen+slacktest@gmail.com
       '13ec804b-ed8b-4e4b-bf94-970524bcee4d',  -- Ctest, cameron.s.allen+ctest@gmail.com
       'e4b4a223-b1af-4f63-9d4a-f3e84da22fdd',  -- TESTpay2, cameron.s.allen+paytest2@gmail.com
       'b9afb235-f231-4e83-a925-54f10c3ae690',  -- Test Free promo, cameron.s.allen+strand1@gmail.com
       'c9b33ed8-7f55-4dfb-9a60-1b1ea4c1f508',  -- new test, sgranau+test2@gmail.com
       'c7682711-3503-4d08-9181-4d87a2461fbf',  -- Shane test, sgranau+test@gmail.com
       '853a76c8-0331-4d86-8e19-06c518f83bf4',  -- Coaching Client Test, cameron.s.allen+coach1@gmail.com
       'f43430ea-8588-4ad8-8417-1ad1e2a47944'   -- Neuro Progeny, neuro@neuroprogeny.com (house account)
     );
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('TEST', v_n, 11);

  -- T1
  update public.contacts set tags = array_replace(tags, 'mastermind', 'Mastermind')
   where org_id = v_org and merged_into_id is null and archived_at is null and tags @> array['mastermind'];
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('T1', v_n, 1);

  -- T2: Christopher Times, Rachel Russell, Alexandria Viera
  update public.contacts set tags = array_replace(array_replace(tags, 'podcast', 'podcast_host'), 'Podcast', 'podcast_host')
   where org_id = v_org and merged_into_id is null and archived_at is null and tags && array['podcast','Podcast'];
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('T2', v_n, 3);

  -- T3: each pair becomes one tag. The lowercase tag `leadership` (5) is separate and stays.
  for r in select * from (values
      ('Leadership', 'Leadership / burnout', 'Leadership resilience and nervous-system regulation', 21),
      ('Nervous system regulation', 'Nervous system regulation', 'Somatic and nervous system coaching', 17),
      ('Sales performance', 'Sales performance', 'Sales performance under pressure', 11),
      ('Business performance', 'Business performance', 'Nervous-system-based business / executive performance', 14),
      ('Corporate wellness', 'Corporate wellness', 'Corporate wellness and workplace resilience', 9),
      ('ADHD', 'ADHD / regulation', 'ADHD and overwhelm support through regulation', 5),
      ('Breathwork', 'Breath / recovery', 'Breathwork', 5),
      ('HRV', 'HRV / performance', 'HRV', 4),
      ('Parenting', 'Parenting / regulation', 'Parenting and co-regulation support', 2),
      ('Vagus', 'Vagus / regulation', 'Vagus nerve and regulation education', 2)
    ) v(keep, a, b, expected)
  loop
    update public.contacts c set tags = array(
        select d.t from (
          select u.t, min(u.o) as o from unnest(array_replace(array_replace(c.tags, r.a, r.keep), r.b, r.keep)) with ordinality u(t, o) group by u.t
        ) d order by d.o)
     where c.org_id = v_org and c.merged_into_id is null and c.archived_at is null and c.tags && array[r.a, r.b];
    get diagnostics v_n = row_count;
    insert into hygiene_report values ('T3 ' || r.keep, v_n, r.expected);
  end loop;

  -- T4
  update public.contacts set tags = array_remove(array_remove(array_remove(tags, 'and emotional load'), 'and stress adaptation'), 'and performance recovery')
   where org_id = v_org and merged_into_id is null and archived_at is null
     and tags && array['and emotional load','and stress adaptation','and performance recovery'];
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('T4', v_n, 16);

  -- T5: outreach_rank is empty on every contact and no contact has two rank tags
  update public.contacts c set
      outreach_rank = (select substring(t from '^rank-([0-9]+)$')::int from unnest(c.tags) t where t ~ '^rank-[0-9]+$' limit 1),
      tags = array(select t from unnest(c.tags) with ordinality u(t, o) where t !~ '^rank-[0-9]+$' order by o)
   where c.org_id = v_org and c.merged_into_id is null and c.archived_at is null and c.outreach_rank is null
     and exists (select 1 from unnest(c.tags) t where t ~ '^rank-[0-9]+$');
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('T5', v_n, 100);

  -- T6: two values move into blank fields
  update public.contacts set website_url = 'https://theplayzone.com/play-zone-pros'
   where id = 'd055d0a7-33fc-4db1-9d8c-2c46718798bb' and coalesce(website_url, '') = '';  -- Jeb Stuart Johnston
  update public.contacts set twitter_handle = 'russellbrunson'
   where id = 'acf46e18-a56e-46cb-8361-4744bfa64b64' and coalesce(twitter_handle, '') = '';  -- Russell Brunson
  -- T6: those two, and the 13 that only repeat a field the contact already has, come off the tags.
  -- The other 11 stay as tags because no existing field can hold them (see the review doc).
  update public.contacts c set tags = array(select t from unnest(c.tags) with ordinality u(t, o) where t <> all (v.drop_tags) order by o)
    from (values
      ('acf46e18-a56e-46cb-8361-4744bfa64b64'::uuid, array['https://x.com/russellbrunson/status/1266408836732092416','https://www.russellbrunson.com/']),
      ('d055d0a7-33fc-4db1-9d8c-2c46718798bb'::uuid, array['https://theplayzone.com/play-zone-pros']),
      ('0c7f88db-2301-4874-b7f7-3222bdc5f877'::uuid, array['https://echelonfront.com/instructors/jocko-willink/']),
      ('91cb98a1-87ba-4101-883b-eee02e404b79'::uuid, array['https://www.deangraziosi.com/','https://www.linkedin.com/in/deangraziosiinc']),
      ('f7a6b7c9-84e9-486b-b5a3-aed941d0ac80'::uuid, array['https://www.simonlovell.com/','https://www.linkedin.com/in/simonlovell']),
      ('af19c5ca-6d72-4bec-88c7-534ff776a8ab'::uuid, array['https://timgrover.com/','https://www.linkedin.com/in/tim-grover-2636671']),
      ('af48996f-febb-48b6-8508-f852efc1f3b9'::uuid, array['https://www.marieforleo.com/','https://www.instagram.com/marieforleo/']),
      ('229e7f3d-27ed-4b12-bbbd-04fecac8c251'::uuid, array['https://www.ryanmunsey.com/','https://www.linkedin.com/in/ryan-munsey','https://www.instagram.com/ryanmunsey_/'])
    ) v(id, drop_tags)
   where c.id = v.id and c.tags && v.drop_tags;
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('T6', v_n, 8);

  -- T7: the 50 US state codes and DC only; any other two-letter tag stays a tag. Read 2026-11-06: all 35
  -- are state codes, no contact has two, and address_state is blank on all 35.
  update public.contacts c set
      address_state = (select t from unnest(c.tags) t where t = any (v_states) limit 1),
      tags = array(select t from unnest(c.tags) with ordinality u(t, o) where t <> all (v_states) order by o)
   where c.org_id = v_org and c.merged_into_id is null and c.archived_at is null and coalesce(c.address_state, '') = ''
     and c.tags && v_states;
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('T7', v_n, 35);

  -- T9: the source already says this (S3). The 3 "ChatGPT curated public research" contacts keep that source.
  update public.contacts set tags = array_remove(array_remove(tags, 'Instagram'), 'LinkedIn')
   where org_id = v_org and merged_into_id is null and archived_at is null and tags && array['Instagram','LinkedIn'];
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('T9', v_n, 100);

  -- S1
  update public.contacts set source = case pipeline_id
      when 'pipeline-1771530511407' then 'unknown_enrolled'
      when 'pipeline-1784838066772' then 'partner_outreach'
      when 'pipeline-1779900078615' then 'outreach_2026_06'
      when 'pipeline-1790143608575' then 'wnw_local'
      when 'default'                then 'unknown_sales'
      when 'pipeline-1772718032193' then 'podcast'
      when 'pipeline-1773338473992' then 'referral'
      else 'unknown' end
   where org_id = v_org and merged_into_id is null and archived_at is null and coalesce(source, '') = '';
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('S1', v_n, 91);

  -- S2
  update public.contacts set address_city = source, source = 'prospect_unknown'
   where org_id = v_org and merged_into_id is null and archived_at is null and source = any (v_cities) and coalesce(address_city, '') = '';
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('S2', v_n, 31);

  -- S2b: source holds the state and address_state holds the city, so both move
  update public.contacts set address_city = address_state, address_state = source, source = 'prospect_unknown'
   where org_id = v_org and merged_into_id is null and archived_at is null and source in ('SC','AZ')
     and address_state in ('Charleston','Scottsdale') and coalesce(address_city, '') = '';
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('S2b', v_n, 2);

  -- S3: every Instagram and LinkedIn contact already has that field filled, and the 4 others have a website
  update public.contacts set source = case
      when source ~* 'instagram\.com' then 'instagram_research'
      when source ~* 'linkedin\.com'  then 'linkedin_research'
      else 'web_research' end
   where org_id = v_org and merged_into_id is null and archived_at is null and source ~* '^https?:';
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('S3', v_n, 109);

  -- S4: admin, manual-chat and manual_ecr are already lowercase and already in the vocabulary, so they stay
  update public.contacts set source = lower(source)
   where org_id = v_org and merged_into_id is null and archived_at is null and source in ('Import','Other','Website','Podcast','Workshop');
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('S4', v_n, 16);

  -- LIST: by stage, so the earlier xRegulation alumni show. The Clarity purchase rule goes; the
  -- Capacity exclusion stays because the list's name promises it, and no alumnus has bought Capacity.
  update public.smart_lists set definition = '{"match":"all","rules":[{"field":"stage","op":"in","value":["Completed Course moving to nurture","Completed course Joined Alumni Membership "]},{"field":"purchase","op":"none","value":["capacity-protocol-p2-mv52xan3","program:a4f974c3-7b8f-49e1-bea0-46c0a63aa16f","program:c891d8b1-a2c3-4e10-9c8d-65949ae7be70","program:c184f807-b48f-44f8-9287-f099d93e16ec"]}]}'::jsonb,
      updated_at = now()
   where org_id = v_org and seed_key = 'clarity_grads_no_capacity';
  get diagnostics v_n = row_count;
  insert into hygiene_report values ('LIST', v_n, 1);

  if exists (select 1 from hygiene_report where contacts <> expected) then
    raise exception 'hygiene: a count differs from what was reviewed: %',
      (select string_agg(item || ' got ' || contacts || ' expected ' || expected, '; ') from hygiene_report where contacts <> expected);
  end if;

  insert into public.contact_timeline (org_id, contact_id, event_type, title, metadata, source_table, occurred_at)
  select b.org_id, b.id, 'data_hygiene', 'Data clean-up, November 2026',
         jsonb_build_object('before', to_jsonb(b) - 'id' - 'org_id'), 'data_fix:2026-11-05_hub_hygiene', now()
    from hygiene_before b join public.contacts c on c.id = b.id
   where (b.source, b.tags, b.phone, b.address_city, b.address_state, b.outreach_rank, b.website_url, b.twitter_handle, b.mastermind_user_id, b.pipeline_id, b.pipeline_stage)
         is distinct from (c.source, c.tags, c.phone, c.address_city, c.address_state, c.outreach_rank, c.website_url, c.twitter_handle, c.mastermind_user_id, c.pipeline_id, c.pipeline_stage);
end $$;

select * from hygiene_report order by item;
commit;
