-- 069_inbound_sms_support.sql
-- Step 1 of the Conversations feature: make inbound SMS/MMS persist correctly.
-- Two things the persistence path needs, neither of which exists yet:
--
--   1. crm_twilio_numbers is EMPTY. Inbound org resolution keys on the receiving
--      ("To") number -> org via this table, so with 0 rows every inbound would be
--      dropped. Seed NP's two live numbers (from org_settings crm_twilio). The
--      other org has no Twilio numbers, so nothing to seed there.
--
--   2. Stored contact phones are un-normalized (13 formatted "(828)…", 24 bare
--      10-digit, 1 bare 11-digit), but Twilio delivers "From" in E.164. Exact
--      .eq('phone', e164) misses most contacts. match_contact_by_phone() does a
--      normalized last-10-digit comparison, org-scoped, so inbound texts link to
--      the right existing contact instead of spawning duplicate "Unknown"s.
--
-- Applied via MCP apply_migration (own transaction). If re-run in the SQL Editor,
-- wrap in BEGIN; … COMMIT;.

-- ---------------------------------------------------------------------------
-- 1. Seed the number -> org map (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO crm_twilio_numbers (org_id, phone_e164, friendly_name, purpose, is_default) VALUES
  ('00000000-0000-0000-0000-000000000001', '+18284155050', 'Primary',  'client_relations', true),
  ('00000000-0000-0000-0000-000000000001', '+18289009821', 'Campaign', 'outreach',         false)
ON CONFLICT (phone_e164) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Normalized contact match by phone (last-10-digit, org-scoped)
--    Mirrors the client-side lookupContactByPhone (crm-client.ts:686) logic, but
--    runs in the DB so the webhook doesn't fetch every contact per message.
--    SECURITY DEFINER + pinned search_path, matching the 032 hardening pattern.
--    Returns the earliest-created live contact whose phone shares the last 10
--    digits, or NULL. The webhook runs under the service role, but keeping this
--    SECURITY DEFINER means it also works for any future authenticated caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_contact_by_phone(p_org uuid, p_phone text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH target AS (
    SELECT right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10) AS last10
  )
  SELECT c.id
  FROM contacts c, target t
  WHERE c.org_id = p_org
    AND c.merged_into_id IS NULL
    AND c.phone IS NOT NULL AND c.phone <> ''
    AND length(t.last10) = 10
    AND right(regexp_replace(c.phone, '\D', '', 'g'), 10) = t.last10
  ORDER BY c.created_at ASC
  LIMIT 1
$function$;

-- Callable by the app roles (service role bypasses anyway; keep anon out).
REVOKE ALL ON FUNCTION public.match_contact_by_phone(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.match_contact_by_phone(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PROBES (run after apply)
--   select * from crm_twilio_numbers order by phone_e164;            -- 2 rows
--   select match_contact_by_phone('00000000-0000-0000-0000-000000000001',
--     '+1' || <a formatted contact's 10 digits>);                    -- returns that id
--   select match_contact_by_phone('00000000-0000-0000-0000-000000000001',
--     '+19995550000');                                               -- NULL (no match)
-- ---------------------------------------------------------------------------

-- NOTE (future optimization, not now): no functional index on the normalized
-- phone, so this scans org contacts (~hundreds — fine). If contact volume grows,
-- add: CREATE INDEX ON contacts (right(regexp_replace(phone,'\D','','g'),10)).
