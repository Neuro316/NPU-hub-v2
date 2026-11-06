-- hub_225_marketing_foundations_smart_lists.sql
--
-- STATUS: APPLIED to production (htfrfaxlcuyawtlztxxm) on 2026-11-05 after Cameron's go.
-- The Hub has no nonprod.
--
-- Hub band (200+). Checked 2026-11-05: files and ledger stop at hub_224, no hub_225 or 225.
--
-- PURPOSE: marketing foundations (M1) and smart lists (M2).
--   1. consent_events accepts the existing_relationship backfill basis.
--   2. Computed current client, marketing email allowed and texting allowed.
--   3. gate_check: a text is limited to Texting allowed; WNW sends are blocked without a sender.
--   4. smart_lists, plus smart_list_id and brand on funnel_campaigns.
--   5. Neuro Progeny marketing sends as "Cameron Allen".
--   6. One-time email consent backfill.
--   7. Starter lists.
--
-- ACCESS: every new object is service-role only. RLS on, no policies, execute revoked elsewhere.
--
-- SENDS NOTHING: gate_live_sends stays off and no campaign's live_enabled changes.
--
-- ROLLBACK (in this order):
--   begin;
--   alter table public.consent_events disable trigger consent_events_append_only;
--   delete from public.consent_events where source = 'existing_relationship_2026_11';
--   alter table public.consent_events enable trigger consent_events_append_only;
--   drop index public.consent_events_backfill_once;
--   alter table public.consent_events drop constraint consent_events_basis_check,
--     drop constraint consent_events_check;
--   alter table public.consent_events
--     add constraint consent_events_basis_check check (basis in ('express_consent',
--       'existing_business_relationship','transactional','unsubscribe','stop','bounce','complaint','admin')),
--     add constraint consent_events_check check (action = 'revoked' or source = 'import'
--       or coalesce(btrim(text_shown), '') <> '');
--   -- re-run the gate_check definition from hub_211_marketing_engine.sql
--   alter table public.funnel_campaigns drop column smart_list_id, drop column brand;
--   drop table public.smart_lists;
--   drop function public.hub_contact_facts(uuid);
--   drop function public.hub_texting_allowed(uuid);
--   drop function public.hub_email_marketing_allowed(uuid);
--   drop function public.hub_current_client_reasons(uuid);
--   update public.org_settings
--      set setting_value = setting_value || '{"from_address":"Neuro Progeny <hello@mail.neuroprogeny.com>"}'::jsonb
--    where org_id = '00000000-0000-0000-0000-000000000001' and setting_key = 'hub_send_policy';
--   delete from supabase_migrations.schema_migrations where name = 'hub_225_marketing_foundations_smart_lists';
--   commit;

begin;

-- ─── 1. Consent ledger accepts the backfill ───────────────────────────────────
-- A backfill row shows no text to anyone, so it is exempt by its exact source rather than
-- carrying invented wording. The same exemption the 'import' source already has.
alter table public.consent_events drop constraint consent_events_basis_check;
alter table public.consent_events add constraint consent_events_basis_check
  check (basis in ('express_consent','existing_business_relationship','existing_relationship','transactional',
                   'unsubscribe','stop','bounce','complaint','admin'));
alter table public.consent_events drop constraint consent_events_check;
alter table public.consent_events add constraint consent_events_check
  check (action = 'revoked' or source in ('import','existing_relationship_2026_11')
         or coalesce(btrim(text_shown), '') <> '');
-- one backfill row per contact, enforced
create unique index consent_events_backfill_once on public.consent_events (contact_id)
  where source = 'existing_relationship_2026_11';

