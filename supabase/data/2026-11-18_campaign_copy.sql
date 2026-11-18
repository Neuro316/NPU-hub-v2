-- 2026-11-18_campaign_copy.sql  (data, Running List c05; not a migration: no schema change)
--
-- STATUS: PROPOSED 2026-11-18. NOT RUN. Needs a go. Production (htfrfaxlcuyawtlztxxm) only: the step ids are
-- production's. Nothing here switches anything on: every campaign stays draft, live_enabled stays false, every route
-- stays inactive.
--
-- WHERE THE COPY LIVES (read only on production, 2026-11-18):
--   funnel_campaigns   (org_id, name, status, live_enabled, sequence_id): the 7 campaigns, all status 'draft',
--                      live_enabled false, brand 'np'
--   sequences          (id, name, is_active): one per campaign. is_active is true on all 7; it is a legacy column
--                      the marketing engine does not read (the engine sends only for funnel_campaigns.status
--                      'active'), and no sequence has an enrollment
--   sequence_steps     (id, sequence_id, step_order, channel, kind, step_type, delay_minutes, subject, body): the 20
--                      email steps. body is HTML: <p>Hi {{first_name}},</p>, the paragraphs, the button
--                      <p><a href="...">...</a></p> (except Client onboarding "Checking in"), <p>Cameron</p>.
--                      kind is 'marketing' or 'service' (check constraint): the marketing/service flag
--   org_settings 'hub_send_policy' (from_address, from_domain, reply_to): the ONE sender for every campaign email of
--                      the org (src/lib/marketing/engine.ts uses policy.from_address). Today
--                      "Cameron Allen <hello@mail.neuroprogeny.com>", domain mail.neuroprogeny.com, reply_to
--                      cameron.allen@neuroprogeny.com
--   campaign_routes, campaign_enrollments, sequence_enrollments, message_sends, send_log: all empty or inactive for
--                      these 7 (no route active, no enrollment, no send of any kind)
--
-- WHAT IT CHANGES:
--   A. The body of 13 emails, matched by campaign and subject AND by the exact current body (each body below was
--      checked against production by md5 on 2026-11-18). Greeting, button line, sign-off, subject, links, timing and
--      {{first_name}} are unchanged; only the paragraphs between greeting and button change (Cameron's approved
--      copy).
--   B1. Client onboarding's 4 email steps: kind 'marketing' -> 'service' (Shane, 2026-11-18), so every paying client
--      gets them without a marketing opt-in. Service emails carry no unsubscribe footer (src/lib/marketing/render.ts).
--   B2. The org's sender: NOT changed (c_switch_sender is false). Decided 2026-11-18 by Shane: the sender stays
--      Cameron Allen <hello@mail.neuroprogeny.com>; replies already go to cameron.allen@neuroprogeny.com (reply_to).
--      Switching the sender needs neuroprogeny.com verified in Resend first.
--   B3. Post-discovery follow-up: confirmed, no change. Its 3 enroll buttons ("Thank you for today", "A couple of days
--      after our call", "A simple picture of what we train") already link to
--      https://university.neuroprogeny.com/checkout/capacity-protocol. The 4th email, "Checking in one last time",
--      has no enroll button: its button books a follow-up call ({{discovery_booking_url}}). The block checks both.
--
-- GUARDS (any one aborts the whole file, nothing changed):
--   - the 7 campaigns are not found exactly once each, or any is not 'draft', or any has live_enabled true
--   - any campaign route for them is active, or any contact is enrolled in them
--   - any of their steps has a real send (message_sends with dry_run false)
--   - any of the 13 emails is not found exactly once by campaign and subject, or its body is not the expected text
--   - Client onboarding does not have exactly 4 email steps, all of the expected kind
--   - the Post-discovery buttons are not as described in B3
--   - the sender is not the expected current value (only when c_switch_sender is true)
--
-- ROLLBACK: set c_mode to 'rollback' below and run the file again. It restores the 13 bodies byte for byte, the 4
-- kinds to 'marketing' and the sender to "Cameron Allen <hello@mail.neuroprogeny.com>" / mail.neuroprogeny.com,
-- with the same guards (each body must be the new text, or nothing changes).

begin;

do $copy$
declare
  c_mode          constant text := 'apply';   -- 'apply', or 'rollback' to restore what this file changed
  c_switch_sender constant boolean := false;  -- false: leave the org sender as it is (B2, Shane 2026-11-18)
  v_org           constant uuid := '00000000-0000-0000-0000-000000000001';
  v_campaigns     constant text[] := array['Checkout recovery', 'Discovery booked', 'Discovery no-show',
                    'Post-discovery follow-up', 'Signed up, no purchase', 'Client onboarding', 'Drop-off nudge'];
  v_checkout      constant text := 'href="https://university.neuroprogeny.com/checkout/capacity-protocol"';
  v_old_from      constant text := 'Cameron Allen <hello@mail.neuroprogeny.com>';
  v_old_domain    constant text := 'mail.neuroprogeny.com';
  v_new_from      constant text := 'Cameron Allen <cameron.allen@neuroprogeny.com>';
  v_new_domain    constant text := 'neuroprogeny.com';
  r record;
  n int;
  v_policy jsonb;
begin
  if c_mode not in ('apply', 'rollback') then raise exception 'campaign copy: c_mode must be apply or rollback'; end if;

  -- the campaigns: present once each, draft, not live, not routed, nobody enrolled, nothing sent
  select count(*) into n from public.funnel_campaigns where org_id = v_org and name = any(v_campaigns);
  if n <> 7 then raise exception 'campaign copy: expected the 7 campaigns once each, found %', n; end if;
  if exists (select 1 from public.funnel_campaigns where org_id = v_org and name = any(v_campaigns)
              and (status <> 'draft' or live_enabled)) then
    raise exception 'campaign copy: a campaign is active or live; stop and look';
  end if;
  if exists (select 1 from public.campaign_routes r join public.funnel_campaigns f on f.id = r.campaign_id
              where f.org_id = v_org and f.name = any(v_campaigns) and r.active) then
    raise exception 'campaign copy: a campaign route is active; stop and look';
  end if;
  if exists (select 1 from public.campaign_enrollments e join public.funnel_campaigns f on f.id = e.campaign_id
              where f.org_id = v_org and f.name = any(v_campaigns))
     or exists (select 1 from public.sequence_enrollments e join public.funnel_campaigns f on f.sequence_id = e.sequence_id
              where f.org_id = v_org and f.name = any(v_campaigns)) then
    raise exception 'campaign copy: a contact is enrolled; stop and look';
  end if;
  if exists (select 1 from public.message_sends m
              join public.sequence_steps s on m.source_step_id = s.id::text
              join public.funnel_campaigns f on f.sequence_id = s.sequence_id
              where f.org_id = v_org and f.name = any(v_campaigns) and m.dry_run = false) then
    raise exception 'campaign copy: an email from these campaigns has been sent; stop and look';
  end if;

  -- A. the 13 bodies
  for r in
    select * from (values
      ($q$b8906640-caed-4716-95b4-15b1e4a51b84$q$::uuid, $q$Checkout recovery$q$, $q$Your spot is still open$q$,
       $q$<p>Hi {{first_name}},</p><p>I noticed you started enrolling earlier and didn't quite finish. That happens, and your spot is still here.</p><p>The people who join us usually want the same thing: more good days. Waking up with energy, staying steady when life gets loud, and having more of yourself left for the people you love at the end of the day.</p><p>If you're ready, you can pick up right where you left off.</p><p><a href="{{checkout_link}}">Finish enrolling</a></p><p>Cameron</p>$q$,
       $q$<p>Hi {{first_name}},</p><p>I noticed you started enrolling earlier and didn't quite finish. That happens, and your spot is still here.</p><p>Most people who start the Capacity Protocol already know what they want. They want one or more parts of their life to line up with what matters to them, whether that's their relationships, their work, their money, their health or the way they see themselves, and something keeps pulling them back into old patterns instead. We measure what your nervous system is doing in real time, so you can see that friction, train past it, and choose and architect the life you want rather than coping with the one you have.</p><p>If you're ready, you can pick up right where you left off.</p><p><a href="{{checkout_link}}">Finish enrolling</a></p><p>Cameron</p>$q$),
      ($q$adda2539-cc36-4f59-bad5-a0a627c65d14$q$::uuid, $q$Checkout recovery$q$, $q$Still thinking it over?$q$,
       $q$<p>Hi {{first_name}},</p><p>Most people who pause at checkout are weighing one thing: will this really fit into my life?</p><p>This training is built around small daily practices that fit into a normal day. Picture a calmer morning, an easier conversation, a better night. That's the kind of ordinary moment we're training for.</p><p>Your enrollment is saved and waiting for you.</p><p><a href="{{checkout_link}}">Finish enrolling</a></p><p>Cameron</p>$q$,
       $q$<p>Hi {{first_name}},</p><p>Most people who pause at checkout are weighing one thing: will this really fit into my life?</p><p>The Capacity Protocol is built for real life. Each day you spend a few minutes on VR biofeedback, a short reflection and your journal, and each week you join a coaching call with me and a community of people doing the same work. You see your progress in your own data, because you cannot change what you cannot see.</p><p>Your enrollment is saved and waiting for you.</p><p><a href="{{checkout_link}}">Finish enrolling</a></p><p>Cameron</p>$q$),
      ($q$be379b89-b31f-426b-89d1-206f949db4e3$q$::uuid, $q$Checkout recovery$q$, $q$My last note about your enrollment$q$,
       $q$<p>Hi {{first_name}},</p><p>I don't want to crowd your inbox, so this is my last note about finishing your enrollment.</p><p>Picture a few months from now: more energy at the end of the day, more patience when things get busy, and a body that feels like it's on your side. That's what this training is for.</p><p>If that sounds like the life you want, your spot is here.</p><p><a href="{{checkout_link}}">Finish enrolling</a></p><p>Cameron</p>$q$,
       $q$<p>Hi {{first_name}},</p><p>I don't want to crowd your inbox, so this is my last note about finishing your enrollment.</p><p>Picture a few months from now. You sleep better, your focus is back, and you show up in your relationships and your work as the person you know you are. Your choices about money, time and how you live come from clarity instead of pressure. That is what the Capacity Protocol is for.</p><p>If that sounds like the life you want, your spot is here.</p><p><a href="{{checkout_link}}">Finish enrolling</a></p><p>Cameron</p>$q$),
      ($q$55261185-bb64-4080-b0e0-040c5e876185$q$::uuid, $q$Discovery booked$q$, $q$Looking forward to our call$q$,
       $q$<p>Hi {{first_name}},</p><p>Thanks for booking a discovery call. I'm really glad you did.</p><p>Here's what to expect. It's a relaxed conversation. I'll ask what your days feel like right now and what you'd love them to feel like. Then I'll share how our training works and whether it's a good fit for you. No pressure and no homework.</p><p>One thing to think about before we talk: if your days felt better a few months from now, what's the first thing you'd notice?</p><p>If the time no longer works, you can choose a new one here.</p><p><a href="{{discovery_booking_url}}">Pick a time that works</a></p><p>Cameron</p>$q$,
       $q$<p>Hi {{first_name}},</p><p>Thanks for booking a discovery call. I'm really glad you did.</p><p>Here's what to expect. It's a relaxed conversation. I'll ask what is working in your life right now and where you feel stuck, whether that's in your relationships, your work, your health or how you feel about yourself. Then I'll share how the Capacity Protocol works and whether it's a good fit for you. There's no pressure and no homework.</p><p>One thing to think about before we talk: if your life lined up with what you genuinely want, what is the first thing you would notice?</p><p>If the time no longer works, you can choose a new one here.</p><p><a href="{{discovery_booking_url}}">Pick a time that works</a></p><p>Cameron</p>$q$),
      ($q$86dde37e-ee7c-404a-8384-9971a8d0bd7d$q$::uuid, $q$Discovery no-show$q$, $q$We missed each other today$q$,
       $q$<p>Hi {{first_name}},</p><p>Looks like we missed each other for our call today. Days get full, and that's okay.</p><p>If you'd still like to talk, pick whatever time works best for you.</p><p><a href="{{discovery_booking_url}}">Pick a new time</a></p><p>Cameron</p>$q$,
       $q$<p>Hi {{first_name}},</p><p>It looks like we missed each other for our call today. Days get full, and that's okay.</p><p>If you'd still like to talk, pick whatever time works best for you.</p><p><a href="{{discovery_booking_url}}">Pick a new time</a></p><p>Cameron</p>$q$),
      ($q$1bfa29fd-4483-43a2-8e55-feea9470c975$q$::uuid, $q$Discovery no-show$q$, $q$Still here when you're ready$q$,
       $q$<p>Hi {{first_name}},</p><p>Just a quick note. The conversation is still open whenever the timing feels right. It's a relaxed call about what you'd like more of in your days.</p><p><a href="{{discovery_booking_url}}">Book a time</a></p><p>Cameron</p>$q$,
       $q$<p>Hi {{first_name}},</p><p>This is a quick note to say the conversation is still open whenever the timing feels right. It's a relaxed call about where you are now and the life you want to build.</p><p><a href="{{discovery_booking_url}}">Book a time</a></p><p>Cameron</p>$q$),
      ($q$94ac2e78-cc3d-4cd3-b66e-6c6c087ca364$q$::uuid, $q$Post-discovery follow-up$q$, $q$Thank you for today$q$,
       $q$<p>Hi {{first_name}},</p><p>Thank you for your time today. I really enjoyed our conversation.</p><p>We talked about what your days feel like right now and what you'd love more of. What you shared is exactly what this training is built for, and I'd love to help you build it one small step at a time.</p><p>When you're ready to start, you can enroll here.</p><p><a href="https://university.neuroprogeny.com/checkout/capacity-protocol">Enroll now</a></p><p>Cameron</p>$q$,
       $q$<p>Hi {{first_name}},</p><p>Thank you for your time today. I really enjoyed our conversation.</p><p>We talked about where you are now and the life you want to be living. What you shared is exactly what the Capacity Protocol is built for, and I'd love to help you choose and architect it with clarity instead of force.</p><p>When you're ready to start, you can enroll here.</p><p><a href="https://university.neuroprogeny.com/checkout/capacity-protocol">Enroll now</a></p><p>Cameron</p>$q$),
      ($q$d02307ff-09b7-41f9-a797-e609f2cae87a$q$::uuid, $q$Post-discovery follow-up$q$, $q$A couple of days after our call$q$,
       $q$<p>Hi {{first_name}},</p><p>A couple of days out from our call, I wanted to check in.</p><p>The people who get the most from this training start while their reasons are still fresh. Small daily practice is how capacity grows. Imagine more steady days, more energy, and more room to enjoy the people around you.</p><p>If you're ready, here's where to begin.</p><p><a href="https://university.neuroprogeny.com/checkout/capacity-protocol">Enroll now</a></p><p>Cameron</p>$q$,
       $q$<p>Hi {{first_name}},</p><p>A couple of days out from our call, I wanted to check in.</p><p>The people who get the most from the Capacity Protocol start while their reasons are still fresh. We begin by measuring your nervous system, so you have a clear starting point, and from there you watch your own data change as you train. Small daily practice is how capacity grows.</p><p>If you're ready, here's where to begin.</p><p><a href="https://university.neuroprogeny.com/checkout/capacity-protocol">Enroll now</a></p><p>Cameron</p>$q$),
      ($q$6fa49f1f-79f2-4b15-9d46-91cb15308e63$q$::uuid, $q$Post-discovery follow-up$q$, $q$A simple picture of what we train$q$,
       $q$<p>Hi {{first_name}},</p><p>Here's a simple way to picture it. Right now, a hard day can take everything you've got. With more capacity, the same day still happens, but there's more of you left at the end of it. More patience, more presence, more you.</p><p>That's what we train together.</p><p><a href="https://university.neuroprogeny.com/checkout/capacity-protocol">Enroll now</a></p><p>Cameron</p>$q$,
       $q$<p>Hi {{first_name}},</p><p>Here's a simple way to picture it. When what you want, what you value and what your mind keeps telling you pull in different directions, you feel the friction somewhere in your life, maybe in your relationships, your work, your choices about money and time, or how you see yourself. When they line up, that friction drops, and you can choose and architect the life you want with clarity.</p><p>That's what we train together in the Capacity Protocol.</p><p><a href="https://university.neuroprogeny.com/checkout/capacity-protocol">Enroll now</a></p><p>Cameron</p>$q$),
      ($q$4614d2cf-6897-4770-8722-63a696cb7aa5$q$::uuid, $q$Signed up, no purchase$q$, $q$Glad you joined us$q$,
       $q$<p>Hi {{first_name}},</p><p>Thanks for creating your account with Neuro Progeny University. I'm glad you're here.</p><p>A lot of people sign up because they want their days to feel a little lighter: better sleep, steadier energy, more patience with the people they love. If that sounds like you, the best next step is a short conversation with me. We'll talk about what you want more of and whether our training is a good fit.</p><p><a href="{{discovery_booking_url}}">Book a discovery call</a></p><p>Cameron</p>$q$,
       $q$<p>Hi {{first_name}},</p><p>Thanks for creating your account with Neuro Progeny University. I'm glad you're here.</p><p>A lot of people sign up because something in their life isn't lining up. They want better sleep and sharper focus, closer relationships, work that feels like their own, or simply to feel like themselves again. If that sounds like you, the best next step is a short conversation with me. We'll talk about the life you want and whether the Capacity Protocol is a good fit.</p><p><a href="{{discovery_booking_url}}">Book a discovery call</a></p><p>Cameron</p>$q$),
      ($q$8229fe6f-09be-4d5e-b1a7-f00f1759d7cb$q$::uuid, $q$Signed up, no purchase$q$, $q$What would you want more of?$q$,
       $q$<p>Hi {{first_name}},</p><p>Here's a question I love asking: if the next few months went really well, what would you want more of? More energy? Easier evenings? Feeling like yourself again?</p><p>Whatever your answer is, that's exactly what we'd talk about on a discovery call. It's relaxed and there's no pressure.</p><p><a href="{{discovery_booking_url}}">Book a discovery call</a></p><p>Cameron</p>$q$,
       $q$<p>Hi {{first_name}},</p><p>Here's a question I love asking: if the next few months went really well, what would be different in your relationships, your work, your health or the way you feel about yourself?</p><p>Whatever your answer is, that's exactly what we'd talk about on a discovery call. It's relaxed and there's no pressure.</p><p><a href="{{discovery_booking_url}}">Book a discovery call</a></p><p>Cameron</p>$q$),
      ($q$037d02fc-24bf-4767-b32d-93990347f46c$q$::uuid, $q$Signed up, no purchase$q$, $q$One last invitation$q$,
       $q$<p>Hi {{first_name}},</p><p>I'll keep this short. If you've been curious about what training your capacity could look like in your own life, I'd love to talk with you.</p><p>Pick a time that works for you.</p><p><a href="{{discovery_booking_url}}">Book a discovery call</a></p><p>Cameron</p>$q$,
       $q$<p>Hi {{first_name}},</p><p>I'll keep this short. If you've been curious about what it would look like to choose and architect the life you want instead of putting it off, I'd love to talk with you.</p><p>Pick a time that works for you.</p><p><a href="{{discovery_booking_url}}">Book a discovery call</a></p><p>Cameron</p>$q$),
      ($q$2700829f-b496-42e9-a045-47379e5d1484$q$::uuid, $q$Client onboarding$q$, $q$Welcome, I'm so glad you're here$q$,
       $q$<p>Hi {{first_name}},</p><p>Welcome. I'm really glad you're here.</p><p>Everything in this training is built to grow your capacity a little at a time, so there's more of you available for the days you care about. You don't need to do it all at once.</p><p>A good first step is to open your first lesson. It takes just a few minutes.</p><p><a href="https://university.neuroprogeny.com">Open your first lesson</a></p><p>Cameron</p>$q$,
       $q$<p>Hi {{first_name}},</p><p>Welcome. I'm really glad you're here.</p><p>Everything in the Capacity Protocol is built to bring what you want, what you value and how you think into alignment, a little at a time, in whichever parts of your life matter most to you right now. That is how you start to choose and architect the life you want. You don't need to do it all at once.</p><p>A good first step is to open your first lesson. It takes just a few minutes.</p><p><a href="https://university.neuroprogeny.com">Open your first lesson</a></p><p>Cameron</p>$q$)
    ) as v(step_id, campaign, subject, old_body, new_body)
  loop
    select count(*) into n from public.sequence_steps s
      join public.funnel_campaigns f on f.sequence_id = s.sequence_id
     where f.org_id = v_org and f.name = r.campaign and s.subject = r.subject and s.channel = 'email';
    if n <> 1 then raise exception 'campaign copy: "%" / "%" found % times (expected once)', r.campaign, r.subject, n; end if;
    perform 1 from public.sequence_steps s join public.funnel_campaigns f on f.sequence_id = s.sequence_id
     where s.id = r.step_id and f.org_id = v_org and f.name = r.campaign and s.subject = r.subject;
    if not found then raise exception 'campaign copy: "%" / "%" is not step %', r.campaign, r.subject, r.step_id; end if;

    if c_mode = 'apply' then
      update public.sequence_steps set body = r.new_body where id = r.step_id and body = r.old_body;
    else
      update public.sequence_steps set body = r.old_body where id = r.step_id and body = r.new_body;
    end if;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'campaign copy: "%" / "%" does not hold the expected % text; nothing changed', r.campaign, r.subject,
      case when c_mode = 'apply' then 'current' else 'new' end; end if;
  end loop;

  -- B1. Client onboarding is service mail
  select count(*) into n from public.sequence_steps s join public.funnel_campaigns f on f.sequence_id = s.sequence_id
   where f.org_id = v_org and f.name = 'Client onboarding' and s.channel = 'email';
  if n <> 4 then raise exception 'campaign copy: Client onboarding has % email steps, expected 4', n; end if;
  update public.sequence_steps s set kind = case when c_mode = 'apply' then 'service' else 'marketing' end
    from public.funnel_campaigns f
   where f.sequence_id = s.sequence_id and f.org_id = v_org and f.name = 'Client onboarding' and s.channel = 'email'
     and s.kind = case when c_mode = 'apply' then 'marketing' else 'service' end;
  get diagnostics n = row_count;
  if n <> 4 then raise exception 'campaign copy: Client onboarding kinds were not all as expected (% of 4 changed)', n; end if;

  -- B3. Post-discovery buttons: 3 enroll buttons to the checkout, the 4th books a call (checked, not changed)
  select count(*) into n from public.sequence_steps s join public.funnel_campaigns f on f.sequence_id = s.sequence_id
   where f.org_id = v_org and f.name = 'Post-discovery follow-up' and s.channel = 'email' and position(v_checkout in s.body) > 0
     and s.subject in ('Thank you for today', 'A couple of days after our call', 'A simple picture of what we train');
  if n <> 3 then raise exception 'campaign copy: % of 3 Post-discovery enroll buttons point at the checkout', n; end if;
  if not exists (select 1 from public.sequence_steps s join public.funnel_campaigns f on f.sequence_id = s.sequence_id
                  where f.org_id = v_org and f.name = 'Post-discovery follow-up' and s.subject = 'Checking in one last time'
                    and position('{{discovery_booking_url}}' in s.body) > 0 and position(v_checkout in s.body) = 0) then
    raise exception 'campaign copy: Post-discovery "Checking in one last time" is not the booking-call email expected';
  end if;

  -- B2. the org sender
  if c_switch_sender then
    select setting_value into v_policy from public.org_settings where org_id = v_org and setting_key = 'hub_send_policy';
    if v_policy is null then raise exception 'campaign copy: hub_send_policy is missing'; end if;
    if c_mode = 'apply' then
      if v_policy ->> 'from_address' is distinct from v_old_from or v_policy ->> 'from_domain' is distinct from v_old_domain then
        raise exception 'campaign copy: the sender is not the expected current value; stop and look';
      end if;
      update public.org_settings set setting_value = setting_value
          || jsonb_build_object('from_address', v_new_from, 'from_domain', v_new_domain), updated_at = now()
       where org_id = v_org and setting_key = 'hub_send_policy';
    else
      if v_policy ->> 'from_address' is distinct from v_new_from or v_policy ->> 'from_domain' is distinct from v_new_domain then
        raise exception 'campaign copy: the sender is not the value this file set; stop and look';
      end if;
      update public.org_settings set setting_value = setting_value
          || jsonb_build_object('from_address', v_old_from, 'from_domain', v_old_domain), updated_at = now()
       where org_id = v_org and setting_key = 'hub_send_policy';
    end if;
  end if;

  -- nothing switched on
  if exists (select 1 from public.funnel_campaigns where org_id = v_org and name = any(v_campaigns) and (status <> 'draft' or live_enabled)) then
    raise exception 'campaign copy: a campaign is no longer draft; stop and look';
  end if;
end $copy$;

-- READ-BACK: the 20 steps (subject, kind, a short start of the body) and the sender
select f.name as campaign, s.step_order, s.subject, s.kind, left(regexp_replace(s.body, '<[^>]+>', ' ', 'g'), 120) as body_start
  from public.sequence_steps s join public.funnel_campaigns f on f.sequence_id = s.sequence_id
 where f.org_id = '00000000-0000-0000-0000-000000000001'
   and f.name in ('Checkout recovery', 'Discovery booked', 'Discovery no-show', 'Post-discovery follow-up',
                  'Signed up, no purchase', 'Client onboarding', 'Drop-off nudge')
 order by f.name, s.step_order;
select setting_value ->> 'from_address' as from_address, setting_value ->> 'from_domain' as from_domain,
       setting_value ->> 'reply_to' as reply_to
  from public.org_settings where org_id = '00000000-0000-0000-0000-000000000001' and setting_key = 'hub_send_policy';

commit;
