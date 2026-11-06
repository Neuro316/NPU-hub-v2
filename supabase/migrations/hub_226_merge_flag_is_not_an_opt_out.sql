-- hub_226_merge_flag_is_not_an_opt_out.sql
--
-- STATUS: PROPOSED, NOT APPLIED. Needs Cameron's separate go. Production only (the Hub has no nonprod).
-- ORDER: apply supabase/data-fixes/2026-11-05_hub_hygiene.sql first. The first block refuses otherwise.
--
-- Hub band (200+). Checked 2026-11-05: Hub files and ledger stop at hub_225. pf_226 is the platform's
-- and is not a collision (ruling 2026-10-04).
--
-- PURPOSE: stop treating the merge's own do-not-contact flag as an opt-out.
--   POST /api/contacts/merge and migrations 072, 076 and 079 set do_not_contact = true on every merged
--   duplicate. hub_225 read that flag as a real opt-out across a contact's family, which blocked
--   26 live contacts and left their emails out of the backfill. The route stops setting it in the same
--   branch as this file; merged_into_id is the marker, and the gate resolves a merged contact to its
--   survivor. The 36 existing flags stay as they are, as the historical record.
--
-- THE RULE: a merged duplicate's flag counts only when its merge snapshot shows the flag was already
-- set before the merge. A flagged duplicate with no snapshot at all also counts, because an opt-out
-- that can't be disproved is kept. No such row exists today. A contact's own flag always counts.
--
-- BACKFILL: exactly hub_225's eligibility, with only that DNC test changed. Same basis, same source,
-- Neuro Progeny only, research, import and media sources still excluded, and no existing ledger
-- record is overridden. 18 contacts when read on 2026-11-05 after the data fix tags Hazel Thornton.
--
-- SENDS NOTHING: gate_live_sends stays off and no campaign's live_enabled changes.
--
-- ROLLBACK (in this order):
--   begin;
--   alter table public.consent_events disable trigger consent_events_append_only;
--   delete from public.consent_events where source = 'existing_relationship_2026_11' and evidence ->> 'method' = 'backfill_hub_226';
--   alter table public.consent_events enable trigger consent_events_append_only;
--   -- re-run hub_email_marketing_allowed and hub_texting_allowed from hub_225
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

create or replace function public.hub_email_marketing_allowed(p_contact uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; c record; v_addr text;
begin
  v_id := public.hub_resolve_contact(p_contact);
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
declare v_id uuid; c record; v_addr text; cs jsonb; v_client boolean; v_optin boolean; v_dnc boolean;
begin
  v_id := public.hub_resolve_contact(p_contact);
  select x.org_id, x.phone into c from public.contacts x where x.id = v_id;
  v_addr := btrim(c.phone);
  v_client := cardinality(public.hub_current_client_reasons(v_id)) > 0;
  cs := public.consent_state(v_id, 'sms', 'marketing');
  v_optin := (cs ->> 'allowed')::boolean;
  v_dnc := public.hub_contact_has_real_dnc(v_id);
  return jsonb_build_object('current_client', v_client, 'opt_in', v_optin, 'reason',
    case
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
    v_addr is not null and v_addr ~ '^\+[1-9][0-9]{7,14}$'
    and cs ->> 'reason' <> 'marketing_revoked'
    and (v_optin or v_client)
    and not v_dnc
    and not exists (select 1 from public.do_not_contact_list d where d.org_id = c.org_id and btrim(d.phone) = v_addr)
    and not exists (select 1 from public.suppressions su where su.org_id = c.org_id and su.channel = 'sms'
                     and su.address = v_addr and su.lifted_at is null));
end $$;

-- Email consent backfill: hub_225's rules, with the DNC test above
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
     and not (coalesce(b.source, '') ~* '^https?:|research|Thinkers50|Import|media_appearance');
  get diagnostics v_n = row_count;
  -- 18 when read on 2026-11-05 after the data fix. A count far from that means stop and look.
  if v_n not between 15 and 20 then
    raise exception 'hub_226: backfill would write % rows, expected 18', v_n;
  end if;
  raise notice 'hub_226: backfilled % contacts', v_n;
end $$;

commit;
