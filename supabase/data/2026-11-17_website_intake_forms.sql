-- 2026-11-17_website_intake_forms.sql  (data, not a migration: no schema change)
--
-- STATUS: PROPOSED 2026-11-17. NOT RUN. Needs a go. Production (htfrfaxlcuyawtlztxxm) only: the org and pipeline
-- ids are production's. Running List q08, Hub half: neuroprogeny.com posts its leads to POST /api/intake.
--
-- WHAT IT WRITES (Neuro Progeny org only):
--   1. form_definitions, status published:
--        np-website-contact    contact or inquiry form   source_key website:np-contact
--        np-transitions-quiz   the Transitions quiz       source_key website:np-transitions-quiz
--        np-newsletter         newsletter signup          source_key website:np-newsletter
--   2. org_settings 'hub_form_routes': each of the three forms places a contact it CREATED at Sales Pipeline
--      (legacy key 'default', d2aa430f-84fb-45e1-be3c-95958403d4d6) › New Lead, forward only, through
--      /api/cron/form-placement (ships in the same PR). The card shows the source as the form's source_key
--      (contacts.acquisition_source) and the stage move's source as form:<slug>.
--   3. org_settings 'hub_marketing_flags': intake switched on (engine is already on; nothing else changes).
--
-- CONSENTS: the wording is reused EXACTLY from the only consent text the Hub holds today, the draft lead device
-- sample-stress-quiz (lead_devices.manifest email_consent_text and sms_consent_text). Cameron must approve it for
-- these forms before the go; the email sentence begins with "Also", which reads oddly on the newsletter form. The
-- consent ids (email_marketing, sms_marketing) are new. Every box is unticked by default on the site.
--
-- SUCCESS MESSAGES are placeholders for Cameron to approve (short, no em dashes).
--
-- NOTHING IS SENT: no campaign route listens on these source keys, so route_and_enroll enrolls nobody. Adding a
-- route is a separate go.
--
-- ROLLBACK:
--   begin;
--   delete from public.form_definitions where org_id = '00000000-0000-0000-0000-000000000001'
--     and slug in ('np-website-contact', 'np-transitions-quiz', 'np-newsletter');
--     -- only when no form_submissions reference them; otherwise set status = 'archived' instead:
--     -- update public.form_definitions set status = 'archived' where slug in (...);
--   delete from public.org_settings where org_id = '00000000-0000-0000-0000-000000000001' and setting_key = 'hub_form_routes';
--   update public.org_settings set setting_value = setting_value - 'intake'
--    where org_id = '00000000-0000-0000-0000-000000000001' and setting_key = 'hub_marketing_flags';
--   commit;

begin;

do $fix$
declare
  v_org   constant uuid := '00000000-0000-0000-0000-000000000001';
  v_sales constant uuid := 'd2aa430f-84fb-45e1-be3c-95958403d4d6';
  v_email constant text := 'Also email me news and offers from Neuro Progeny. I can unsubscribe at any time.';
  v_sms   constant text := 'Text me reminders and offers from Neuro Progeny. Message and data rates may apply. Reply STOP to opt out.';
  v_dev   jsonb;
