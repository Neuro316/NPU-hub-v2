import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const serverSupabase = createServerSupabase()
    const { data: { user } } = await serverSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { user_id, org_id } = await req.json()
    if (!user_id || !org_id) {
      return NextResponse.json({ error: 'user_id and org_id required' }, { status: 400 })
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

    // Update org_members status to rejected
    const { error: memberErr } = await admin
      .from('org_members')
      .update({ status: 'rejected' })
      .eq('user_id', user_id)
      .eq('org_id', org_id)

    if (memberErr) {
      console.error('Reject org_members error:', memberErr)
      return NextResponse.json({ error: 'Failed to reject' }, { status: 500 })
    }

    // Update team_profiles status to rejected
    const { error: profileErr } = await admin
      .from('team_profiles')
      .update({ status: 'rejected' })
      .eq('user_id', user_id)
      .eq('org_id', org_id)

    if (profileErr) {
      console.error('Reject team_profiles error:', profileErr)
    }

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('Reject error:', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
