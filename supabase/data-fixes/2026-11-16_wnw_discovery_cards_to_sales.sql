-- 2026-11-16_wnw_discovery_cards_to_sales.sql  (data fix, not a migration)
--
-- STATUS: RUN 2026-11-16 14:55 CST on production, 1 card (Kari G.). Production only (the ids are production's).
--
-- Running List c04 (decided Nov 13): one Sales Pipeline for every discovery call. This moves the discovery-call
-- cards on the Waynesville Neuro Wellness pipeline into Sales, tagged WNW.
--
-- WHICH CARDS: every card in the WNW pipeline (pipeline-1790143608575) at the stage "Scheduled discovery call".
-- COUNT ON 2026-11-16 (read only): 1 card. The other 8 WNW cards (New Lead 3, Requested online resource 1,
-- Scheduled Assessment 3, Signed up for Clarity 1) are not discovery-call cards and are left where they are.
-- The fix refuses to run if the count is no longer 1.
--
-- FOR EACH CARD:
--   1. placed in Sales Pipeline (default) at "Discovery call Scheduled", forward only: a contact already further
--      along in Sales is kept where they are (hub_pipeline_place, source data_fix:wnw_to_sales; the positions trigger
--      writes the timeline entry and the time)
--   2. tag "WNW" added unless the contact already has "WNW" or "Neuro Progeny"
--   3. removed from the WNW pipeline (hub_pipeline_remove; the trigger writes the "Removed from" timeline entry)
-- Stage moves raise campaign entry events, but every route listening on these stages is inactive, so nothing
-- is queued or sent.
--
-- ROLLBACK (per contact id printed in the report):
--   select public.hub_pipeline_place('<contact id>', (select s.id from public.pipeline_stages s join public.pipelines p
--     on p.id = s.pipeline_id where p.legacy_key = 'pipeline-1790143608575' and s.name = 'Scheduled discovery call'
--     and p.org_id = '00000000-0000-0000-0000-000000000001'), false, 'data_fix:wnw_to_sales_rollback');
--   -- and, only if Sales was new for them (report column sales_was = 'none'):
--   select public.hub_pipeline_remove('<contact id>', (select id from public.pipelines where legacy_key = 'default'
--     and org_id = '00000000-0000-0000-0000-000000000001'), null, 'data_fix:wnw_to_sales_rollback');
--   -- and, only if the report says tag_added = true: remove "WNW" from that contact's tags on the card.

begin;

create temporary table wnw_to_sales_report (contact_id uuid, sales_was text, placed jsonb, tag_added boolean, removed boolean) on commit drop;

do $fix$
declare
  v_org     constant uuid := '00000000-0000-0000-0000-000000000001';
  v_wnw     uuid;
  v_from    uuid;
  v_sales   uuid;
  v_to      uuid;
  r         record;
  v_was     text;
  v_placed  jsonb;
  v_tags    text[];
  v_tagged  boolean;
  v_removed boolean;
  n         int;
begin
  select id into v_wnw from public.pipelines where org_id = v_org and legacy_key = 'pipeline-1790143608575' and archived_at is null;
  select id into v_from from public.pipeline_stages where pipeline_id = v_wnw and name = 'Scheduled discovery call' and archived_at is null;
  select id into v_sales from public.pipelines where org_id = v_org and legacy_key = 'default' and archived_at is null;
  select id into v_to from public.pipeline_stages where pipeline_id = v_sales and name = 'Discovery call Scheduled' and archived_at is null;
  if v_wnw is null or v_from is null or v_sales is null or v_to is null then
    raise exception 'wnw to sales: a pipeline or stage is missing; stop and look';
  end if;

  select count(*) into n from public.contact_pipeline_positions where pipeline_id = v_wnw and stage_id = v_from;
  if n <> 1 then raise exception 'wnw to sales: expected 1 card, found %; stop and recount', n; end if;

  for r in select x.contact_id from public.contact_pipeline_positions x where x.pipeline_id = v_wnw and x.stage_id = v_from loop
    select s.name into v_was from public.contact_pipeline_positions x join public.pipeline_stages s on s.id = x.stage_id
     where x.contact_id = r.contact_id and x.pipeline_id = v_sales;
    v_placed := public.hub_pipeline_place(r.contact_id, v_to, true, 'data_fix:wnw_to_sales');

    select tags into v_tags from public.contacts where id = r.contact_id;
    v_tagged := not exists (select 1 from unnest(coalesce(v_tags, '{}')) t where lower(btrim(t)) in ('wnw', 'neuro progeny'));
    if v_tagged then
      update public.contacts set tags = array_append(coalesce(tags, '{}'), 'WNW'), updated_at = now() where id = r.contact_id;
    end if;

    v_removed := public.hub_pipeline_remove(r.contact_id, v_wnw, null, 'data_fix:wnw_to_sales');
    insert into wnw_to_sales_report values (r.contact_id, coalesce(v_was, 'none'), v_placed, v_tagged, v_removed);
  end loop;

  if (select count(*) from wnw_to_sales_report where removed) <> 1 then raise exception 'wnw to sales: not every card was removed from WNW'; end if;
  if exists (select 1 from public.contact_pipeline_positions where pipeline_id = v_wnw and stage_id = v_from) then
    raise exception 'wnw to sales: a card is still at Scheduled discovery call in WNW';
  end if;
end $fix$;

-- report: ids and outcomes only
select * from wnw_to_sales_report;

commit;
