import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'
import { isCredentialKey, ADMIN_ROLES } from '@/lib/org-settings-keys'

// GET /api/settings/read?org_id=XXX&key=YYY — read a single org_settings value.
// Uses the service role, which bypasses RLS, so this handler MUST do its own
// authorization: session -> org membership -> admin role for credential keys.
export async function GET(req: NextRequest) {
  try {
    const orgId = req.nextUrl.searchParams.get('org_id')
    const key = req.nextUrl.searchParams.get('key')
    if (!orgId || !key) return NextResponse.json({ error: 'org_id and key required' }, { status: 400 })

    // Identity from the session cookie, never from the request.
    const { data: { user } } = await createServerSupabase().auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminSupabase()

    // Org membership. NOTE: the column is organization_id, NOT org_id.
    const { data: membership } = await admin
      .from('org_members')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 })
    }

    // Credential-bearing keys additionally require an admin role.
    if (isCredentialKey(key)) {
      const { data: profile } = await admin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()

      if (!profile || !ADMIN_ROLES.has(profile.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const { data, error } = await admin
      .from('org_settings')
      .select('setting_value')
      .eq('org_id', orgId)
      .eq('setting_key', key)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data || { setting_value: null })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
