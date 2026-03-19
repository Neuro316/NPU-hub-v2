-- Hub Invites table for the invite system
-- Run this manually in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS hub_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  program     text,
  token       uuid NOT NULL DEFAULT gen_random_uuid(),
  used        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  invited_by  uuid REFERENCES auth.users(id)
);

-- Index for token lookups
CREATE UNIQUE INDEX IF NOT EXISTS hub_invites_token_idx ON hub_invites(token);

-- Index for listing invites by org
CREATE INDEX IF NOT EXISTS hub_invites_org_idx ON hub_invites(org_id);

-- Index for checking if email already invited
CREATE INDEX IF NOT EXISTS hub_invites_email_org_idx ON hub_invites(email, org_id);

-- RLS: only service role should access this table
ALTER TABLE hub_invites ENABLE ROW LEVEL SECURITY;

-- No RLS policies = only service role (admin client) can read/write
-- This is intentional since all access goes through API routes
