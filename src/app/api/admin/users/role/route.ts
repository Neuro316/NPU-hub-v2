import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const serverSupabase = createServerSupabase()
    const { data: { user } } = await serverSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { user_id, org_id, role } = await req.json()
    if (!user_id || !org_id || !role) {
      return NextResponse.json({ error: 'user_id, org_id, and role required' }, { status: 400 })
    }

    const validRoles = ['super_admin', 'admin', 'team_member', 'facilitator', 'participant']
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    const admin = createAdminSupabase()

    // Verify caller is admin/super_admin
    const { data: caller } = await admin
      .from('org_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', org_id)
      .single()

    if (!caller || !['admin', 'super_admin'].includes(caller.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Only super_admin can assign super_admin role
    if (role === 'super_admin' && caller.role !== 'super_admin') {
      return NextResponse.json({ error: 'Only super admins can assign super admin role' }, { status: 403 })
    }

    // Prevent demoting yourself
    if (user_id === user.id) {
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 })
    }

    // Map org_members role (member/admin) vs team_profiles role
    const orgMemberRole = ['super_admin', 'admin'].includes(role) ? role : 'member'

    // Update org_members
    const { error: memberErr } = await admin
      .from('org_members')
      .update({ role: orgMemberRole })
      .eq('user_id', user_id)
      .eq('org_id', org_id)

    if (memberErr) {
      console.error('Role update org_members error:', memberErr)
      return NextResponse.json({ error: 'Failed to update role' }, { status: 500 })
    }

    // Update team_profiles
    const { error: profileErr } = await admin
      .from('team_profiles')
      .update({ role })
      .eq('user_id', user_id)
      .eq('org_id', org_id)

    if (profileErr) {
      console.error('Role update team_profiles error:', profileErr)
    }

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('Role change error:', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
