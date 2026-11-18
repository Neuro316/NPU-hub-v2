-- 2026-11-18_seed_resources.sql  (data, Running List q33)
--
-- STATUS: PROPOSED 2026-11-18. NOT RUN. Needs a go, and needs hub_240_resource_links applied first (it uses the
-- new kind, url, owner_id and where_used columns). Runs on nonprod or production: the owner is looked up by email,
-- never by a hard-coded user id, and the org is Neuro Progeny (same id on both).
--
-- WHAT IT ADDS: the links the Hub already sends or shows, as link resources owned by Cameron in Neuro Progeny.
-- Found read only on production, 18 Nov 2026:
--   discovery call booking   org_settings discovery_booking_url (NP), and the booking routes' lead type
--   Capacity Protocol checkout  3 campaign steps (sequence_steps) link to it
--   University home          5 campaign steps link to it
--   Transitions quiz         the website intake's quiz origin (docs/integrations/website-intake.md)
--   Free training course     the podcast guest sheet's call to action (guest-sheet page, guest profile settings)
-- The campaign steps that contain a resource's URL are also found automatically on the Resources page; the
-- where_used text here names the places that are not campaign steps.
--
-- IDEMPOTENT: one row per (org, url) (unique index hub_resources_org_url); a second run adds nothing.
--
-- ROLLBACK:
--   delete from public.hub_resources
--   where org_id = '00000000-0000-0000-0000-000000000001'
--     and url in ('https://university.neuroprogeny.com/book/neuro-progeny/discovery-call',
--                 'https://university.neuroprogeny.com/checkout/capacity-protocol',
--                 'https://university.neuroprogeny.com',
--                 'https://transitions.neuroprogeny.com',
--                 'https://neuroprogeny.com/courses/free')
--     and not exists (select 1 from public.hub_resource_links l where l.resource_id = hub_resources.id);
--   (A resource that has already been shared to a contact is kept: retire it on the Resources page instead.)

do $seed$
declare
  np constant uuid := '00000000-0000-0000-0000-000000000001';
  owner uuid;
  last_order int;
begin
  select id into owner from auth.users where lower(email) = 'cameron@neuroprogeny.com';
  if owner is null then
    raise exception 'resource seed stopped: no login for cameron@neuroprogeny.com in this project';
  end if;
  select coalesce(max(sort_order), -1) into last_order from public.hub_resources where org_id = np;

  insert into public.hub_resources (org_id, name, description, kind, url, owner_id, where_used, sort_order, created_by)
  select np, v.name, v.description, v.kind, v.url, owner, v.where_used, last_order + v.n, owner
  from (values
    (1, 'Discovery call booking', 'Book a discovery call with Neuro Progeny.', 'booking_link',
        'https://university.neuroprogeny.com/book/neuro-progeny/discovery-call',
        'Org setting discovery_booking_url; the discovery call booking route (Sales, Discovery call Scheduled)'),
    (2, 'Capacity Protocol checkout', 'Checkout for the Capacity Protocol.', 'checkout_link',
        'https://university.neuroprogeny.com/checkout/capacity-protocol', null),
    (3, 'University home', 'The Neuro Progeny University home page.', 'program_page',
        'https://university.neuroprogeny.com', null),
    (4, 'Transitions quiz', 'The Transitions quiz on its own site.', 'quiz',
        'https://transitions.neuroprogeny.com', 'Website intake: the np-transitions-quiz form posts from this site'),
    (5, 'Free nervous system training course', 'The free course offered to podcast listeners.', 'program_page',
        'https://neuroprogeny.com/courses/free', 'Podcast guest sheet call to action; Settings, Guest profile')
  ) as v(n, name, description, kind, url, where_used)
  on conflict (org_id, url) where url is not null do nothing;
end
$seed$;

-- READ-BACK (expect 5 rows, kind as above, owner = Cameron, archived_at null):
-- select r.name, r.kind, r.url, u.email as owner, r.archived_at
-- from public.hub_resources r left join auth.users u on u.id = r.owner_id
-- where r.org_id = '00000000-0000-0000-0000-000000000001' and r.url is not null order by r.sort_order;
