// GET /api/settings/read?org_id=&key=        one org_settings value   -> { setting_value, credentials_set }
// GET /api/settings/read?org_id=&keys=a,b,c   several                  -> { settings: { key: value }, credentials_set: { key: { field: bool } } }
//
// The only way a browser reads org_settings for a Hub user who is not an org admin (ruled 2026-11-08: no member-level
// RLS read policy, because participants share the member role). Service role, so THIS is the boundary:
//   - the caller must have Hub access in that org: an ACTIVE team_profiles row as super_admin, admin, team_member
//     or facilitator (never participant)
//   - keys outside ORG_MEMBER_READABLE_KEYS also need an org admin (team admin/super_admin, or platform superadmin);
//     a single such key is refused, and in a several-key read it is left out
//   - credential fields are NEVER returned, to anyone: they come back blank, with credentials_set saying which are
//     set (read through Vault, src/lib/org-vault.ts)
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'
import { isCredentialKey } from '@/lib/org-settings-keys'
import { HUB_ACCESS_TEAM_ROLES } from '@/lib/api-guard'
import { readOrgSetting } from '@/lib/org-vault'
import { redactCredentials } from '@/lib/org-vault-fields'

export const dynamic = 'force-dynamic'

const KEY = /^[a-z0-9_]{1,64}$/
const MAX_KEYS = 30

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const one = req.nextUrl.searchParams.get('key')
  const many = req.nextUrl.searchParams.get('keys')
  const keys = (one ? [one] : (many ?? '').split(',')).map((k) => k.trim()).filter(Boolean)
  if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId) || !keys.length) return NextResponse.json({ error: 'org_id and key required' }, { status: 400 })
  if (keys.length > MAX_KEYS || keys.some((k) => !KEY.test(k))) return NextResponse.json({ error: 'Invalid key.' }, { status: 400 })

  // Identity from the session cookie, never from the request.
  const { data: { user } } = await createServerSupabase().auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminSupabase()
  const [{ data: tps, error: tErr }, { data: prof }] = await Promise.all([
    admin.from('team_profiles').select('role').eq('user_id', user.id).eq('org_id', orgId).eq('status', 'active'),
    admin.from('profiles').select('role').eq('id', user.id).maybeSingle(),
  ])
  if (tErr) return NextResponse.json({ error: 'Your access could not be checked.' }, { status: 503 })
  const roles = (tps ?? []).map((t: any) => String(t.role ?? 'team_member'))
  if (!roles.some((r) => HUB_ACCESS_TEAM_ROLES.includes(r))) return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 })
  const orgAdmin = ['admin', 'superadmin'].includes((prof as any)?.role) || roles.some((r) => r === 'admin' || r === 'super_admin')
  // one key: refused outright; several: the keys this caller may not read are left out
  if (one && isCredentialKey(one) && !orgAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const readable = keys.filter((k) => orgAdmin || !isCredentialKey(k))

  try {
    const settings: Record<string, unknown> = {}
    const credentials_set: Record<string, Record<string, boolean>> = {}
    for (const k of readable) {
      const { value, set } = redactCredentials(k, await readOrgSetting(admin, orgId, k))
      settings[k] = value ?? null
      if (Object.keys(set).length) credentials_set[k] = set
    }
    if (one) return NextResponse.json({ setting_value: settings[one], credentials_set: credentials_set[one] ?? {} })
    return NextResponse.json({ settings, credentials_set })
  } catch (e: any) {
    console.error(`[settings/read] org=${orgId} failed: ${String(e?.message ?? 'error').slice(0, 60)}`)
    return NextResponse.json({ error: 'Settings could not be read.' }, { status: 500 })
  }
}
