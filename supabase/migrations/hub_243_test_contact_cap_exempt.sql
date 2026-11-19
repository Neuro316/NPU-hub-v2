-- hub_243_test_contact_cap_exempt.sql
--
-- STATUS: PROPOSED 2026-11-18, NOT APPLIED. Needs a go. Applied by the Hub chat: nonprod (cpasntagxhxitavivwlb)
-- first, then production (htfrfaxlcuyawtlztxxm), then NOTIFY pgrst and the read-back below.
--
-- Hub band (200+). Production's ledger ends at hub_242_mail_search_log (checked 2026-11-18); hub_241 is reserved for
-- the support FAQ and hub_234 for the open scheduling-agent branch (PR #46). This is 243.
--
-- WHY: campaign test drives on production hit the marketing frequency cap (hub_send_policy cap_count 3 per cap_days
-- 7). The allowlisted test contact used its 3 dry runs on Discovery booked and Discovery no-show, so every step of
-- Post-discovery follow-up, Drop-off nudge, Signed up no purchase and Checkout recovery was refused cap_reached.
-- Counting dry runs toward the cap is intended for real people and stays.
--
-- WHAT CHANGES in public.gate_check (create or replace of the current production definition):
--   - one new variable, v_test_contact boolean := false
--   - step 5 (frequency cap): when the kind is marketing and the mode is dry_run, look the contact up in the org's
--     test allowlist, public.campaign_test_contacts (the same table POST /api/marketing/test-enroll and the gate's
--     own live check read): its email, or the last 10 digits of its phone. The cap is then skipped only when the
--     mode is dry_run AND the contact is on that list.
--   NOTHING ELSE CHANGES: the engine flag, the WNW sender block, the test-record block, address checks, live/dry-run
--   choice, consent, DNC, suppressions, quiet hours, the send_log row and the result are byte for byte as today. A
--   live send to the test contact is capped (the lookup only runs in dry run), and every real contact is capped.
--
-- READ FIRST (select, 2026-11-18): pg_get_functiondef of public.gate_check(uuid,text,text,uuid,timestamptz) on
-- production AND nonprod, both md5 69b7a1b0becd612049560e5ae08e9875. The guard below refuses to replace anything else.
--
-- READ-BACK after the apply (expect the new md5, 0436c63f63ea95dca52aef90101bb421):
--   select md5(pg_get_functiondef('public.gate_check(uuid,text,text,uuid,timestamp with time zone)'::regprocedure));
-- Optional behaviour check (gate_check writes a send_log row, so run it inside a transaction that rolls back):
--   begin;
--   select public.gate_check('<the test contact id>', 'email', 'marketing', null, now()) ->> 'step';   -- not 'frequency_cap'
--   rollback;
--
-- ROLLBACK (restores today's definition exactly; read back md5 69b7a1b0becd612049560e5ae08e9875). Remove the leading "-- " from each line
-- between the markers and run it:
-- ROLLBACK BEGIN
-- CREATE OR REPLACE FUNCTION public.gate_check(p_contact uuid, p_channel text, p_kind text, p_campaign uuid DEFAULT NULL::uuid, p_now timestamp with time zone DEFAULT now())
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- declare
--   v_id uuid; c record; pol jsonb; v_mode text := 'dry_run'; v_addr text; cs jsonb; v_tz text;
--   v_local timestamp; v_start time; v_end time; v_next timestamp; v_retry timestamptz; v_n int; v_live_ok boolean;
--   v_decision text; v_step text; v_reason text; v_detail jsonb := '{}'::jsonb;
--   v_text jsonb; v_brand text;  -- HUB_225
-- begin
--   v_id := public.hub_resolve_contact(p_contact);
--   select x.id, x.org_id, x.email, x.phone, x.timezone, x.do_not_contact into c from public.contacts x where x.id = v_id;
--   pol := public.hub_send_policy(c.org_id);
--   v_text := public.hub_texting_allowed(v_id);  -- HUB_225: exposed in the result below
--
--   <<gate>>
--   begin
--     -- 1. flag: engine on, then live or dry-run
--     if public.hub_flag(c.org_id, 'engine') <> 'on' then
--       v_decision := 'deny'; v_step := 'flag'; v_reason := 'engine_off'; exit gate;
--     end if;
--     -- HUB_225: a WNW send is blocked, dry runs included, until a WNW sender is configured
--     select case when f.brand = 'wnw' or o.slug = 'waynesville-neuro-wellness' then 'wnw' else 'np' end into v_brand
--       from public.organizations o left join public.funnel_campaigns f on f.id = p_campaign where o.id = c.org_id;
--     if v_brand = 'wnw' and coalesce(pol -> 'brand_senders' -> 'wnw' ->> 'from_address', '') = '' then
--       v_decision := 'deny'; v_step := 'sender'; v_reason := 'wnw_sender_not_configured'; exit gate;
--     end if;
--     v_addr := case when p_channel = 'email' then lower(btrim(c.email)) else btrim(c.phone) end;
--     -- HUB_226: a test record outside the test allowlist is denied on every channel and kind
--     if public.hub_contact_is_blocked_test_record(v_id) then
--       v_decision := 'deny'; v_step := 'suppression'; v_reason := 'test_record'; exit gate;
--     end if;
--     if p_channel = 'email' and (v_addr is null or v_addr !~ '^[^@\s:]+@[^@\s]+\.[a-z]{2,}$') then
--       v_decision := 'deny'; v_step := 'address'; v_reason := 'no_valid_email'; exit gate;
--     end if;
--     if p_channel = 'sms' and (v_addr is null or v_addr !~ '^\+[1-9][0-9]{7,14}$') then
--       v_decision := 'deny'; v_step := 'address'; v_reason := 'no_valid_e164_phone'; exit gate;
--     end if;
--     if public.hub_flag(c.org_id, 'gate_live_sends') = 'on' then
--       select exists (select 1 from public.campaign_test_contacts t where t.org_id = c.org_id and
--                ((p_channel = 'email' and lower(btrim(t.email)) = v_addr) or
--                 (p_channel = 'sms' and right(regexp_replace(coalesce(t.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(v_addr, '\D', '', 'g'), 10)
--                                    and coalesce(t.phone, '') <> '')))
--         or exists (select 1 from public.funnel_campaigns f where f.id = p_campaign and f.org_id = c.org_id and f.live_enabled)
--         into v_live_ok;
--       if v_live_ok then v_mode := 'live'; end if;
--     end if;
--     -- 2. consent for this kind and channel
--     cs := public.consent_state(v_id, p_channel, p_kind);
--     -- HUB_225: a current client with no SMS record may get a marketing text. A recorded revoke still wins.
--     if p_channel = 'sms' and p_kind = 'marketing' and cs ->> 'reason' = 'no_marketing_consent'
--        and (v_text ->> 'current_client')::boolean then
--       cs := jsonb_build_object('allowed', true, 'event_id', null, 'reason', 'current_client');
--     end if;
--     if not (cs ->> 'allowed')::boolean then
--       v_decision := 'deny'; v_step := 'consent'; v_reason := cs ->> 'reason'; exit gate;
--     end if;
--     -- HUB_225: any text step in a campaign is limited to Texting allowed, whatever its kind
--     if p_channel = 'sms' and p_kind <> 'marketing' and p_campaign is not null
--        and not ((v_text ->> 'current_client')::boolean or (v_text ->> 'opt_in')::boolean) then
--       v_decision := 'deny'; v_step := 'consent'; v_reason := 'texting_not_allowed'; exit gate;
--     end if;
--     -- 3. DNC and suppression
--     if c.do_not_contact then
--       v_decision := 'deny'; v_step := 'suppression'; v_reason := 'do_not_contact_flag'; exit gate;
--     end if;
--     if exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and
--                ((p_channel = 'email' and lower(btrim(d.email)) = v_addr) or (p_channel = 'sms' and btrim(d.phone) = v_addr))) then
--       v_decision := 'deny'; v_step := 'suppression'; v_reason := 'do_not_contact_list'; exit gate;
--     end if;
--     select su.reason into v_reason from public.suppressions su
--       where su.org_id = c.org_id and su.channel = p_channel and su.address = v_addr and su.lifted_at is null
--         and (su.scope = 'all' or p_kind = 'marketing') limit 1;
--     if found then
--       v_decision := 'deny'; v_step := 'suppression'; v_reason := 'suppressed_' || v_reason; exit gate;
--     end if;
--     -- HUB_225: a merged-in duplicate's DNC or marketing revoke also stops a campaign text
--     if p_channel = 'sms' and p_campaign is not null and not (v_text ->> 'allowed')::boolean then
--       v_decision := 'deny'; v_step := 'suppression'; v_reason := v_text ->> 'reason'; exit gate;
--     end if;
--     -- 4. quiet hours in the contact's local time
--     v_tz := coalesce((select z.name from pg_catalog.pg_timezone_names z where z.name = c.timezone), pol ->> 'default_timezone');
--     v_start := (pol ->> 'quiet_start')::time; v_end := (pol ->> 'quiet_end')::time;
--     v_local := p_now at time zone v_tz;
--     if not (v_local::time >= v_start and v_local::time < v_end) then
--       v_next := case when v_local::time < v_start then v_local::date + v_start else (v_local::date + 1) + v_start end;
--       v_retry := v_next at time zone v_tz;
--       v_decision := 'defer'; v_step := 'quiet_hours'; v_reason := 'outside_send_window';
--       v_detail := jsonb_build_object('timezone', v_tz, 'local_time', v_local, 'retry_at', v_retry); exit gate;
--     end if;
--     -- 5. frequency cap, marketing only, across channels and across merged contacts
--     if p_kind = 'marketing' then
--       select count(*) into v_n from public.message_sends m
--         where m.contact_id in (select public.hub_contact_family(v_id)) and m.kind = 'marketing'
--           and m.claimed_at > p_now - make_interval(days => (pol ->> 'cap_days')::int)
--           and (m.status in ('sending','sent') or (v_mode = 'dry_run' and m.status = 'dry_run'));
--       if v_n >= (pol ->> 'cap_count')::int then
--         v_decision := 'deny'; v_step := 'frequency_cap'; v_reason := 'cap_reached';
--         v_detail := jsonb_build_object('count', v_n, 'cap', (pol ->> 'cap_count')::int, 'days', (pol ->> 'cap_days')::int); exit gate;
--       end if;
--     end if;
--     v_decision := 'allow'; v_step := 'all'; v_reason := 'passed';
--   end gate;
--
--   insert into public.send_log (org_id, contact_id, campaign_id, channel, kind, decision, mode, step, reason, detail)
--   values (c.org_id, v_id, p_campaign, p_channel, p_kind, v_decision, v_mode, v_step, v_reason, v_detail);
--
--   return jsonb_build_object('decision', v_decision, 'mode', v_mode, 'step', v_step, 'reason', v_reason,
--                             'contact_id', v_id, 'org_id', c.org_id, 'to_address', v_addr,
--                             'consent_event_id', cs ->> 'event_id',
--                             'current_client', (v_text ->> 'current_client')::boolean,  -- HUB_225
--                             'texting_allowed', (v_text ->> 'allowed')::boolean) || v_detail;
-- end $function$;
-- ROLLBACK END
--   then: delete from supabase_migrations.schema_migrations where name = 'hub_243_test_contact_cap_exempt';

begin;

do $guard$
begin
  if md5(pg_get_functiondef('public.gate_check(uuid,text,text,uuid,timestamp with time zone)'::regprocedure))
     <> '69b7a1b0becd612049560e5ae08e9875' then
    raise exception 'hub_243: public.gate_check is not the definition this migration was written against; stop and look';
  end if;
end $guard$;

CREATE OR REPLACE FUNCTION public.gate_check(p_contact uuid, p_channel text, p_kind text, p_campaign uuid DEFAULT NULL::uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid; c record; pol jsonb; v_mode text := 'dry_run'; v_addr text; cs jsonb; v_tz text;
  v_local timestamp; v_start time; v_end time; v_next timestamp; v_retry timestamptz; v_n int; v_live_ok boolean;
  v_decision text; v_step text; v_reason text; v_detail jsonb := '{}'::jsonb;
  v_text jsonb; v_brand text;  -- HUB_225
  v_test_contact boolean := false;  -- HUB_243
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
    -- HUB_243: skipped only for a DRY RUN to one of the org's allowlisted test contacts (campaign_test_contacts, the
    -- list test drives use), so a test drive can check every campaign. Every real contact, and every live send, is
    -- still capped, and dry runs still count toward the cap for everyone else.
    if p_kind = 'marketing' and v_mode = 'dry_run' then
      select exists (select 1 from public.campaign_test_contacts t where t.org_id = c.org_id and
               ((coalesce(btrim(t.email), '') <> '' and lower(btrim(t.email)) = lower(btrim(c.email))) or
                (coalesce(t.phone, '') <> '' and right(regexp_replace(t.phone, '\D', '', 'g'), 10)
                                              = right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10))))
        into v_test_contact;
    end if;
    if p_kind = 'marketing' and not (v_mode = 'dry_run' and v_test_contact) then
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
end $function$;

commit;