begin
  -- the consent text must still be exactly what the lead device holds
  select manifest into v_dev from public.lead_devices where slug = 'sample-stress-quiz';
  if v_dev is null or v_dev ->> 'email_consent_text' <> v_email or v_dev ->> 'sms_consent_text' <> v_sms then
    raise exception 'website forms: the reused consent text changed or is missing; stop and look';
  end if;
  if not exists (select 1 from public.pipeline_stages where pipeline_id = v_sales and name = 'New Lead' and archived_at is null)
     or not exists (select 1 from public.pipelines where id = v_sales and legacy_key = 'default' and org_id = v_org and archived_at is null) then
    raise exception 'website forms: Sales Pipeline › New Lead not found; stop and look';
  end if;
  if exists (select 1 from public.form_definitions where slug in ('np-website-contact', 'np-transitions-quiz', 'np-newsletter')) then
    raise exception 'website forms: already created';
  end if;
  if exists (select 1 from public.org_settings where org_id = v_org and setting_key = 'hub_form_routes') then
    raise exception 'website forms: hub_form_routes already set; stop and look';
  end if;

  insert into public.form_definitions (org_id, slug, name, status, version, fields, consents, source_key, success_message) values
  (v_org, 'np-website-contact', 'Website: contact form', 'published', 1,
   jsonb_build_array(
     jsonb_build_object('key', 'first_name', 'label', 'First name', 'type', 'text', 'required', true, 'maps_to', 'first_name'),
     jsonb_build_object('key', 'last_name', 'label', 'Last name', 'type', 'text', 'required', false, 'maps_to', 'last_name'),
     jsonb_build_object('key', 'email', 'label', 'Email', 'type', 'email', 'required', true, 'maps_to', 'email'),
     jsonb_build_object('key', 'phone', 'label', 'Phone', 'type', 'tel', 'required', false, 'maps_to', 'phone'),
     jsonb_build_object('key', 'message', 'label', 'Message', 'type', 'textarea', 'required', false)),
   jsonb_build_array(
     jsonb_build_object('id', 'email_marketing', 'channel', 'email', 'kind', 'marketing', 'text', v_email, 'required', false),
     jsonb_build_object('id', 'sms_marketing', 'channel', 'sms', 'kind', 'marketing', 'text', v_sms, 'required', false)),
   'website:np-contact', 'Thank you. We have your message and will be in touch soon.'),
  (v_org, 'np-transitions-quiz', 'Website: Transitions quiz', 'published', 1,
   jsonb_build_array(
     jsonb_build_object('key', 'first_name', 'label', 'First name', 'type', 'text', 'required', true, 'maps_to', 'first_name'),
     jsonb_build_object('key', 'last_name', 'label', 'Last name', 'type', 'text', 'required', false, 'maps_to', 'last_name'),
     jsonb_build_object('key', 'email', 'label', 'Email', 'type', 'email', 'required', true, 'maps_to', 'email'),
     jsonb_build_object('key', 'phone', 'label', 'Phone', 'type', 'tel', 'required', false, 'maps_to', 'phone'),
     jsonb_build_object('key', 'quiz_outcome', 'label', 'Quiz result', 'type', 'text', 'required', true)),
   jsonb_build_array(
     jsonb_build_object('id', 'email_marketing', 'channel', 'email', 'kind', 'marketing', 'text', v_email, 'required', false),
     jsonb_build_object('id', 'sms_marketing', 'channel', 'sms', 'kind', 'marketing', 'text', v_sms, 'required', false)),
   'website:np-transitions-quiz', 'Thank you. We have your answers.'),
  (v_org, 'np-newsletter', 'Website: newsletter signup', 'published', 1,
   jsonb_build_array(
     jsonb_build_object('key', 'first_name', 'label', 'First name', 'type', 'text', 'required', false, 'maps_to', 'first_name'),
     jsonb_build_object('key', 'last_name', 'label', 'Last name', 'type', 'text', 'required', false, 'maps_to', 'last_name'),
     jsonb_build_object('key', 'email', 'label', 'Email', 'type', 'email', 'required', true, 'maps_to', 'email'),
     jsonb_build_object('key', 'phone', 'label', 'Phone', 'type', 'tel', 'required', false, 'maps_to', 'phone')),
   jsonb_build_array(
     jsonb_build_object('id', 'email_marketing', 'channel', 'email', 'kind', 'marketing', 'text', v_email, 'required', true),
     jsonb_build_object('id', 'sms_marketing', 'channel', 'sms', 'kind', 'marketing', 'text', v_sms, 'required', false)),
   'website:np-newsletter', 'Thank you for signing up.');

  insert into public.org_settings (org_id, setting_key, setting_value) values (v_org, 'hub_form_routes', jsonb_build_object(
    'np-website-contact', jsonb_build_object('pipeline', 'default', 'stage', 'New Lead'),
    'np-transitions-quiz', jsonb_build_object('pipeline', 'default', 'stage', 'New Lead'),
    'np-newsletter', jsonb_build_object('pipeline', 'default', 'stage', 'New Lead')));

  update public.org_settings set setting_value = setting_value || jsonb_build_object('intake', 'on'), updated_at = now()
   where org_id = v_org and setting_key = 'hub_marketing_flags';
  if not found then raise exception 'website forms: hub_marketing_flags row missing; stop and look'; end if;

  if (select count(*) from public.form_definitions where org_id = v_org and status = 'published'
        and slug in ('np-website-contact', 'np-transitions-quiz', 'np-newsletter')) <> 3 then
    raise exception 'website forms: expected 3 published forms';
  end if;
  if exists (select 1 from public.campaign_routes where org_id = v_org and active
              and source_key in ('website:np-contact', 'website:np-transitions-quiz', 'website:np-newsletter')) then
    raise exception 'website forms: an active campaign route listens on a website source key; stop and look';
  end if;
end $fix$;

-- report
select slug, status, source_key, jsonb_array_length(fields) as fields, jsonb_array_length(consents) as consents
  from public.form_definitions where slug in ('np-website-contact', 'np-transitions-quiz', 'np-newsletter') order by slug;
select setting_key, setting_value from public.org_settings
 where org_id = '00000000-0000-0000-0000-000000000001' and setting_key in ('hub_form_routes', 'hub_marketing_flags');

commit;
