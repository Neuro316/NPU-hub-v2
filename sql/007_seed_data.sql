-- Run AFTER the table creation script succeeds

-- Seed platform formats
INSERT INTO platform_formats (platform, format_name, width, height, aspect_ratio, category)
SELECT v.platform, v.format_name, v.width, v.height, v.aspect_ratio, v.category
FROM (VALUES
  ('instagram', 'Square Post', 1080, 1080, '1:1', 'post'),
  ('instagram', 'Portrait Post', 1080, 1350, '4:5', 'post'),
  ('instagram', 'Story / Reel', 1080, 1920, '9:16', 'story'),
  ('instagram', 'Landscape', 1080, 566, '1.91:1', 'post'),
  ('instagram', 'Carousel', 1080, 1080, '1:1', 'carousel'),
  ('facebook', 'Square Post', 1080, 1080, '1:1', 'post'),
  ('facebook', 'Landscape Post', 1200, 630, '1.91:1', 'post'),
  ('facebook', 'Story', 1080, 1920, '9:16', 'story'),
  ('facebook', 'Cover Photo', 820, 312, '2.63:1', 'cover'),
  ('facebook', 'Event Cover', 1920, 1005, '1.91:1', 'cover'),
  ('linkedin', 'Square Post', 1080, 1080, '1:1', 'post'),
  ('linkedin', 'Portrait Post', 1080, 1350, '4:5', 'post'),
  ('linkedin', 'Landscape Post', 1200, 627, '1.91:1', 'post'),
  ('linkedin', 'Article Cover', 1280, 720, '16:9', 'article'),
  ('linkedin', 'Company Banner', 1128, 191, '5.9:1', 'cover'),
  ('tiktok', 'Video / Reel', 1080, 1920, '9:16', 'video'),
  ('tiktok', 'Thumbnail', 1080, 1920, '9:16', 'thumbnail'),
  ('x', 'Single Image', 1600, 900, '16:9', 'post'),
  ('x', 'Two Images', 700, 800, '7:8', 'post'),
  ('x', 'Square Post', 1080, 1080, '1:1', 'post'),
  ('x', 'Header', 1500, 500, '3:1', 'cover')
) AS v(platform, format_name, width, height, aspect_ratio, category)
WHERE NOT EXISTS (SELECT 1 FROM platform_formats LIMIT 1);

-- Seed brand profile
INSERT INTO brand_profiles (org_id, brand_key, display_name, tagline, voice_description,
  vocabulary_use, vocabulary_avoid, color_primary, color_secondary, color_accent, guidelines)
SELECT o.id, 'np', 'Neuro Progeny', 'Train Your Nervous System',
  'Scientific authority meets accessible language. Empowering, capacity-focused, forward-looking.',
  ARRAY['capacity', 'regulation', 'training', 'nervous system', 'resilience', 'window of tolerance', 'HRV', 'biofeedback', 'VR', 'state fluidity', 'co-regulation', 'adaptive'],
  ARRAY['treatment', 'therapy', 'fix', 'broken', 'disorder', 'diagnosis', 'cure', 'patient', 'calm-chasing', 'sympathovagal balance'],
  '#386797', '#1A1A2E', '#3B82F6',
  '{"tone": "authoritative yet accessible", "audience": "high-performers, executives, wellness seekers", "core_message": "all behavior is adaptive - capacity over pathology"}'::jsonb
FROM organizations o WHERE o.slug = 'neuro-progeny'
ON CONFLICT (org_id, brand_key) DO NOTHING;
