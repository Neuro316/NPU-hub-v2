import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

/**
 * PUT /api/settings — upsert a single org_settings row (service role).
 * Body: { org_id, setting_key, setting_value }
 */
export async function PUT(req: NextRequest) {
  try {
    // Verify the caller is authenticated
    const supabaseUser = createServerSupabase()
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { org_id, setting_key, setting_value } = body

    if (!org_id || !setting_key) {
      return NextResponse.json({ error: 'org_id and setting_key are required' }, { status: 400 })
    }

    // Verify user belongs to this org
    const admin = createAdminSupabase()
    const { data: membership } = await admin
      .from('org_members')
      .select('role')
      .eq('org_id', org_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 })
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
