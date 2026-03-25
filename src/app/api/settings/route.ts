import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

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

    // Verify user belongs to this org
    const { data: membership, error: memberError } = await admin
      .from('org_members')
      .select('id, role')
      .eq('org_id', org_id)
      .eq('user_id', user.id)
      .maybeSingle()

    console.log('[API settings] membership check:', { membership, memberError: memberError?.message })

    if (!membership) {
      // Fallback: check team_profiles (some users exist there but not in org_members)
      const { data: profile } = await admin
        .from('team_profiles')
        .select('id, role')
        .eq('org_id', org_id)
        .eq('user_id', user.id)
        .maybeSingle()

      console.log('[API settings] team_profiles fallback:', { profile })

      if (!profile) {
        return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 })
      }
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
