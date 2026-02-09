-- ============================================================
-- Journey Builder Tables
-- ============================================================

-- Journey phases (columns in the pipeline)
CREATE TABLE journey_phases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    phase_key TEXT NOT NULL,
    label TEXT NOT NULL,
    color TEXT DEFAULT '#386797',
    sort_order INT DEFAULT 0,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, phase_key)
);

-- Journey cards (the boxes within phases)
CREATE TABLE journey_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    phase_id UUID NOT NULL REFERENCES journey_phases(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'not_started',
    row_index INT DEFAULT 0,
    sort_order INT DEFAULT 0,
    custom_fields JSONB DEFAULT '{}',
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Assets attached to journey cards
CREATE TABLE journey_card_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id UUID NOT NULL REFERENCES journey_cards(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    asset_type TEXT DEFAULT 'link',
    url TEXT,
    notes TEXT,
    sort_order INT DEFAULT 0,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE journey_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_card_assets ENABLE ROW LEVEL SECURITY;

-- RLS policies: users can access data for orgs they belong to
CREATE POLICY "Users can view journey phases for their orgs"
    ON journey_phases FOR SELECT
    USING (org_id IN (
        SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can insert journey phases for their orgs"
    ON journey_phases FOR INSERT
    WITH CHECK (org_id IN (
        SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can update journey phases for their orgs"
    ON journey_phases FOR UPDATE
    USING (org_id IN (
        SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can delete journey phases for their orgs"
    ON journey_phases FOR DELETE
    USING (org_id IN (
        SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can view journey cards for their orgs"
    ON journey_cards FOR SELECT
    USING (org_id IN (
        SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can insert journey cards for their orgs"
    ON journey_cards FOR INSERT
    WITH CHECK (org_id IN (
        SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can update journey cards for their orgs"
    ON journey_cards FOR UPDATE
    USING (org_id IN (
        SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can delete journey cards for their orgs"
    ON journey_cards FOR DELETE
    USING (org_id IN (
        SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can view card assets for their orgs"
    ON journey_card_assets FOR SELECT
    USING (org_id IN (
        SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can insert card assets for their orgs"
    ON journey_card_assets FOR INSERT
    WITH CHECK (org_id IN (
        SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can update card assets for their orgs"
    ON journey_card_assets FOR UPDATE
    USING (org_id IN (
        SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can delete card assets for their orgs"
    ON journey_card_assets FOR DELETE
    USING (org_id IN (
        SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    ));

-- Also add RLS to org_members so the workspace context queries work
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own memberships"
    ON org_members FOR SELECT
    USING (user_id = auth.uid());

-- Indexes
CREATE INDEX idx_journey_phases_org ON journey_phases(org_id, sort_order);
CREATE INDEX idx_journey_cards_phase ON journey_cards(phase_id, sort_order);
CREATE INDEX idx_journey_cards_org ON journey_cards(org_id);
CREATE INDEX idx_journey_card_assets_card ON journey_card_assets(card_id);
