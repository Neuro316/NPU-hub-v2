-- hub_226_merge_flag_is_not_an_opt_out.sql
--
-- STATUS: APPLIED to production 2026-11-06 on Cameron's go. Production only (the Hub has no nonprod).
-- RESULT: 12 revokes, 19 backfill grants, 93 email marketing allowed. The figures below are the projection:
-- the 19th grant is Dyann Myers, a Stripe buyer whose contact was created that morning, after the projection. Cameron ruled they keep it.
-- ORDER: apply supabase/data-fixes/2026-11-05_hub_hygiene.sql first. The first block refuses otherwise.
--
-- Hub band (200+). Checked 2026-11-06: Hub files and ledger stop at hub_225. pf_226 is the platform's
-- and is not a collision (ruling 2026-10-04).
--
-- PURPOSE, four parts:
--
-- 1. THE MERGE FLAG. POST /api/contacts/merge and migrations 072, 076 and 079 set do_not_contact = true
--    on every merged duplicate. hub_225 read that flag as a real opt-out across a contact's family, which
--    blocked 26 live contacts and left their emails out of the backfill. The route stops setting it in
--    the same branch as this file; merged_into_id is the marker, and the gate resolves a merged contact
--    to its survivor. The 36 existing flags stay as they are, as the historical record.
--    THE RULE: a merged duplicate's flag counts only when its merge snapshot shows the flag was already
--    set before the merge. A flagged duplicate with no snapshot at all also counts, because an opt-out
--    that can't be disproved is kept. No such row exists today. A contact's own flag always counts.
--    Erica Thiessen stays blocked under this rule: her snapshot shows the flag set.
--
-- 2. TEST RECORDS. A contact tagged quarantine:test-record is not marketable and gate_check denies it
--    with reason test_record, on every channel and kind, unless its email or phone is on
--    campaign_test_contacts. Read 2026-11-06: 16 live tagged contacts after the data fix, none on the
--    allowlist. 11 of them hold a hub_225 consent row and read as allowed today.
--
-- 3. COLD OUTREACH CORRECTION. hub_225 backfilled 12 cold prospects in Coaches and Therapist, whose source
--    was a city name, under existing_relationship, which Cameron ruled out for cold outreach. Each gets
--    one revoke row. consent_events is append-only, so the grant stays and the later revoke wins in
--    consent_state. Anyone with an express opt-in is skipped; none of the 12 has one today. The 11 June
--    2026 NP Outreach contacts reached a Discovery Call stage, so they keep their hub_225 grant.
--
-- 4. BACKFILL. hub_225's eligibility with that DNC test changed, and these sources also excluded:
--    prospect_unknown, outreach_2026_06 and any *_research source. Same basis, same source, Neuro Progeny
--    only, the earlier exclusions kept, and no existing ledger record overridden. 18 contacts when
--    projected on 2026-11-06 after the data fix. The new exclusions remove none of the 18. The
--    outreach_2026_06 exclusion changes nothing today: only the 11 June contacts will hold that source,
--    and they already hold a grant, so the existing-record test leaves them out either way.
--
-- EMAIL MARKETING ALLOWED, Neuro Progeny live contacts: 97 today - 12 cold - 11 test + 18 restored = 92.
--
-- SENDS NOTHING: gate_live_sends stays off and no campaign's live_enabled changes.
--
-- ROLLBACK (in this order):
--   begin;
--   alter table public.consent_events disable trigger consent_events_append_only;
--   delete from public.consent_events where source = 'existing_relationship_2026_11' and evidence ->> 'method' = 'backfill_hub_226';
--   delete from public.consent_events where source = 'existing_relationship_2026_11_withdrawn' and evidence ->> 'method' = 'correction_hub_226';
--   alter table public.consent_events enable trigger consent_events_append_only;
--   -- restore gate_check, hub_email_marketing_allowed and hub_texting_allowed from hub_225's text, as create or replace
--   drop function public.hub_contact_is_blocked_test_record(uuid);
--   drop function public.hub_contact_has_real_dnc(uuid);
--   delete from supabase_migrations.schema_migrations where name = 'hub_226_merge_flag_is_not_an_opt_out';
--   commit;

