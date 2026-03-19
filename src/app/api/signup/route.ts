import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { user_id, org_id, first_name, last_name, email } = await req.json()

    if (!user_id || !org_id || !first_name || !last_name || !email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const admin = createAdminSupabase()

    // Verify the org exists
    const { data: org, error: orgError } = await admin
      .from('organizations')
      .select('id')
      .eq('id', org_id)
      .single()

    if (orgError || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const display_name = `${first_name} ${last_name}`

    // Create org_member with pending status
    const { error: memberError } = await admin
      .from('org_members')
      .upsert(
        { org_id, user_id, role: 'member', status: 'pending' },
        { onConflict: 'org_id,user_id' }
      )

    if (memberError) {
      console.error('org_members upsert error:', memberError)
      return NextResponse.json({ error: 'Failed to create membership' }, { status: 500 })
    }

    // Create team_profile with pending status
    const { error: profileError } = await admin
      .from('team_profiles')
      .upsert(
        { org_id, user_id, display_name, email, role: 'team_member', status: 'pending' },
        { onConflict: 'org_id,user_id' }
      )

    if (profileError) {
      console.error('team_profiles upsert error:', profileError)
      return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('Signup API error:', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