-- ─── 2. Computed status. Never stored by hand. ────────────────────────────────
-- Why a contact is a current client. Empty array means not one.
create function public.hub_current_client_reasons(p_contact uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  with fam as (
    select c.id, c.mastermind_user_id, lower(btrim(c.email)) as em from public.contacts c
     where c.id in (select public.hub_contact_family(public.hub_resolve_contact(p_contact)))),
  prof as (
    select p.id from public.profiles p
     where p.id in (select f.mastermind_user_id from fam f where f.mastermind_user_id is not null)
        or lower(btrim(p.email)) in (select f.em from fam f where coalesce(f.em, '') <> ''))
  select array_remove(array[
    case when exists (select 1 from public.enrollments e where e.user_id in (select id from prof)
                       and e.status = 'active' and (e.access_ends_at is null or e.access_ends_at > now()))
         then 'enrollment' end,
    case when exists (select 1 from public.entitlements t where t.user_id in (select id from prof)
                       and (t.expires_at is null or t.expires_at > now()))
         then 'entitlement' end,
    -- a $0 payment is a comp (definitions.md G3) and a fully refunded one is not a payment
    case when exists (select 1 from public.payments y where y.participant_id in (select id from prof)
                       and y.status in ('succeeded','partially_refunded')
                       and y.amount_cents > coalesce(y.amount_refunded_cents, 0)
                       and coalesce(y.paid_at, y.created_at) > now() - interval '120 days')
         then 'payment' end,
    case when exists (select 1 from public.nr_bookings b
                       left join public.nr_booking_leads l on l.id = b.lead_id
                       where b.status = 'confirmed' and b.ends_at > now()
                         and (b.participant_id in (select id from prof)
                              or lower(btrim(l.email)) in (select f.em from fam f where coalesce(f.em, '') <> '')))
           or exists (select 1 from public.hub_booking_syncs s
                       where s.contact_id in (select f.id from fam f) and s.status = 'confirmed' and s.starts_at > now())
         then 'booking' end
  ], null)
$$;

create function public.hub_email_marketing_allowed(p_contact uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; c record; v_addr text;
begin
  v_id := public.hub_resolve_contact(p_contact);
  select x.org_id, x.email into c from public.contacts x where x.id = v_id;
  v_addr := lower(btrim(c.email));
  if v_addr is null or v_addr !~ '^[^@\s:]+@[^@\s]+\.[a-z]{2,}$' then return false; end if;
  if not (public.consent_state(v_id, 'email', 'marketing') ->> 'allowed')::boolean then return false; end if;
  if exists (select 1 from public.contacts f where f.id in (select public.hub_contact_family(v_id)) and f.do_not_contact) then return false; end if;
  if exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and lower(btrim(d.email)) = v_addr) then return false; end if;
  if exists (select 1 from public.suppressions su where su.org_id = c.org_id and su.channel = 'email'
              and su.address = v_addr and su.lifted_at is null) then return false; end if;
  return true;
end $$;

-- Texting allowed = current client or an SMS opt-in, minus STOP and DNC.
-- The opt-in is a ledger event. contacts.sms_consent is not read: inbound-sms sets it true on any
-- new inbound texter, which is not an opt-in to marketing.
create function public.hub_texting_allowed(p_contact uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; c record; v_addr text; cs jsonb; v_client boolean; v_optin boolean;
begin
  v_id := public.hub_resolve_contact(p_contact);
  select x.org_id, x.phone into c from public.contacts x where x.id = v_id;
  v_addr := btrim(c.phone);
  v_client := cardinality(public.hub_current_client_reasons(v_id)) > 0;
  cs := public.consent_state(v_id, 'sms', 'marketing');
  v_optin := (cs ->> 'allowed')::boolean;
  return jsonb_build_object('current_client', v_client, 'opt_in', v_optin, 'reason',
    case
      when v_addr is null or v_addr !~ '^\+[1-9][0-9]{7,14}$' then 'no_valid_e164_phone'
      when cs ->> 'reason' = 'marketing_revoked' then 'marketing_revoked'
      when exists (select 1 from public.contacts f where f.id in (select public.hub_contact_family(v_id)) and f.do_not_contact) then 'do_not_contact_flag'
      when exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and btrim(d.phone) = v_addr) then 'do_not_contact_list'
      when exists (select 1 from public.suppressions su where su.org_id = c.org_id and su.channel = 'sms'
                    and su.address = v_addr and su.lifted_at is null) then 'suppressed'
      when v_optin then 'opt_in'
      when v_client then 'current_client'
      else 'no_marketing_consent'
    end)
  || jsonb_build_object('allowed',
    v_addr is not null and v_addr ~ '^\+[1-9][0-9]{7,14}$'
    and cs ->> 'reason' <> 'marketing_revoked'
    and (v_optin or v_client)
    and not exists (select 1 from public.contacts f where f.id in (select public.hub_contact_family(v_id)) and f.do_not_contact)
    and not exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and btrim(d.phone) = v_addr)
    and not exists (select 1 from public.suppressions su where su.org_id = c.org_id and su.channel = 'sms'
                     and su.address = v_addr and su.lifted_at is null));
end $$;

-- ─── 3. The send gate. Same as hub_211 except where marked HUB_225. ───────────
create or replace function public.gate_check(p_contact uuid, p_channel text, p_kind text, p_campaign uuid default null,
                                  p_now timestamptz default now())
