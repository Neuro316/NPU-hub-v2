import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

// GET /api/admin/users/invites?org_id=... — list invites
export async function GET(req: NextRequest) {
  try {
    const serverSupabase = createServerSupabase()
    const { data: { user } } = await serverSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminSupabase()
    const orgId = req.nextUrl.searchParams.get('org_id')

    // Verify caller is admin in at least one org
    const { data: callerOrgs } = await admin
      .from('org_members')
      .select('org_id, role')
      .eq('user_id', user.id)
      .in('role', ['admin', 'super_admin'])

    if (!callerOrgs || callerOrgs.length === 0) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const isSuperAdmin = callerOrgs.some(o => o.role === 'super_admin')
    const adminOrgIds = callerOrgs.map(o => o.org_id)

    // Build query
    let query = admin
      .from('hub_invites')
      .select('id, email, org_id, role, program, token, used, created_at, expires_at')
      .order('created_at', { ascending: false })
      .limit(100)

    if (orgId) {
      // Verify access to this org
      if (!isSuperAdmin && !adminOrgIds.includes(orgId)) {
        return NextResponse.json({ error: 'No access to this org' }, { status: 403 })
      }
      query = query.eq('org_id', orgId)
    } else if (!isSuperAdmin) {
      query = query.in('org_id', adminOrgIds)
    }

    const { data: invites, error } = await query

    if (error) {
      console.error('Fetch invites error:', error)
      return NextResponse.json({ error: 'Failed to fetch invites' }, { status: 500 })
    }

    // Attach org names
    const orgIds = Array.from(new Set((invites || []).map(i => i.org_id)))
    const { data: orgs } = await admin
      .from('organizations')
      .select('id, name')
      .in('id', orgIds.length > 0 ? orgIds : ['_none_'])

    const orgMap: Record<string, string> = {}
    ;(orgs || []).forEach(o => { orgMap[o.id] = o.name })

    const enriched = (invites || []).map(i => ({
      ...i,
      org_name: orgMap[i.org_id] || 'Unknown',
    }))

    return NextResponse.json({ invites: enriched })
  } catch (e: any) {
    console.error('Invites list error:', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
