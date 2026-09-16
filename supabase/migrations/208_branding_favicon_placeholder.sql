-- 208_branding_favicon_placeholder.sql
-- STATUS: APPLIED 2026-09-16 via apply_migration, registered in schema_migrations
-- as 208_branding_favicon_placeholder (version 20260916104738). Verified after
-- apply: NP branding.favicon_url = '/images/np-logo.png'; Sensorium row untouched.
--
-- Data repair (docs/HUB_Multi_Line_Conversations_Design.md §11).
-- The Neuro Progeny org's org_settings.branding.favicon_url holds the literal
-- placeholder 'PASTE_NEURO_PROGENY_FAVICON_URL_HERE' (written through
-- /api/settings/set-favicon and never replaced). src/components/dynamic-favicon.tsx
-- sets it as <link rel="icon" href>, so every NP page requests
-- /PASTE_NEURO_PROGENY_FAVICON_URL_HERE and gets a 404. The literal is data, not
-- code: it appears in no file of this repo.
--
-- Points it at /images/np-logo.png, the only NP asset in /public. Replace with a
-- real 32x32 favicon later by updating the same key. The WHERE clause matches
-- the placeholder exactly, so a value someone has already fixed is never
-- overwritten and re-running is a no-op.
--
-- PRE-CHECK (read-only):
--   SELECT os.org_id, os.setting_value->>'favicon_url' AS favicon_url
--   FROM public.org_settings os
--   WHERE os.setting_key = 'branding'
--   ORDER BY os.org_id;
--   EXPECT: org ...0001 = 'PASTE_NEURO_PROGENY_FAVICON_URL_HERE' (1 row to change).

UPDATE public.org_settings os
SET setting_value = os.setting_value || jsonb_build_object('favicon_url', '/images/np-logo.png')
WHERE os.org_id = '00000000-0000-0000-0000-000000000001'
  AND os.setting_key = 'branding'
  AND os.setting_value->>'favicon_url' = 'PASTE_NEURO_PROGENY_FAVICON_URL_HERE';

-- POST-APPLY PROBE:
--   SELECT os.setting_value->>'favicon_url' FROM public.org_settings os
--   WHERE os.org_id = '00000000-0000-0000-0000-000000000001'
--     AND os.setting_key = 'branding';            -- expect /images/np-logo.png