returns jsonb
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

-- ─── 4. Smart lists ───────────────────────────────────────────────────────────
create table public.smart_lists (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  description text,
  brand       text not null default 'np' check (brand in ('np','wnw')),
  definition  jsonb not null default '{"match":"all","rules":[]}'::jsonb
              check (jsonb_typeof(definition) = 'object' and definition ->> 'match' in ('all','any')
                     and jsonb_typeof(definition -> 'rules') = 'array'),
  seed_key    text,
  created_by  uuid,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, seed_key)
);
create index smart_lists_org on public.smart_lists (org_id) where archived_at is null;
alter table public.smart_lists enable row level security;
revoke all on public.smart_lists from public, anon, authenticated;
grant all on public.smart_lists to service_role;

alter table public.funnel_campaigns
  add column smart_list_id uuid references public.smart_lists(id) on delete set null,
  add column brand text not null default 'np' check (brand in ('np','wnw'));
create index funnel_campaigns_smart_list on public.funnel_campaigns (smart_list_id) where smart_list_id is not null;

-- One row per live contact, with everything a list can filter on. Lists are evaluated from this
-- on every read, so they are always current and nothing about membership is stored.
create function public.hub_contact_facts(p_org uuid)
returns table (contact_id uuid, first_name text, last_name text, email text, phone text, tags text[], source text,
               contact_type text, partnership_type text, pipeline_id text, pipeline_name text, pipeline_stage text, brand text,
               created_at timestamptz, last_activity_at timestamptz, last_open_at timestamptz, last_click_at timestamptz,
               booked_at timestamptz, booking_types text[], client_reasons text[], email_allowed boolean,
               texting_allowed boolean, purchases jsonb)
language sql stable security definer set search_path = '' as $$
  select c.id, c.first_name, c.last_name, c.email, c.phone,
         coalesce(c.tags, '{}') || coalesce(c.auto_tags, '{}'), c.source, c.contact_type, c.partnership_type,
         c.pipeline_id, pl.name, c.pipeline_stage,
         case when pl.name ~* 'waynesville' then 'wnw' else 'np' end,
         c.created_at,
         greatest(c.last_contacted_at, c.last_call_at, c.last_text_at, c.last_email_at, m.last_open, m.last_click, b.booked),
         m.last_open, m.last_click, b.booked, coalesce(b.types, '{}'),
         public.hub_current_client_reasons(c.id), public.hub_email_marketing_allowed(c.id),
         (public.hub_texting_allowed(c.id) ->> 'allowed')::boolean, coalesce(p.items, '[]'::jsonb)
    from public.contacts c
    left join public.pipelines pl on pl.org_id = c.org_id and pl.legacy_key = c.pipeline_id
    left join lateral (
      select max(ms.opened_at) as last_open, max(ms.clicked_at) as last_click from public.message_sends ms
       where ms.contact_id in (select public.hub_contact_family(c.id))) m on true
    left join lateral (
      select max(s.starts_at) as booked, array_agg(distinct s.appointment_type) filter (where s.appointment_type is not null) as types
        from public.hub_booking_syncs s where s.contact_id in (select public.hub_contact_family(c.id))) b on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('key', i.key, 'name', i.name, 'at', i.at)) as items from (
        select t.keyword as key, t.keyword as name, t.granted_at as at
          from public.entitlements t join public.profiles pr on pr.id = t.user_id
         where pr.id = c.mastermind_user_id or lower(btrim(pr.email)) = lower(btrim(c.email))
        union all
        select 'program:' || e.program_id, g.name, e.enrolled_at
          from public.enrollments e join public.profiles pr on pr.id = e.user_id
          join public.programs g on g.id = e.program_id
         where e.status not in ('cancelled','refunded')
           and (pr.id = c.mastermind_user_id or lower(btrim(pr.email)) = lower(btrim(c.email)))) i) p on true
   where c.org_id = p_org and c.merged_into_id is null and c.archived_at is null
     and not coalesce(c.tags, '{}') @> array['quarantine:test-record']
$$;

revoke execute on function public.hub_current_client_reasons(uuid) from public, anon, authenticated;
revoke execute on function public.hub_email_marketing_allowed(uuid) from public, anon, authenticated;
revoke execute on function public.hub_texting_allowed(uuid) from public, anon, authenticated;
revoke execute on function public.hub_contact_facts(uuid) from public, anon, authenticated;
grant execute on function public.hub_current_client_reasons(uuid) to service_role;
grant execute on function public.hub_email_marketing_allowed(uuid) to service_role;
grant execute on function public.hub_texting_allowed(uuid) to service_role;
grant execute on function public.hub_contact_facts(uuid) to service_role;

