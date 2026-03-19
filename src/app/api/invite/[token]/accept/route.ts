import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

// POST /api/invite/[token]/accept — create user account from invite
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const { token } = params
    const { first_name, last_name, password } = await req.json()

    if (!first_name || !last_name || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const admin = createAdminSupabase()

    // Fetch and validate invite
    const { data: invite, error: inviteError } = await admin
      .from('hub_invites')
      .select('id, email, org_id, role, used, expires_at')
      .eq('token', token)
      .single()

    if (inviteError || !invite) {
      return NextResponse.json({ error: 'Invalid invite' }, { status: 404 })
    }

    if (invite.used) {
      return NextResponse.json({ error: 'Invite already used' }, { status: 410 })
    }

    if (new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Invite expired' }, { status: 410 })
    }

    const display_name = `${first_name} ${last_name}`
    const email = invite.email

    // Create auth user (or update if they already exist from the invite email)
    let userId: string

    // First try to find existing auth user (from inviteUserByEmail)
    const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const existingUser = (users || []).find(
      (u: any) => u.email?.toLowerCase() === email.toLowerCase()
    )

    if (existingUser) {
      // User exists (from invite email) — update their password and metadata
      const { error: updateError } = await admin.auth.admin.updateUserById(
        existingUser.id,
        {
          password,
          email_confirm: true,
          user_metadata: {
            full_name: display_name,
            first_name,
            last_name,
          },
        }
      )
      if (updateError) {
        console.error('Update existing user error:', updateError)
        return NextResponse.json({ error: 'Failed to update account' }, { status: 500 })
      }
      userId = existingUser.id
    } else {
      // Create new auth user
      const { data: authData, error: authError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: display_name,
          first_name,
          last_name,
        },
      })
      if (authError) {
        console.error('Create user error:', authError)
        return NextResponse.json({ error: authError.message || 'Failed to create account' }, { status: 500 })
      }
      userId = authData.user.id
    }

    // Map invite role to team_profiles role
    const teamRole = invite.role === 'admin' ? 'admin' : 'team_member'

    // Create org_member with ACTIVE status (invited users skip approval)
    const { error: memberError } = await admin
      .from('org_members')
      .upsert(
        { org_id: invite.org_id, user_id: userId, role: invite.role, status: 'active' },
        { onConflict: 'org_id,user_id' }
      )

    if (memberError) {
      console.error('org_members upsert error:', memberError)
      return NextResponse.json({ error: 'Failed to create membership' }, { status: 500 })
    }

    // Create team_profile with ACTIVE status
    const { error: profileError } = await admin
      .from('team_profiles')
      .upsert(
        { org_id: invite.org_id, user_id: userId, display_name, email, role: teamRole, status: 'active' },
        { onConflict: 'org_id,user_id' }
      )

    if (profileError) {
      console.error('team_profiles upsert error:', profileError)
      return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 })
    }

    // Mark invite as used
    await admin
      .from('hub_invites')
      .update({ used: true })
      .eq('id', invite.id)

    return NextResponse.json({ success: true, user_id: userId })
  } catch (e: any) {
    console.error('Invite accept error:', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
