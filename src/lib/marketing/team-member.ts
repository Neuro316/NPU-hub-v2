// src/lib/marketing/team-member.ts
// sequences.created_by is FOREIGN KEY (created_by) REFERENCES team_members(id), verified in
// pg_catalog 2026-10-01. It is NOT the auth user id. The signed-in user's team_members
// row is found by membership, (org_id, user_id) which is UNIQUE, and only while it is
// active. No row means null: the column is nullable, and a missing team_members row must
// never block saving a campaign.
import type { SupabaseClient } from '@supabase/supabase-js'

export async function teamMemberId(db: SupabaseClient, orgId: string, userId: string): Promise<string | null> {
  const { data, error } = await db.from('team_members').select('id')
    .eq('org_id', orgId).eq('user_id', userId).eq('is_active', true).maybeSingle()
  if (error) {
    console.error(`[team-member] lookup failed for org=${orgId}: ${error.code ?? 'unknown'}; created_by left empty`)
    return null
  }
  return data?.id ?? null
}