-- ─── 5. Sender identity. Address, domain and reply-to are already correct. ────
update public.org_settings
   set setting_value = setting_value || '{"from_address":"Cameron Allen <hello@mail.neuroprogeny.com>"}'::jsonb
 where org_id = '00000000-0000-0000-0000-000000000001' and setting_key = 'hub_send_policy'
   and setting_value ->> 'from_domain' = 'mail.neuroprogeny.com'
   and setting_value ->> 'reply_to' = 'cameron.allen@neuroprogeny.com';

-- ─── 6. Email consent backfill ────────────────────────────────────────────────
-- Inserted directly, not through record_consent: a grant there lifts unsubscribe and stop
-- suppressions, which this must never do. Any existing ledger record for the contact or the address
-- means no row, so nothing already decided is overridden.
do $$
declare
  v_org constant uuid := '00000000-0000-0000-0000-000000000001';
  v_exclude_research constant boolean := true;  -- Cameron's decision 2026-11-05: leave out the 42 research contacts
  v_n int;
begin
  insert into public.consent_events (org_id, contact_id, address, channel, kind, action, basis, source, evidence)
  select b.org_id, b.id, lower(btrim(b.email)), 'email', 'marketing', 'granted', 'existing_relationship',
         'existing_relationship_2026_11', jsonb_build_object('method', 'backfill', 'pipeline_id', b.pipeline_id, 'contact_source', b.source)
    from public.contacts b
   where b.org_id = v_org and b.merged_into_id is null and b.archived_at is null
     and lower(btrim(b.email)) ~ '^[^@\s:]+@[^@\s]+\.[a-z]{2,}$'
     and not coalesce(b.tags, '{}') @> array['quarantine:test-record']
     and not b.do_not_contact
     and not exists (select 1 from public.contacts f where f.id in (select public.hub_contact_family(b.id)) and f.do_not_contact)
     and b.email_unsubscribed_at is null
     and not exists (select 1 from public.do_not_contact_list d where d.org_id = b.org_id and lower(btrim(d.email)) = lower(btrim(b.email)))
     and not exists (select 1 from public.suppressions s where s.org_id = b.org_id and s.channel = 'email' and s.address = lower(btrim(b.email)))
     and not exists (select 1 from public.consent_events e where e.channel = 'email' and e.kind = 'marketing'
                      and (e.contact_id in (select public.hub_contact_family(b.id))
                           or (e.org_id = b.org_id and e.address = lower(btrim(b.email)))))
     and not (v_exclude_research and coalesce(b.source, '') ~* '^https?:|research|Thinkers50|Import|media_appearance');
  get diagnostics v_n = row_count;
  -- 97 eligible when read on 2026-11-05 with research excluded. A count far from that means stop and look.
  if v_n not between 90 and 105 then
    raise exception 'hub_225: backfill would write % rows, expected about 97', v_n;
  end if;
  raise notice 'hub_225: backfilled % contacts', v_n;
end $$;

