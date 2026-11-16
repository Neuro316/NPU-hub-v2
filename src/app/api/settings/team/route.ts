// PUT /api/settings/team { org_id, setting_key, setting_value }
// Saves the everyday, non-credential settings that any active Hub user edits (ruled 2026-11-08): the pipelines
// board, the contact column chooser, task avatar colours, the dashboard company overview, meeting AI settings and
// roster, enrollment config and cross-org sharing. hub_232 limits browser writes on org_settings to org admins, so
// staff and facilitators save these here instead.
//
// Guard: the caller must have an ACTIVE team_profiles row in that org as super_admin, admin, team_member or
// facilitator (requireOrgMember). That check trusts team_profiles, which hub_232 locks so that a user can no longer
// write their own row. Only the keys below are accepted, and a value carrying a credential field is refused.
import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMember } from '@/lib/api-guard'
import { carriesCredential } from '@/lib/org-vault-fields'

export const dynamic = 'force-dynamic'

const TEAM_EDITABLE_KEYS = new Set([
  'crm_pipelines', 'crm_contact_columns', 'avatar_colors', 'company_overview',
  'meeting_ai_instructions', 'meeting_team_roster', 'crm_enrollment_config', 'cross_org_contact_sharing',
])
const MAX_BYTES = 200_000

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const { org_id, setting_key, setting_value } = body ?? {}
  if (typeof setting_key !== 'string' || !TEAM_EDITABLE_KEYS.has(setting_key)) {
    return NextResponse.json({ error: 'That setting cannot be saved here.' }, { status: 400 })
  }
  if (setting_value === undefined || carriesCredential(setting_key, setting_value) || JSON.stringify(setting_value).length > MAX_BYTES) {
    return NextResponse.json({ error: 'Invalid setting value.' }, { status: 400 })
  }
  const member = await requireOrgMember(org_id)
  if (member instanceof Response) return member
  const { error } = await member.db.from('org_settings').upsert(
    { org_id: member.orgId, setting_key, setting_value, updated_at: new Date().toISOString() }, { onConflict: 'org_id,setting_key' })
  if (error) {
    console.error(`[settings/team] org=${member.orgId} ${setting_key} by ${member.userId} failed: ${error.code ?? 'unknown'}`)
    return NextResponse.json({ error: 'The setting could not be saved. Try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
