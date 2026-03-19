import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    // Auth check: must be logged-in admin or super_admin
    const serverSupabase = createServerSupabase()
    const { data: { user } } = await serverSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { email, org_id, role = 'member', program } = body

    if (!email || !org_id) {
      return NextResponse.json({ error: 'email and org_id are required' }, { status: 400 })
    }

    if (!['member', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'role must be member or admin' }, { status: 400 })
    }

    const admin = createAdminSupabase()

    // Verify caller is admin/super_admin in this org
    const { data: callerMember } = await admin
      .from('org_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', org_id)
      .single()

    if (!callerMember || !['admin', 'super_admin'].includes(callerMember.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Check if email already has an active (unused, unexpired) invite for this org
    const { data: existing } = await admin
      .from('hub_invites')
      .select('id, token')
      .eq('email', email.toLowerCase())
      .eq('org_id', org_id)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (existing) {
      // Return the existing invite token instead of creating a duplicate
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
      return NextResponse.json({
        success: true,
        invite_id: existing.id,
        invite_url: `${appUrl}/invite/${existing.token}`,
        message: 'Active invite already exists',
      })
    }

    // Create the invite record
    const { data: invite, error: inviteError } = await admin
      .from('hub_invites')
      .insert({
        email: email.toLowerCase(),
        org_id,
        role,
        program: program || null,
        invited_by: user.id,
      })
      .select('id, token')
      .single()

    if (inviteError) {
      console.error('hub_invites insert error:', inviteError)
      return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    const inviteUrl = `${appUrl}/invite/${invite.token}`

    // Send invite email via Supabase Auth magic link
    // This sends a "You have been invited" email to the user
    try {
      const { error: emailError } = await admin.auth.admin.inviteUserByEmail(
        email.toLowerCase(),
        {
          data: {
            full_name: '',
            invite_token: invite.token,
          },
          redirectTo: inviteUrl,
        }
      )

      // If user already exists in auth, that's fine — they can still use the invite link
      if (emailError && !emailError.message?.includes('already') && !emailError.message?.includes('registered')) {
        console.warn('Invite email warning:', emailError.message)
      }
    } catch (emailErr) {
      // Non-fatal: invite is created, admin can share the link manually
      console.warn('Invite email send failed:', emailErr)
    }

    return NextResponse.json({
      success: true,
      invite_id: invite.id,
      invite_url: inviteUrl,
    })
  } catch (e: any) {
    console.error('Invite API error:', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
