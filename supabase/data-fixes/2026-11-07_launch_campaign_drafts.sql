-- 2026-11-07_launch_campaign_drafts.sql  (data fix, not a migration: no schema change)
--
-- STATUS: PROPOSED. Not applied. Apply with Cameron's go, AFTER hub_231 and after the branch that reads
-- funnel_campaigns.goal.exit (src/lib/marketing/exits.ts) is deployed.
--
-- Creates four campaign DRAFTS for Neuro Progeny in the existing funnel_campaigns / sequences engine:
--
--   A  Checkout recovery          entry stage:<Enrolled / Checkout started>        emails at 1 h, 24 h, 72 h
--   B  Discovery booked           entry stage:<Sales / Discovery call Scheduled>   one welcome email at once
--   C  Post-discovery             entry stage:<Sales / Discovery Call>             same day, day 2, day 5, day 10
--   D  Signed up, no purchase     entry signup:university                          48 h, day 5, day 10
--
-- Exit rules live in goal.exit and are checked by the engine before every step (src/lib/marketing/exits.ts):
--   A  left_entry_stage (any other Enrolled stage, or out of Enrolled), payment since entry
--   B  booking_cancelled, left_entry_stage
--   C  stages Price quoted or Clarity Phase 1, payment since entry, reply
--   D  enrollment (any University enrollment), payment (any), reply
--
-- SENDS NOTHING AND ENROLLS NOBODY:
--   * every campaign is status 'draft' with live_enabled false; gate_live_sends stays off for the org;
--   * every route is active = false and activate_with_campaign = false, and raise_entry_event queues nothing
--     unless an ACTIVE route listens for the key;
--   * every step is email, kind 'marketing', so gate_check applies consent, suppression, quiet hours and the cap.
-- Sender and reply-to are the org's send policy, already "Cameron Allen <hello@mail.neuroprogeny.com>" with
-- reply-to cameron.allen@neuroprogeny.com (org_settings hub_send_policy); nothing here changes it.
--
-- Step delays are minutes AFTER THE PREVIOUS STEP. Steps start at step_order 1, so the first step's delay applies
-- (enroll() starts every enrollment at step 0, and the engine advances from the missing step 0 to step 1 with
-- that step's delay).
--
-- C's first email holds [[RECAP: ...]]. The engine never sends a step whose rendered text still holds a [[...]]
-- placeholder (it is skipped as unfilled_placeholder), so it cannot go out until it is edited.
--
-- ROLLBACK:
--   begin;
--   delete from public.campaign_routes where campaign_id in (select id from public.funnel_campaigns
--     where org_id = '00000000-0000-0000-0000-000000000001' and description like '%[launch-2026-11-07]%');
--   delete from public.sequence_steps where sequence_id in (select sequence_id from public.funnel_campaigns
--     where org_id = '00000000-0000-0000-0000-000000000001' and description like '%[launch-2026-11-07]%');
--   delete from public.sequences where campaign_id in (select id from public.funnel_campaigns
--     where org_id = '00000000-0000-0000-0000-000000000001' and description like '%[launch-2026-11-07]%');
--   delete from public.funnel_campaigns where org_id = '00000000-0000-0000-0000-000000000001'
--     and description like '%[launch-2026-11-07]%';
--   commit;

begin;

do $fix$
declare
  v_org      constant uuid := '00000000-0000-0000-0000-000000000001';
  v_actor    constant uuid := '22456608-5f7d-495e-af02-7037fea125cc';  -- Cameron, as on earlier data fixes
  v_enrolled constant uuid := '51cab093-2b0a-4652-a9c0-9fb10ccf282d';
  v_checkout constant uuid := 'a623ec21-0bae-45b7-80da-b22d944f03bf';  -- Enrolled / Checkout started
  v_sales    constant uuid := 'd2aa430f-84fb-45e1-be3c-95958403d4d6';
  v_dscall_s constant uuid := '22675e26-60f7-4aa0-8915-730bc23ba038';  -- Sales / Discovery call Scheduled
  v_dscall   constant uuid := 'e922e1ba-e304-4c5f-989d-892139705295';  -- Sales / Discovery Call
  v_quoted   constant uuid := 'ac06b5d8-38de-494d-b853-a96262dc3fc9';  -- Sales / Price quoted
  v_clarity1 constant uuid := '64be93a2-feed-418d-a2d1-9849473d7e2d';  -- Sales / Clarity Phase 1
  c_tag      constant text := ' [launch-2026-11-07]';
  -- the copy, generated from one source so the em dash and banned-word check ran on every subject and body
  def jsonb;
  c jsonb;
  st jsonb;
  v_camp uuid;
  v_seq uuid;
  i int;
  n_camp int := 0;
  n_step int := 0;
  n_route int := 0;
begin
  -- every stage named above must still be live and in the pipeline it is listed under
  if (select count(*) from public.pipeline_stages s where s.archived_at is null and s.org_id = v_org and (
        (s.id = v_checkout and s.pipeline_id = v_enrolled) or (s.pipeline_id = v_sales and s.id in (v_dscall_s, v_dscall, v_quoted, v_clarity1)))) <> 5 then
    raise exception 'launch drafts: a stage moved or was archived; stop and look';
  end if;
  if exists (select 1 from public.funnel_campaigns where org_id = v_org and description like '%' || btrim(c_tag) || '%') then
    raise exception 'launch drafts: already created';
  end if;

  def := $copy$[
 {
  "name": "Checkout recovery",
  "source": "stage:a623ec21-0bae-45b7-80da-b22d944f03bf",
  "pipeline": "51cab093-2b0a-4652-a9c0-9fb10ccf282d",
  "stage": "a623ec21-0bae-45b7-80da-b22d944f03bf",
  "description": "Someone reached Checkout started in Enrolled and has not paid. Three emails, each pointing to finishing enrollment.",
  "exit": {
   "left_entry_stage": true,
   "payment": "since_entry"
  },
  "steps": [
   {
    "delay": 60,
    "subject": "Your spot is still open",
    "body": "<p>Hi {{first_name}},</p><p>I noticed you started enrolling earlier and didn't quite finish. That happens, and your spot is still here.</p><p>The people who join us usually want the same thing: more good days. Waking up with energy, staying steady when life gets loud, and having more of yourself left for the people you love at the end of the day.</p><p>If you're ready, you can pick up right where you left off.</p><p><a href=\"https://university.neuroprogeny.com/checkout/capacity-protocol\">Finish enrolling</a></p><p>Cameron</p>"
   },
   {
    "delay": 1380,
    "subject": "Still thinking it over?",
    "body": "<p>Hi {{first_name}},</p><p>Most people who pause at checkout are weighing one thing: will this really fit into my life?</p><p>This training is built around small daily practices that fit into a normal day. Picture a calmer morning, an easier conversation, a better night. That's the kind of ordinary moment we're training for.</p><p>Your enrollment is saved and waiting for you.</p><p><a href=\"https://university.neuroprogeny.com/checkout/capacity-protocol\">Finish enrolling</a></p><p>Cameron</p>"
   },
   {
    "delay": 2880,
    "subject": "My last note about your enrollment",
    "body": "<p>Hi {{first_name}},</p><p>I don't want to crowd your inbox, so this is my last note about finishing your enrollment.</p><p>Picture a few months from now: more energy at the end of the day, more patience when things get busy, and a body that feels like it's on your side. That's what this training is for.</p><p>If that sounds like the life you want, your spot is here.</p><p><a href=\"https://university.neuroprogeny.com/checkout/capacity-protocol\">Finish enrolling</a></p><p>Cameron</p>"
   }
  ]
 },
 {
  "name": "Discovery booked",
  "source": "stage:22675e26-60f7-4aa0-8915-730bc23ba038",
  "pipeline": "d2aa430f-84fb-45e1-be3c-95958403d4d6",
  "stage": "22675e26-60f7-4aa0-8915-730bc23ba038",
  "description": "A discovery call is scheduled. One welcome email at once. No reminder: the University booking flow already sends a 24 hour reminder for bookings made through it, and this stage carries no call time to schedule one from.",
  "exit": {
   "booking_cancelled": true,
   "left_entry_stage": true
  },
  "steps": [
   {
    "delay": 0,
    "subject": "Looking forward to our call",
    "body": "<p>Hi {{first_name}},</p><p>Thanks for booking a discovery call. I'm really glad you did.</p><p>Here's what to expect. It's a relaxed conversation. I'll ask what your days feel like right now and what you'd love them to feel like. Then I'll share how our training works and whether it's a good fit for you. No pressure and no homework.</p><p>One thing to think about before we talk: if your days felt better a few months from now, what's the first thing you'd notice?</p><p>If the time no longer works, you can choose a new one here.</p><p><a href=\"https://api.leadconnectorhq.com/widget/bookings/cameron-allen-personal-calendar-nznqif3gc\">Pick a time that works</a></p><p>Cameron</p>"
   }
  ]
 },
 {
  "name": "Post-discovery follow-up",
  "source": "stage:e922e1ba-e304-4c5f-989d-892139705295",
  "pipeline": "d2aa430f-84fb-45e1-be3c-95958403d4d6",
  "stage": "e922e1ba-e304-4c5f-989d-892139705295",
  "description": "After the discovery call. A same day thank-you with a recap Cameron writes, then day 2, day 5 and day 10.",
  "exit": {
   "stages": [
    "ac06b5d8-38de-494d-b853-a96262dc3fc9",
    "64be93a2-feed-418d-a2d1-9849473d7e2d"
   ],
   "payment": "since_entry",
   "reply": true
  },
  "steps": [
   {
    "delay": 60,
    "subject": "Thank you for today",
    "body": "<p>Hi {{first_name}},</p><p>Thank you for your time today. I really enjoyed our conversation.</p><p>[[RECAP: two or three sentences on what we talked about and what you want more of]]</p><p>When you're ready to start, you can enroll here.</p><p><a href=\"https://university.neuroprogeny.com/checkout/capacity-protocol\">Enroll now</a></p><p>Cameron</p>"
   },
   {
    "delay": 2820,
    "subject": "A couple of days after our call",
    "body": "<p>Hi {{first_name}},</p><p>A couple of days out from our call, I wanted to check in.</p><p>The people who get the most from this training start while their reasons are still fresh. Small daily practice is how capacity grows. Imagine more steady days, more energy, and more room to enjoy the people around you.</p><p>If you're ready, here's where to begin.</p><p><a href=\"https://university.neuroprogeny.com/checkout/capacity-protocol\">Enroll now</a></p><p>Cameron</p>"
   },
   {
    "delay": 4320,
    "subject": "A simple picture of what we train",
    "body": "<p>Hi {{first_name}},</p><p>Here's a simple way to picture it. Right now, a hard day can take everything you've got. With more capacity, the same day still happens, but there's more of you left at the end of it. More patience, more presence, more you.</p><p>That's what we train together.</p><p><a href=\"https://university.neuroprogeny.com/checkout/capacity-protocol\">Enroll now</a></p><p>Cameron</p>"
   },
   {
    "delay": 7200,
    "subject": "Checking in one last time",
    "body": "<p>Hi {{first_name}},</p><p>It's been about ten days since we talked, and I wanted to check in one last time.</p><p>If now isn't the right moment, that's completely okay. If you have questions or want to talk it through again, grab a time that suits you.</p><p><a href=\"https://api.leadconnectorhq.com/widget/bookings/cameron-allen-personal-calendar-nznqif3gc\">Book a follow-up call</a></p><p>Cameron</p>"
   }
  ]
 },
 {
  "name": "Signed up, no purchase",
  "source": "signup:university",
  "pipeline": null,
  "stage": null,
  "description": "A new University account seen in the Hub, with no enrollment or payment after 48 hours. Three emails, each inviting a discovery call.",
  "exit": {
   "enrollment": "any",
   "payment": "any",
   "reply": true
  },
  "steps": [
   {
    "delay": 2880,
    "subject": "Glad you joined us",
    "body": "<p>Hi {{first_name}},</p><p>Thanks for creating your account with Neuro Progeny University. I'm glad you're here.</p><p>A lot of people sign up because they want their days to feel a little lighter: better sleep, steadier energy, more patience with the people they love. If that sounds like you, the best next step is a short conversation with me. We'll talk about what you want more of and whether our training is a good fit.</p><p><a href=\"https://api.leadconnectorhq.com/widget/bookings/cameron-allen-personal-calendar-nznqif3gc\">Book a discovery call</a></p><p>Cameron</p>"
   },
   {
    "delay": 4320,
    "subject": "What would you want more of?",
    "body": "<p>Hi {{first_name}},</p><p>Here's a question I love asking: if the next few months went really well, what would you want more of? More energy? Easier evenings? Feeling like yourself again?</p><p>Whatever your answer is, that's exactly what we'd talk about on a discovery call. It's relaxed and there's no pressure.</p><p><a href=\"https://api.leadconnectorhq.com/widget/bookings/cameron-allen-personal-calendar-nznqif3gc\">Book a discovery call</a></p><p>Cameron</p>"
   },
   {
    "delay": 7200,
    "subject": "One last invitation",
    "body": "<p>Hi {{first_name}},</p><p>I'll keep this short. If you've been curious about what training your capacity could look like in your own life, I'd love to talk with you.</p><p>Pick a time that works for you.</p><p><a href=\"https://api.leadconnectorhq.com/widget/bookings/cameron-allen-personal-calendar-nznqif3gc\">Book a discovery call</a></p><p>Cameron</p>"
   }
  ]
 }
]$copy$::jsonb;

  for c in select * from jsonb_array_elements(def) loop
    insert into public.funnel_campaigns (org_id, name, description, status, entry_pipeline_id, entry_stage_id, goal, live_enabled, created_by)
    values (v_org, c ->> 'name', (c ->> 'description') || c_tag, 'draft', (c ->> 'pipeline')::uuid, (c ->> 'stage')::uuid,
            jsonb_build_object('exit', c -> 'exit'), false, v_actor)
    returning id into v_camp;
    n_camp := n_camp + 1;

    insert into public.sequences (org_id, name, campaign_id, created_by, is_active)
    values (v_org, c ->> 'name', v_camp, v_actor, true)
    returning id into v_seq;
    update public.funnel_campaigns set sequence_id = v_seq where id = v_camp;

    i := 0;
    for st in select * from jsonb_array_elements(c -> 'steps') loop
      i := i + 1;
      if (st ->> 'body') ~ (chr(8212) || '|&mdash;') or (st ->> 'subject') ~ (chr(8212) || '|&mdash;') then
        raise exception 'launch drafts: an em dash in % step %', c ->> 'name', i;
      end if;
      insert into public.sequence_steps (sequence_id, step_order, channel, delay_minutes, subject, body, kind, step_type)
      values (v_seq, i, 'email', (st ->> 'delay')::int, st ->> 'subject', st ->> 'body', 'marketing', 'message');
      n_step := n_step + 1;
    end loop;

    insert into public.campaign_routes (org_id, source_key, campaign_id, active, activate_with_campaign)
    values (v_org, c ->> 'source', v_camp, false, false);
    n_route := n_route + 1;
  end loop;

  if n_camp <> 4 or n_step <> 11 or n_route <> 4 then
    raise exception 'launch drafts: made % campaigns, % steps, % routes; expected 4, 11, 4', n_camp, n_step, n_route;
  end if;
  if exists (select 1 from public.funnel_campaigns where org_id = v_org and description like '%' || btrim(c_tag) || '%'
              and (status <> 'draft' or live_enabled)) then
    raise exception 'launch drafts: a draft is not a draft';
  end if;
  if exists (select 1 from public.campaign_routes r join public.funnel_campaigns f on f.id = r.campaign_id
              where f.description like '%' || btrim(c_tag) || '%' and (r.active or r.activate_with_campaign)) then
    raise exception 'launch drafts: a route is armed';
  end if;
end $fix$;

-- report
select f.name, f.status, f.live_enabled, r.source_key, r.active as route_active, f.goal -> 'exit' as exit_rules,
       (select count(*) from public.sequence_steps s where s.sequence_id = f.sequence_id) as steps
  from public.funnel_campaigns f join public.campaign_routes r on r.campaign_id = f.id
 where f.org_id = '00000000-0000-0000-0000-000000000001' and f.description like '%[launch-2026-11-07]%'
 order by f.created_at;

commit;
