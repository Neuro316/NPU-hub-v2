-- ═══════════════════════════════════════════════════════════════
-- CRM 005: Contact Card Enhancements
-- Adds address fields, reason_for_contact, phone lookup function
-- ═══════════════════════════════════════════════════════════════

-- Address fields
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS address_street text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS address_city text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS address_state text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS address_zip text;

-- Primary reason for contacting
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS reason_for_contact text;

-- Index phone for fast lookup (used by dialer auto-match)
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone) WHERE phone IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- Phone Number Lookup Function
-- Used by dialer when a number is typed manually
-- Strips non-digits and matches last 10 digits
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION lookup_contact_by_phone(p_phone text, p_org_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, first_name text, last_name text, phone text, org_id uuid)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  clean_phone text;
BEGIN
  -- Strip to digits only
  clean_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');
  
  -- Take last 10 digits for matching
  IF length(clean_phone) > 10 THEN
    clean_phone := right(clean_phone, 10);
  END IF;

  RETURN QUERY
    SELECT c.id, c.first_name, c.last_name, c.phone, c.org_id
    FROM contacts c
    WHERE c.merged_into_id IS NULL
      AND c.phone IS NOT NULL
      AND right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) = clean_phone
      AND (p_org_id IS NULL OR c.org_id = p_org_id)
    LIMIT 1;
END;
$$;
