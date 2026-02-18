-- ═══════════════════════════════════════════════════════════════
-- CRM Network Intelligence — Tables, Seeds, Functions, RLS
-- ═══════════════════════════════════════════════════════════════

-- 1. Tag Categories
CREATE TABLE IF NOT EXISTS contact_tag_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#64748b',
  sort_order  integer DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- 2. Tag Definitions
CREATE TABLE IF NOT EXISTS contact_tag_definitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES organizations(id) ON DELETE CASCADE,
  category_id uuid REFERENCES contact_tag_categories(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  is_active   boolean DEFAULT true,
  sort_order  integer DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(org_id, category_id, name)
);

-- 3. Relationship Types (reference table)
CREATE TABLE IF NOT EXISTS relationship_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name          text NOT NULL,
  label         text NOT NULL,
  icon          text,
  reverse_label text,
  color         text DEFAULT '#6366f1',
  sort_order    integer DEFAULT 0,
  is_active     boolean DEFAULT true,
  UNIQUE(org_id, name)
);

-- 4. Contact Relationships (the graph edges)
CREATE TABLE IF NOT EXISTS contact_relationships (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid REFERENCES organizations(id) ON DELETE CASCADE,
  from_contact_id   uuid REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
  to_contact_id     uuid REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
  relationship_type text NOT NULL,
  notes             text,
  strength          integer DEFAULT 3 CHECK (strength BETWEEN 1 AND 5),
  is_bidirectional  boolean DEFAULT true,
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE(org_id, from_contact_id, to_contact_id, relationship_type),
  CHECK(from_contact_id != to_contact_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_rels_from ON contact_relationships(from_contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_rels_to   ON contact_relationships(to_contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_rels_org  ON contact_relationships(org_id);

-- 5. Contact Interaction Scores
CREATE TABLE IF NOT EXISTS contact_interaction_score (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          uuid REFERENCES contacts(id) ON DELETE CASCADE UNIQUE,
  org_id              uuid REFERENCES organizations(id) ON DELETE CASCADE,
  relationship_count  integer DEFAULT 0,
  inbound_refs        integer DEFAULT 0,
  outbound_refs       integer DEFAULT 0,
  tag_count           integer DEFAULT 0,
  last_interaction    timestamptz,
  interaction_score   decimal(8,2) DEFAULT 0,
  network_centrality  decimal(8,4) DEFAULT 0,
  bridge_score        decimal(8,4) DEFAULT 0,
  cluster_id          integer,
  computed_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interaction_score_org ON contact_interaction_score(org_id);

-- 6. Network Events
CREATE TABLE IF NOT EXISTS network_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text,
  event_date        timestamptz,
  target_contacts   uuid[] DEFAULT '{}',
  bridge_contacts   uuid[] DEFAULT '{}',
  suggested_invites uuid[] DEFAULT '{}',
  status            text DEFAULT 'planning' CHECK (status IN ('planning','invites_sent','completed','cancelled')),
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════
-- RLS Policies
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE contact_tag_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_tag_definitions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_types       ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_relationships    ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_interaction_score ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_events           ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's org_id
CREATE OR REPLACE FUNCTION get_user_org_id() RETURNS uuid AS $$
  SELECT org_id FROM team_members WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE POLICY "org_rls" ON contact_tag_categories
  FOR ALL USING (org_id = get_user_org_id());

CREATE POLICY "org_rls" ON contact_tag_definitions
  FOR ALL USING (org_id = get_user_org_id());

CREATE POLICY "org_rls" ON relationship_types
  FOR ALL USING (org_id = get_user_org_id());

CREATE POLICY "org_rls" ON contact_relationships
  FOR ALL USING (org_id = get_user_org_id());

CREATE POLICY "org_rls" ON contact_interaction_score
  FOR ALL USING (org_id = get_user_org_id());

CREATE POLICY "org_rls" ON network_events
  FOR ALL USING (org_id = get_user_org_id());


-- ═══════════════════════════════════════════════════════════════
-- Seed Function (idempotent, called per-org)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION seed_network_intelligence(p_org_id uuid)
RETURNS void AS $$
DECLARE
  v_cat_id uuid;
BEGIN
  -- Only seed if no categories exist for this org
  IF EXISTS (SELECT 1 FROM contact_tag_categories WHERE org_id = p_org_id) THEN
    RETURN;
  END IF;

  -- Seed categories + tags
  -- 1. Relationship Role
  INSERT INTO contact_tag_categories (org_id, name, color, sort_order) VALUES (p_org_id, 'Relationship Role', '#6366f1', 1) RETURNING id INTO v_cat_id;
  INSERT INTO contact_tag_definitions (org_id, category_id, name, sort_order) VALUES
    (p_org_id, v_cat_id, 'Mentor', 1), (p_org_id, v_cat_id, 'Connector', 2),
    (p_org_id, v_cat_id, 'Referral Source', 3), (p_org_id, v_cat_id, 'Champion', 4),
    (p_org_id, v_cat_id, 'Collaborator', 5), (p_org_id, v_cat_id, 'Advisory Board', 6);

  -- 2. Pipeline Stage
  INSERT INTO contact_tag_categories (org_id, name, color, sort_order) VALUES (p_org_id, 'Pipeline Stage', '#0ea5e9', 2) RETURNING id INTO v_cat_id;
  INSERT INTO contact_tag_definitions (org_id, category_id, name, sort_order) VALUES
    (p_org_id, v_cat_id, 'Cold Lead', 1), (p_org_id, v_cat_id, 'Warm Lead', 2),
    (p_org_id, v_cat_id, 'Discovery Scheduled', 3), (p_org_id, v_cat_id, 'In Nurture', 4),
    (p_org_id, v_cat_id, 'Ready to Enroll', 5), (p_org_id, v_cat_id, 'Enrolled', 6),
    (p_org_id, v_cat_id, 'Program Alumni', 7);

  -- 3. Future Potential
  INSERT INTO contact_tag_categories (org_id, name, color, sort_order) VALUES (p_org_id, 'Future Potential', '#f59e0b', 3) RETURNING id INTO v_cat_id;
  INSERT INTO contact_tag_definitions (org_id, category_id, name, sort_order) VALUES
    (p_org_id, v_cat_id, 'Future Vendor', 1), (p_org_id, v_cat_id, 'Future Employee', 2),
    (p_org_id, v_cat_id, 'Future Partner', 3), (p_org_id, v_cat_id, 'Beta Tester', 4),
    (p_org_id, v_cat_id, 'Investor Interest', 5), (p_org_id, v_cat_id, 'Media Contact', 6);

  -- 4. Community Role
  INSERT INTO contact_tag_categories (org_id, name, color, sort_order) VALUES (p_org_id, 'Community Role', '#10b981', 4) RETURNING id INTO v_cat_id;
  INSERT INTO contact_tag_definitions (org_id, category_id, name, sort_order) VALUES
    (p_org_id, v_cat_id, 'Practitioner', 1), (p_org_id, v_cat_id, 'Community Leader', 2),
    (p_org_id, v_cat_id, 'Content Creator', 3), (p_org_id, v_cat_id, 'Speaker', 4),
    (p_org_id, v_cat_id, 'Facilitator', 5), (p_org_id, v_cat_id, 'Cohort Captain', 6);

  -- 5. Engagement Level
  INSERT INTO contact_tag_categories (org_id, name, color, sort_order) VALUES (p_org_id, 'Engagement Level', '#ef4444', 5) RETURNING id INTO v_cat_id;
  INSERT INTO contact_tag_definitions (org_id, category_id, name, sort_order) VALUES
    (p_org_id, v_cat_id, 'High Touch', 1), (p_org_id, v_cat_id, 'Low Touch', 2),
    (p_org_id, v_cat_id, 'Dormant', 3), (p_org_id, v_cat_id, 'Re-engage', 4),
    (p_org_id, v_cat_id, 'VIP', 5);

  -- 6. Domain Expertise
  INSERT INTO contact_tag_categories (org_id, name, color, sort_order) VALUES (p_org_id, 'Domain Expertise', '#8b5cf6', 6) RETURNING id INTO v_cat_id;
  INSERT INTO contact_tag_definitions (org_id, category_id, name, sort_order) VALUES
    (p_org_id, v_cat_id, 'Neuroscience', 1), (p_org_id, v_cat_id, 'Therapy/Counseling', 2),
    (p_org_id, v_cat_id, 'Corporate Wellness', 3), (p_org_id, v_cat_id, 'Education', 4),
    (p_org_id, v_cat_id, 'Tech/Engineering', 5), (p_org_id, v_cat_id, 'Marketing/Sales', 6),
    (p_org_id, v_cat_id, 'Healthcare Admin', 7), (p_org_id, v_cat_id, 'VR/Immersive Tech', 8);

  -- Seed relationship types
  IF NOT EXISTS (SELECT 1 FROM relationship_types WHERE org_id = p_org_id) THEN
    INSERT INTO relationship_types (org_id, name, label, reverse_label, color, sort_order) VALUES
      (p_org_id, 'referred_by',       'Referred by',         'Referred',          '#6366f1', 1),
      (p_org_id, 'introduced_to',     'Introduced to',       'Introduced by',     '#0ea5e9', 2),
      (p_org_id, 'collaborates_with', 'Collaborates with',   'Collaborates with', '#10b981', 3),
      (p_org_id, 'mentored_by',       'Mentored by',         'Mentors',           '#8b5cf6', 4),
      (p_org_id, 'partner_of',        'Partner of',          'Partner of',        '#f59e0b', 5),
      (p_org_id, 'reports_to',        'Reports to',          'Manages',           '#64748b', 6),
      (p_org_id, 'family_of',         'Family of',           'Family of',         '#ef4444', 7),
      (p_org_id, 'co_founded',        'Co-founded with',     'Co-founded with',   '#ec4899', 8),
      (p_org_id, 'client_of',         'Client of',           'Provider for',      '#14b8a6', 9),
      (p_org_id, 'invested_in',       'Invested in',         'Funded by',         '#f97316', 10);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ═══════════════════════════════════════════════════════════════
-- Compute Network Scores Function
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION compute_contact_network_scores(p_org_id uuid)
RETURNS void AS $$
DECLARE
  v_total integer;
  v_rec   record;
BEGIN
  -- Count total contacts in org
  SELECT count(*) INTO v_total FROM contacts WHERE org_id = p_org_id AND merged_into_id IS NULL;
  IF v_total = 0 THEN RETURN; END IF;

  -- Upsert a score row per contact
  FOR v_rec IN
    SELECT
      c.id AS contact_id,
      coalesce(r.rel_count, 0) AS rel_count,
      coalesce(r.inbound, 0)   AS inbound,
      coalesce(r.outbound, 0)  AS outbound,
      coalesce(array_length(c.tags, 1), 0) AS tag_count,
      c.last_contacted_at
    FROM contacts c
    LEFT JOIN (
      SELECT
        x.cid,
        count(*) AS rel_count,
        count(*) FILTER (WHERE x.dir = 'in')  AS inbound,
        count(*) FILTER (WHERE x.dir = 'out') AS outbound
      FROM (
        SELECT to_contact_id AS cid, 'in'  AS dir FROM contact_relationships WHERE org_id = p_org_id
        UNION ALL
        SELECT from_contact_id AS cid, 'out' AS dir FROM contact_relationships WHERE org_id = p_org_id
      ) x
      GROUP BY x.cid
    ) r ON r.cid = c.id
    WHERE c.org_id = p_org_id AND c.merged_into_id IS NULL
  LOOP
    INSERT INTO contact_interaction_score (
      contact_id, org_id, relationship_count, inbound_refs, outbound_refs,
      tag_count, last_interaction, interaction_score, network_centrality,
      bridge_score, cluster_id, computed_at
    ) VALUES (
      v_rec.contact_id, p_org_id, v_rec.rel_count, v_rec.inbound, v_rec.outbound,
      v_rec.tag_count, v_rec.last_contacted_at,
      -- interaction_score formula
      (v_rec.rel_count * 20) + (v_rec.inbound * 15) +
      (CASE WHEN v_rec.last_contacted_at > now() - interval '7 days' THEN 30
            WHEN v_rec.last_contacted_at > now() - interval '30 days' THEN 20
            WHEN v_rec.last_contacted_at > now() - interval '90 days' THEN 10
            ELSE 0 END) +
      (v_rec.tag_count * 10),
      -- centrality
      CASE WHEN v_total > 1 THEN v_rec.rel_count::decimal / (v_total - 1) ELSE 0 END,
      0, -- bridge_score computed client-side for now
      NULL, -- cluster_id computed client-side
      now()
    )
    ON CONFLICT (contact_id) DO UPDATE SET
      relationship_count = EXCLUDED.relationship_count,
      inbound_refs = EXCLUDED.inbound_refs,
      outbound_refs = EXCLUDED.outbound_refs,
      tag_count = EXCLUDED.tag_count,
      last_interaction = EXCLUDED.last_interaction,
      interaction_score = EXCLUDED.interaction_score,
      network_centrality = EXCLUDED.network_centrality,
      computed_at = now();
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Enable realtime on relationships for live graph updates
ALTER PUBLICATION supabase_realtime ADD TABLE contact_relationships;