begin;

do $$
begin
  if not exists (select 1 from public.contacts where id = 'e734ad21-76fd-468c-8893-f3229dd1c6aa'
                  and tags @> array['quarantine:test-record']) then
    raise exception 'hub_226: apply the 2026-11-05 hygiene data fix first';
  end if;
end $$;

-- True when this contact, or a merged duplicate that opted out before its merge, is do-not-contact.
create function public.hub_contact_has_real_dnc(p_contact uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with fam as (select public.hub_resolve_contact(p_contact) as survivor)
  select exists (
    select 1 from public.contacts c, fam
     where c.do_not_contact
       and c.id in (select public.hub_contact_family(fam.survivor))
       and (c.id = fam.survivor
            or exists (select 1 from public.contact_merge_log m where m.loser_id = c.id
                        and m.merge_details -> 'loser_snapshot' ->> 'do_not_contact' = 'true')
            or not exists (select 1 from public.contact_merge_log m where m.loser_id = c.id
                            and m.merge_details ? 'loser_snapshot')))
$$;
revoke execute on function public.hub_contact_has_real_dnc(uuid) from public, anon, authenticated;
grant execute on function public.hub_contact_has_real_dnc(uuid) to service_role;

-- True when the surviving contact is tagged a test record and neither its email nor its phone is on the
-- test allowlist. Phones compare on the last 10 digits, the way gate_check compares them.
create function public.hub_contact_is_blocked_test_record(p_contact uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with s as (
    select x.org_id, x.tags, nullif(lower(btrim(x.email)), '') as email,
           nullif(right(regexp_replace(coalesce(x.phone, ''), '\D', '', 'g'), 10), '') as phone
      from public.contacts x where x.id = public.hub_resolve_contact(p_contact))
  select coalesce(s.tags, '{}') @> array['quarantine:test-record']
     and not exists (select 1 from public.campaign_test_contacts t where t.org_id = s.org_id
                      and (lower(btrim(t.email)) = s.email
                           or right(regexp_replace(coalesce(t.phone, ''), '\D', '', 'g'), 10) = s.phone))
    from s
$$;
revoke execute on function public.hub_contact_is_blocked_test_record(uuid) from public, anon, authenticated;
grant execute on function public.hub_contact_is_blocked_test_record(uuid) to service_role;

create or replace function public.hub_email_marketing_allowed(p_contact uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; c record; v_addr text;
begin
  v_id := public.hub_resolve_contact(p_contact);
  if public.hub_contact_is_blocked_test_record(v_id) then return false; end if;
  select x.org_id, x.email into c from public.contacts x where x.id = v_id;
  v_addr := lower(btrim(c.email));
  if v_addr is null or v_addr !~ '^[^@\s:]+@[^@\s]+\.[a-z]{2,}$' then return false; end if;
  if not (public.consent_state(v_id, 'email', 'marketing') ->> 'allowed')::boolean then return false; end if;
  if public.hub_contact_has_real_dnc(v_id) then return false; end if;
  if exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and lower(btrim(d.email)) = v_addr) then return false; end if;
  if exists (select 1 from public.suppressions su where su.org_id = c.org_id and su.channel = 'email'
              and su.address = v_addr and su.lifted_at is null) then return false; end if;
  return true;
end $$;

create or replace function public.hub_texting_allowed(p_contact uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; c record; v_addr text; cs jsonb; v_client boolean; v_optin boolean; v_dnc boolean; v_test boolean;
begin
  v_id := public.hub_resolve_contact(p_contact);
  select x.org_id, x.phone into c from public.contacts x where x.id = v_id;
  v_addr := btrim(c.phone);
  v_client := cardinality(public.hub_current_client_reasons(v_id)) > 0;
  cs := public.consent_state(v_id, 'sms', 'marketing');
  v_optin := (cs ->> 'allowed')::boolean;
  v_dnc := public.hub_contact_has_real_dnc(v_id);
  v_test := public.hub_contact_is_blocked_test_record(v_id);
  return jsonb_build_object('current_client', v_client, 'opt_in', v_optin, 'reason',
    case
      when v_test then 'test_record'
      when v_addr is null or v_addr !~ '^\+[1-9][0-9]{7,14}$' then 'no_valid_e164_phone'
      when cs ->> 'reason' = 'marketing_revoked' then 'marketing_revoked'
      when v_dnc then 'do_not_contact_flag'
      when exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and btrim(d.phone) = v_addr) then 'do_not_contact_list'
      when exists (select 1 from public.suppressions su where su.org_id = c.org_id and su.channel = 'sms'
                    and su.address = v_addr and su.lifted_at is null) then 'suppressed'
      when v_optin then 'opt_in'
      when v_client then 'current_client'
      else 'no_marketing_consent'
    end)
  || jsonb_build_object('allowed',
    not v_test
    and v_addr is not null and v_addr ~ '^\+[1-9][0-9]{7,14}$'
    and cs ->> 'reason' <> 'marketing_revoked'
    and (v_optin or v_client)
    and not v_dnc
    and not exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and btrim(d.phone) = v_addr)
    and not exists (select 1 from public.suppressions su where su.org_id = c.org_id and su.channel = 'sms'
                     and su.address = v_addr and su.lifted_at is null));
end $$;

-- gate_check as live on 2026-11-06, with one addition marked HUB_226.
create or replace function public.gate_check(p_contact uuid, p_channel text, p_kind text, p_campaign uuid default null,
                                             p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; c record; pol jsonb; v_mode text := 'dry_run'; v_addr text; cs jsonb; v_tz text;
  v_local timestamp; v_start time; v_end time; v_next timestamp; v_retry timestamptz; v_n int; v_live_ok boolean;
  v_decision text; v_step text; v_reason text; v_detail jsonb := '{}'::jsonb;
  v_text jsonb; v_brand text;  -- HUB_225
begin
  v_id := public.hub_resolve_contact(p_contact);
  select x.id, x.org_id, x.email, x.phone, x.timezone, x.do_not_contact into c from public.contacts x where x.id = v_id;
  pol := public.hub_send_policy(c.org_id);
  v_text := public.hub_texting_allowed(v_id);  -- HUB_225: exposed in the result below

  <<gate>>
  begin
    -- 1. flag: engine on, then live or dry-run
    if public.hub_flag(c.org_id, 'engine') <> 'on' then
      v_decision := 'deny'; v_step := 'flag'; v_reason := 'engine_off'; exit gate;
    end if;
    -- HUB_225: a WNW send is blocked, dry runs included, until a WNW sender is configured
    select case when f.brand = 'wnw' or o.slug = 'waynesville-neuro-wellness' then 'wnw' else 'np' end into v_brand
      from public.organizations o left join public.funnel_campaigns f on f.id = p_campaign where o.id = c.org_id;
    if v_brand = 'wnw' and coalesce(pol -> 'brand_senders' -> 'wnw' ->> 'from_address', '') = '' then
      v_decision := 'deny'; v_step := 'sender'; v_reason := 'wnw_sender_not_configured'; exit gate;
    end if;
    v_addr := case when p_channel = 'email' then lower(btrim(c.email)) else btrim(c.phone) end;
    -- HUB_226: a test record outside the test allowlist is denied on every channel and kind
    if public.hub_contact_is_blocked_test_record(v_id) then
      v_decision := 'deny'; v_step := 'suppression'; v_reason := 'test_record'; exit gate;
    end if;
    if p_channel = 'email' and (v_addr is null or v_addr !~ '^[^@\s:]+@[^@\s]+\.[a-z]{2,}$') then
      v_decision := 'deny'; v_step := 'address'; v_reason := 'no_valid_email'; exit gate;
    end if;
    if p_channel = 'sms' and (v_addr is null or v_addr !~ '^\+[1-9][0-9]{7,14}$') then
      v_decision := 'deny'; v_step := 'address'; v_reason := 'no_valid_e164_phone'; exit gate;
    end if;
    if public.hub_flag(c.org_id, 'gate_live_sends') = 'on' then
      select exists (select 1 from public.campaign_test_contacts t where t.org_id = c.org_id and
               ((p_channel = 'email' and lower(btrim(t.email)) = v_addr) or
                (p_channel = 'sms' and right(regexp_replace(coalesce(t.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(v_addr, '\D', '', 'g'), 10)
                                   and coalesce(t.phone, '') <> '')))
        or exists (select 1 from public.funnel_campaigns f where f.id = p_campaign and f.org_id = c.org_id and f.live_enabled)
        into v_live_ok;
      if v_live_ok then v_mode := 'live'; end if;
    end if;
    -- 2. consent for this kind and channel
    cs := public.consent_state(v_id, p_channel, p_kind);
    -- HUB_225: a current client with no SMS record may get a marketing text. A recorded revoke still wins.
    if p_channel = 'sms' and p_kind = 'marketing' and cs ->> 'reason' = 'no_marketing_consent'
       and (v_text ->> 'current_client')::boolean then
      cs := jsonb_build_object('allowed', true, 'event_id', null, 'reason', 'current_client');
    end if;
    if not (cs ->> 'allowed')::boolean then
      v_decision := 'deny'; v_step := 'consent'; v_reason := cs ->> 'reason'; exit gate;
    end if;
    -- HUB_225: any text step in a campaign is limited to Texting allowed, whatever its kind
    if p_channel = 'sms' and p_kind <> 'marketing' and p_campaign is not null
       and not ((v_text ->> 'current_client')::boolean or (v_text ->> 'opt_in')::boolean) then
      v_decision := 'deny'; v_step := 'consent'; v_reason := 'texting_not_allowed'; exit gate;
    end if;
    -- 3. DNC and suppression
    if c.do_not_contact then
      v_decision := 'deny'; v_step := 'suppression'; v_reason := 'do_not_contact_flag'; exit gate;
    end if;
    if exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and
               ((p_channel = 'email' and lower(btrim(d.email)) = v_addr) or (p_channel = 'sms' and btrim(d.phone) = v_addr))) then
      v_decision := 'deny'; v_step := 'suppression'; v_reason := 'do_not_contact_list'; exit gate;
    end if;
    select su.reason into v_reason from public.suppressions su
      where su.org_id = c.org_id and su.channel = p_channel and su.address = v_addr and su.lifted_at is null
        and (su.scope = 'all' or p_kind = 'marketing') limit 1;
    if found then
      v_decision := 'deny'; v_step := 'suppression'; v_reason := 'suppressed_' || v_reason; exit gate;
    end if;
    -- HUB_225: a merged-in duplicate's DNC or marketing revoke also stops a campaign text
    if p_channel = 'sms' and p_campaign is not null and not (v_text ->> 'allowed')::boolean then
      v_decision := 'deny'; v_step := 'suppression'; v_reason := v_text ->> 'reason'; exit gate;
    end if;
    -- 4. quiet hours in the contact's local time
    v_tz := coalesce((select z.name from pg_catalog.pg_timezone_names z where z.name = c.timezone), pol ->> 'default_timezone');
    v_start := (pol ->> 'quiet_start')::time; v_end := (pol ->> 'quiet_end')::time;
    v_local := p_now at time zone v_tz;
    if not (v_local::time >= v_start and v_local::time < v_end) then
      v_next := case when v_local::time < v_start then v_local::date + v_start else (v_local::date + 1) + v_start end;
      v_retry := v_next at time zone v_tz;
      v_decision := 'defer'; v_step := 'quiet_hours'; v_reason := 'outside_send_window';
      v_detail := jsonb_build_object('timezone', v_tz, 'local_time', v_local, 'retry_at', v_retry); exit gate;
    end if;
    -- 5. frequency cap, marketing only, across channels and across merged contacts
    if p_kind = 'marketing' then
      select count(*) into v_n from public.message_sends m
        where m.contact_id in (select public.hub_contact_family(v_id)) and m.kind = 'marketing'
          and m.claimed_at > p_now - make_interval(days => (pol ->> 'cap_days')::int)
          and (m.status in ('sending','sent') or (v_mode = 'dry_run' and m.status = 'dry_run'));
      if v_n >= (pol ->> 'cap_count')::int then
        v_decision := 'deny'; v_step := 'frequency_cap'; v_reason := 'cap_reached';
        v_detail := jsonb_build_object('count', v_n, 'cap', (pol ->> 'cap_count')::int, 'days', (pol ->> 'cap_days')::int); exit gate;
      end if;
    end if;
    v_decision := 'allow'; v_step := 'all'; v_reason := 'passed';
  end gate;

  insert into public.send_log (org_id, contact_id, campaign_id, channel, kind, decision, mode, step, reason, detail)
  values (c.org_id, v_id, p_campaign, p_channel, p_kind, v_decision, v_mode, v_step, v_reason, v_detail);

  return jsonb_build_object('decision', v_decision, 'mode', v_mode, 'step', v_step, 'reason', v_reason,
                            'contact_id', v_id, 'org_id', c.org_id, 'to_address', v_addr,
                            'consent_event_id', cs ->> 'event_id',
                            'current_client', (v_text ->> 'current_client')::boolean,  -- HUB_225
                            'texting_allowed', (v_text ->> 'allowed')::boolean) || v_detail;
end $$;

-- Cold outreach correction: one revoke row per contact. The list is named so the review doc and this
-- file can be compared. Brent Beam (Coaches and Therapist, source "Other") is not a city and not in it.
-- The June 2026 NP Outreach contacts are not in it either: they reached a Discovery Call stage.
do $$
declare
  v_n int;
begin
  insert into public.consent_events (org_id, contact_id, address, channel, kind, action, basis, source, evidence)
  select g.org_id, g.contact_id, g.address, 'email', 'marketing', 'revoked', 'admin',
         'existing_relationship_2026_11_withdrawn',
         jsonb_build_object('method', 'correction_hub_226', 'corrects_event_id', g.id,
           'pipeline_id', g.evidence -> 'pipeline_id', 'contact_source', g.evidence -> 'contact_source',
           'note', 'Corrects the hub_225 backfill: cold outreach is not an existing relationship (Cameron, 2026-11-06).')
    from public.consent_events g
    join public.contacts c on c.id = g.contact_id
    join (values
      -- Coaches and Therapist, source was a city (12)
      ('274aeb71-090e-4830-a96c-6535a89ac16b'::uuid),  -- Amy Porterfield, Nashville
      ('b3ab86a4-1fe3-4dad-8f23-4edcca4c4761'::uuid),  -- Angela Martinucci, Albany
      ('4b24ae4c-cebb-4698-b40a-6074107cd3f1'::uuid),  -- Ashlyn Burnett, Denver
      ('6798f554-61b0-4c24-9ad3-c2cf27b83922'::uuid),  -- Diane Grimard Wilson, Chicago
      ('699b724d-839f-4942-a89a-b8f251583479'::uuid),  -- Ed Mylett, Laguna Beach
      ('77546e89-7402-472c-9f10-c54af9a3c623'::uuid),  -- Grant Cardone, Aventura
      ('e2b9a490-dca9-4941-bd7d-789508e6e992'::uuid),  -- Jay Abraham, Los Angeles
      ('a02f5d89-b110-4507-894e-c2086226006c'::uuid),  -- Joel Jamieson, Seattle
      ('eeb7ef30-80e1-45a1-ae7f-8d189412634f'::uuid),  -- John Maxwell, Duluth
      ('1bfb1b9e-3687-4efd-8372-7b894bf60217'::uuid),  -- Leah Lagos, New York
      ('fdcc191f-4a0c-4e6e-af5e-e3babfbee8f0'::uuid),  -- Sean Brawley, Stamford
      ('a32725b5-4dc8-4d1d-8dc2-c42dd5def33d'::uuid)   -- Tara Garrison, Salt Lake City
    ) v(id) on v.id = g.contact_id
   where g.source = 'existing_relationship_2026_11' and g.evidence ->> 'method' = 'backfill'
     and g.channel = 'email' and g.kind = 'marketing' and g.action = 'granted'
     -- never anyone with an express opt-in, on the contact's fields or in the ledger
     and not coalesce(c.email_consent, false)
     and c.email_consent_at is null
     and coalesce(jsonb_array_length(case when jsonb_typeof(c.consent_forms) = 'array' then c.consent_forms end), 0) = 0
     and not exists (select 1 from public.consent_events x where x.channel = 'email' and x.basis = 'express_consent' and x.action = 'granted'
                      and (x.contact_id in (select public.hub_contact_family(c.id))
                           or (x.org_id = g.org_id and x.address = g.address)));
  get diagnostics v_n = row_count;
  -- Exactly 12 when read on 2026-11-06. Any other count means stop and look.
  if v_n <> 12 then
    raise exception 'hub_226: cold outreach correction would write % rows, expected exactly 12', v_n;
  end if;
  raise notice 'hub_226: revoked % cold outreach backfill grants', v_n;
end $$;

-- Email consent backfill: hub_225's rules, with the DNC test above and the three added source exclusions
do $$
declare
  v_org constant uuid := '00000000-0000-0000-0000-000000000001';
  v_n int;
begin
  insert into public.consent_events (org_id, contact_id, address, channel, kind, action, basis, source, evidence)
  select b.org_id, b.id, lower(btrim(b.email)), 'email', 'marketing', 'granted', 'existing_relationship',
         'existing_relationship_2026_11', jsonb_build_object('method', 'backfill_hub_226', 'pipeline_id', b.pipeline_id, 'contact_source', b.source)
    from public.contacts b
   where b.org_id = v_org and b.merged_into_id is null and b.archived_at is null
     and lower(btrim(b.email)) ~ '^[^@\s:]+@[^@\s]+\.[a-z]{2,}$'
     and not coalesce(b.tags, '{}') @> array['quarantine:test-record']
     and not public.hub_contact_has_real_dnc(b.id)
     and b.email_unsubscribed_at is null
     and not exists (select 1 from public.do_not_contact_list d where d.org_id = b.org_id and lower(btrim(d.email)) = lower(btrim(b.email)))
     and not exists (select 1 from public.suppressions s where s.org_id = b.org_id and s.channel = 'email' and s.address = lower(btrim(b.email)))
     and not exists (select 1 from public.consent_events e where e.channel = 'email' and e.kind = 'marketing'
                      and (e.contact_id in (select public.hub_contact_family(b.id))
                           or (e.org_id = b.org_id and e.address = lower(btrim(b.email)))))
     and not (coalesce(b.source, '') ~* '^https?:|research|Thinkers50|Import|media_appearance')
     and coalesce(b.source, '') not in ('prospect_unknown', 'outreach_2026_06')
     and coalesce(b.source, '') !~* '_research$';
  get diagnostics v_n = row_count;
  -- 18 when projected on 2026-11-06 after the data fix. A count far from that means stop and look.
  if v_n not between 15 and 20 then
    raise exception 'hub_226: backfill would write % rows, expected 18', v_n;
  end if;
  raise notice 'hub_226: backfilled % contacts', v_n;
end $$;

commit;
