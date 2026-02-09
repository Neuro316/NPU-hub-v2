-- ============================================================
-- Seed: Neuro Progeny Immersive Mastermind Journey
-- Run AFTER 003_journey_builder.sql
-- Replace ORG_ID with your actual Neuro Progeny org UUID
-- ============================================================

-- First, get your org ID:
-- SELECT id FROM organizations WHERE slug = 'neuro-progeny';

-- Then replace 'NP_ORG_ID' below with that UUID before running.

DO $$
DECLARE
    np_org_id UUID;
    p_awareness UUID;
    p_consideration UUID;
    p_decision UUID;
    p_onboarding UUID;
    p_program UUID;
    p_outcomes UUID;
BEGIN
    -- Get NP org
    SELECT id INTO np_org_id FROM organizations WHERE slug = 'neuro-progeny';
    
    IF np_org_id IS NULL THEN
        RAISE EXCEPTION 'Neuro Progeny org not found';
    END IF;

    -- Create phases
    INSERT INTO journey_phases (org_id, phase_key, label, color, sort_order)
    VALUES
        (np_org_id, 'awareness', 'Awareness', '#8B5CF6', 0),
        (np_org_id, 'consideration', 'Consideration', '#3B82F6', 1),
        (np_org_id, 'decision', 'Decision', '#10B981', 2),
        (np_org_id, 'onboarding', 'Onboarding', '#F59E0B', 3),
        (np_org_id, 'program', 'Program (5 Weeks)', '#EF4444', 4),
        (np_org_id, 'outcomes', 'Outcomes & Follow-Up', '#386797', 5)
    RETURNING id INTO p_awareness;

    -- Get phase IDs
    SELECT id INTO p_awareness FROM journey_phases WHERE org_id = np_org_id AND phase_key = 'awareness';
    SELECT id INTO p_consideration FROM journey_phases WHERE org_id = np_org_id AND phase_key = 'consideration';
    SELECT id INTO p_decision FROM journey_phases WHERE org_id = np_org_id AND phase_key = 'decision';
    SELECT id INTO p_onboarding FROM journey_phases WHERE org_id = np_org_id AND phase_key = 'onboarding';
    SELECT id INTO p_program FROM journey_phases WHERE org_id = np_org_id AND phase_key = 'program';
    SELECT id INTO p_outcomes FROM journey_phases WHERE org_id = np_org_id AND phase_key = 'outcomes';

    -- AWARENESS cards
    INSERT INTO journey_cards (org_id, phase_id, title, description, status, row_index, sort_order) VALUES
        (np_org_id, p_awareness, 'Meta Ads', 'Facebook & Instagram ad campaigns targeting ICP segments', 'not_started', 0, 0),
        (np_org_id, p_awareness, 'Google Ads', 'Search and display campaigns for nervous system keywords', 'not_started', 0, 1),
        (np_org_id, p_awareness, 'Podcast Appearances', 'Guest appearances on health, wellness, and biohacking podcasts', 'not_started', 1, 0),
        (np_org_id, p_awareness, 'Social Content', 'Organic social media content across platforms', 'not_started', 1, 1),
        (np_org_id, p_awareness, 'YouTube Channel', 'Educational content on nervous system capacity', 'not_started', 2, 0),
        (np_org_id, p_awareness, 'Referral Program', 'Past participant and professional referral pathways', 'not_started', 2, 1);

    -- CONSIDERATION cards
    INSERT INTO journey_cards (org_id, phase_id, title, description, status, row_index, sort_order) VALUES
        (np_org_id, p_consideration, 'Capacity Quiz', 'NSCI assessment quiz with personalized results', 'not_started', 0, 0),
        (np_org_id, p_consideration, 'Quiz Results Email', 'Automated results delivery with capacity framing', 'not_started', 0, 1),
        (np_org_id, p_consideration, 'Nurture Sequence', 'Email sequence educating on capacity vs treatment', 'not_started', 1, 0),
        (np_org_id, p_consideration, 'Landing Pages', 'Program information pages with social proof', 'not_started', 1, 1),
        (np_org_id, p_consideration, 'White Paper', 'Evidence-based document on VR biofeedback methodology', 'not_started', 2, 0),
        (np_org_id, p_consideration, 'Webinar / Live Demo', 'Live demonstration of VR biofeedback experience', 'not_started', 2, 1);

    -- DECISION cards
    INSERT INTO journey_cards (org_id, phase_id, title, description, status, row_index, sort_order) VALUES
        (np_org_id, p_decision, 'Discovery Call', 'Personal consultation to assess fit and readiness', 'not_started', 0, 0),
        (np_org_id, p_decision, 'Enrollment Page', 'Stripe-integrated payment and enrollment flow', 'not_started', 0, 1),
        (np_org_id, p_decision, 'Equipment Deposit', 'VR headset and HRV monitor deposit collection', 'not_started', 1, 0),
        (np_org_id, p_decision, 'Welcome Email', 'Enrollment confirmation with next steps', 'not_started', 1, 1);

    -- ONBOARDING cards
    INSERT INTO journey_cards (org_id, phase_id, title, description, status, row_index, sort_order) VALUES
        (np_org_id, p_onboarding, 'Equipment Shipping', 'VR headset and HRV monitor shipped to participant', 'not_started', 0, 0),
        (np_org_id, p_onboarding, 'Setup Guide', 'Hardware setup instructions and troubleshooting', 'not_started', 0, 1),
        (np_org_id, p_onboarding, 'Intake Assessment', 'Pre-program NSCI baseline measurement', 'not_started', 1, 0),
        (np_org_id, p_onboarding, 'Orientation Session', 'Live orientation covering program structure and expectations', 'not_started', 1, 1),
        (np_org_id, p_onboarding, 'Platform Access', 'Mastermind platform login and walkthrough', 'not_started', 2, 0);

    -- PROGRAM cards
    INSERT INTO journey_cards (org_id, phase_id, title, description, status, row_index, sort_order) VALUES
        (np_org_id, p_program, 'Week 1: Foundation', 'Baseline VR sessions, HRV awareness, journal setup', 'not_started', 0, 0),
        (np_org_id, p_program, 'Week 2: Awareness', 'Pattern recognition, state identification, coherence training', 'not_started', 0, 1),
        (np_org_id, p_program, 'Week 3: Capacity', 'Midpoint assessment, expanding window of tolerance', 'not_started', 1, 0),
        (np_org_id, p_program, 'Week 4: Integration', 'State fluidity practice, real-world application', 'not_started', 1, 1),
        (np_org_id, p_program, 'Week 5: Mastery', 'Post-program assessment, sustainability planning', 'not_started', 2, 0),
        (np_org_id, p_program, 'Live Group Sessions', 'Weekly facilitator-led group VR sessions', 'not_started', 2, 1),
        (np_org_id, p_program, 'AI Coaching', 'Daily personalized insights from session data', 'not_started', 3, 0),
        (np_org_id, p_program, 'Community Chat', 'Cohort messaging and peer support', 'not_started', 3, 1);

    -- OUTCOMES cards
    INSERT INTO journey_cards (org_id, phase_id, title, description, status, row_index, sort_order) VALUES
        (np_org_id, p_outcomes, 'Post-Program Report', 'Personal outcome report with pre/post comparison', 'not_started', 0, 0),
        (np_org_id, p_outcomes, 'Equipment Return', 'Return shipping for VR headset and HRV monitor', 'not_started', 0, 1),
        (np_org_id, p_outcomes, 'Testimonial Request', 'Invitation to share experience for social proof', 'not_started', 1, 0),
        (np_org_id, p_outcomes, 'Alumni Community', 'Ongoing access to alumni network and resources', 'not_started', 1, 1),
        (np_org_id, p_outcomes, '3-Month Follow-Up', 'Automated reassessment at 3 months post-program', 'not_started', 2, 0),
        (np_org_id, p_outcomes, '6-Month Follow-Up', 'Final longitudinal assessment at 6 months', 'not_started', 2, 1);

    RAISE NOTICE 'Journey seeded with 6 phases and 30 cards for Neuro Progeny';
END $$;
