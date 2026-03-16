import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

// GET /api/invite/[token] — validate an invite token
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const { token } = params
    const admin = createAdminSupabase()

    const { data: invite, error } = await admin
      .from('hub_invites')
      .select('id, email, org_id, role, program, used, expires_at')
      .eq('token', token)
      .single()

    if (error || !invite) {
      return NextResponse.json({ error: 'Invalid invite', reason: 'invalid' }, { status: 404 })
    }

    if (invite.used) {
      return NextResponse.json({ error: 'Invite already used', reason: 'used' }, { status: 410 })
    }

    if (new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Invite expired', reason: 'expired' }, { status: 410 })
    }

    // Get org name for display
    const { data: org } = await admin
      .from('organizations')
      .select('name')
      .eq('id', invite.org_id)
      .single()

    return NextResponse.json({
      id: invite.id,
      email: invite.email,
      org_id: invite.org_id,
      role: invite.role,
      program: invite.program,
      org_name: org?.name || 'Unknown Organization',
    })
  } catch (e: any) {
    console.error('Invite validation error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
