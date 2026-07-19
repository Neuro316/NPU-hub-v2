import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'
import { ADMIN_ROLES } from '@/lib/org-settings-keys'

/**
 * PUT /api/settings — upsert a single org_settings row (service role).
 * Body: { org_id, setting_key, setting_value }
 */
export async function PUT(req: NextRequest) {
  try {
    const admin = createAdminSupabase()

    // Verify the caller is authenticated
    const supabaseUser = createServerSupabase()
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    console.log('[API settings] auth result:', { userId: user?.id, email: user?.email, authError: authError?.message })

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { org_id, setting_key, setting_value } = body
    console.log('[API settings] request:', { org_id, setting_key, userId: user.id })

    if (!org_id || !setting_key) {
      return NextResponse.json({ error: 'org_id and setting_key are required' }, { status: 400 })
    }

    // Verify user belongs to this org.
    // NOTE: the column is organization_id. The previous `.eq('org_id', org_id)`
    // always errored (no such column), so membership was always null and every
    // caller fell through to the team_profiles branch below — which the orphan
    // profiles minted by the workspace-context auto-join satisfied. (NPU R0.4)
    const { data: membership } = await admin
      .from('org_members')
      .select('id, role')
      .eq('organization_id', org_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 })
    }

    // All org_settings writes require an admin role.
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile || !ADMIN_ROLES.has(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Upsert with service role (bypasses RLS)
    const { error } = await admin.from('org_settings').upsert(
      { org_id, setting_key, setting_value },
      { onConflict: 'org_id,setting_key' }
    )

    if (error) {
      console.error('[API settings] upsert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('[API settings] unexpected error:', e)
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 })
  }
}