-- ─── 7. Starter lists (Neuro Progeny). Fields with no source show "no data source yet" in the UI. ─
insert into public.smart_lists (org_id, seed_key, name, brand, definition) values
 ('00000000-0000-0000-0000-000000000001','new_leads_30','New leads 30 days','np',
  '{"match":"all","rules":[{"field":"created_days","op":"lte","value":30},{"field":"purchased","op":"is","value":false}]}'),
 ('00000000-0000-0000-0000-000000000001','quiz_holder','Quiz: The Holder','np',
  '{"match":"all","rules":[{"field":"quiz_archetype","op":"in","value":["Holder"]}]}'),
 ('00000000-0000-0000-0000-000000000001','quiz_giver','Quiz: The Giver','np',
  '{"match":"all","rules":[{"field":"quiz_archetype","op":"in","value":["Giver"]}]}'),
 ('00000000-0000-0000-0000-000000000001','quiz_ember','Quiz: The Ember','np',
  '{"match":"all","rules":[{"field":"quiz_archetype","op":"in","value":["Ember"]}]}'),
 ('00000000-0000-0000-0000-000000000001','quiz_tender','Quiz: The Tender','np',
  '{"match":"all","rules":[{"field":"quiz_archetype","op":"in","value":["Tender"]}]}'),
 ('00000000-0000-0000-0000-000000000001','booked_discovery','Booked discovery call','np',
  '{"match":"any","rules":[{"field":"stage","op":"in","value":["Discovery call Scheduled","Scheduled discovery call"]},{"field":"booking_type","op":"contains","value":"discovery"}]}'),
 ('00000000-0000-0000-0000-000000000001','discovery_no_show','Discovery no-show','np',
  '{"match":"all","rules":[{"field":"no_show","op":"is","value":true}]}'),
 ('00000000-0000-0000-0000-000000000001','talked_not_bought','Talked not bought','np',
  '{"match":"all","rules":[{"field":"stage","op":"in","value":["Discovery Call","Price quoted","Follow up","Had ROF1"]},{"field":"purchased","op":"is","value":false}]}'),
 ('00000000-0000-0000-0000-000000000001','checkout_abandoned','Checkout abandoned','np',
  '{"match":"all","rules":[{"field":"stage","op":"in","value":["Checkout started"]},{"field":"purchased","op":"is","value":false}]}'),
 ('00000000-0000-0000-0000-000000000001','assessment_no_clarity','Assessment buyers without Clarity','np',
  '{"match":"all","rules":[{"field":"purchase","op":"any","value":["program:0ad53310-fd8b-4c9b-916c-8ec29ac4eeab"]},{"field":"purchase","op":"none","value":["clarity-protocol","program:8414e3df-c030-414b-badf-f6ebdfbb4c98"]}]}'),
 ('00000000-0000-0000-0000-000000000001','clarity_current','Clarity clients current','np',
  '{"match":"all","rules":[{"field":"purchase","op":"any","value":["clarity-protocol","program:8414e3df-c030-414b-badf-f6ebdfbb4c98"]},{"field":"current_client","op":"is","value":true}]}'),
 ('00000000-0000-0000-0000-000000000001','clarity_grads_no_capacity','Clarity graduates without Capacity','np',
  '{"match":"all","rules":[{"field":"purchase","op":"any","value":["clarity-protocol","program:8414e3df-c030-414b-badf-f6ebdfbb4c98"]},{"field":"stage","op":"in","value":["Completed Course moving to nurture","Completed course Joined Alumni Membership "]},{"field":"purchase","op":"none","value":["capacity-protocol-p2-mv52xan3","program:a4f974c3-7b8f-49e1-bea0-46c0a63aa16f","program:c891d8b1-a2c3-4e10-9c8d-65949ae7be70","program:c184f807-b48f-44f8-9287-f099d93e16ec"]}]}'),
 ('00000000-0000-0000-0000-000000000001','past_clients','Past clients','np',
  '{"match":"all","rules":[{"field":"purchased","op":"is","value":true},{"field":"current_client","op":"is","value":false}]}'),
 ('00000000-0000-0000-0000-000000000001','webinar_not_attended','Webinar registered not attended','np',
  '{"match":"all","rules":[{"field":"webinar_registered","op":"is","value":true},{"field":"webinar_attended","op":"is","value":false}]}'),
 ('00000000-0000-0000-0000-000000000001','webinar_not_bought','Webinar attended not bought','np',
  '{"match":"all","rules":[{"field":"webinar_attended","op":"is","value":true},{"field":"purchased","op":"is","value":false}]}'),
 ('00000000-0000-0000-0000-000000000001','wnw_local_leads','WNW local leads','wnw',
  '{"match":"all","rules":[{"field":"brand","op":"in","value":["wnw"]}]}'),
 ('00000000-0000-0000-0000-000000000001','partners_clinics','Partners and clinics','np',
  '{"match":"any","rules":[{"field":"contact_type","op":"in","value":["b2b_partner","b2b_clinic"]},{"field":"partnership","op":"is","value":true},{"field":"pipeline","op":"in","value":["pipeline-1773226191008","pipeline-1784838066772"]}]}'),
 ('00000000-0000-0000-0000-000000000001','podcast_media','Podcast hosts and media','np',
  '{"match":"any","rules":[{"field":"tags","op":"any","value":["podcast_host","podcast"]},{"field":"pipeline","op":"in","value":["pipeline-1772718032193"]},{"field":"source","op":"in","value":["media_appearance"]}]}'),
 ('00000000-0000-0000-0000-000000000001','cold_90','Cold 90 days','np',
  '{"match":"all","rules":[{"field":"inactive_days","op":"gte","value":90}]}'),
 ('00000000-0000-0000-0000-000000000001','texting_allowed','Texting allowed','np',
  '{"match":"all","rules":[{"field":"texting_allowed","op":"is","value":true}]}');

commit;
