/**
 * org_settings key classification (NPU R0.4).
 *
 * Keys any org member may READ. Anything NOT listed here is treated as
 * credential-bearing and requires an admin role — unknown keys are admin-gated
 * by default, so a newly added secret is protected before anyone remembers to
 * classify it.
 *
 * Enforced by GET /api/settings/read, the only way a non-admin Hub user reads
 * org_settings (2026-11-08). RLS (hub_232) admits org admins only, with no
 * member-level read policy. The credential FIELDS inside a key are listed in
 * src/lib/org-vault-fields.ts and are never returned to a browser at all.
 */
export const ORG_MEMBER_READABLE_KEYS = new Set([
  'enabled_modules',
  'hidden_modules',
  'sidebar_order',
  'avatar_colors',
  'branding',
  'company_overview',
  'crm_pipelines',
  'crm_contact_columns',
  'ecr_service_types',
  'pipeline_config',
  'crm_compliance',
  'crm_notifications',
  'crm_enrollment_config',
  'cross_org_contact_sharing',
  'meeting_ai_instructions',
  'meeting_team_roster',
])

export function isCredentialKey(key: string): boolean {
  return !ORG_MEMBER_READABLE_KEYS.has(key)
}

export const ADMIN_ROLES = new Set(['admin', 'superadmin'])
