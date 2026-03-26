import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

// GET /api/equipment/contacts?org_id=XXX — eligible contacts for equipment checkout
export async function GET(req: NextRequest) {
  try {
    const orgId = req.nextUrl.searchParams.get('org_id')
    if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

    const admin = createAdminSupabase()

    // Fetch ALL non-archived contacts for this org (don't filter by pipeline_stage)
    // This ensures contacts created via equipment import always show up
    const { data, error } = await admin
      .from('contacts')
      .select('id, first_name, last_name, phone, pipeline_stage')
      .eq('org_id', orgId)
      .is('archived_at', null)
      .order('last_name')

    if (error) {
      console.error('[equipment/contacts] query error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const contacts = data || []
    console.log(`[equipment/contacts] Found ${contacts.length} contacts for org ${orgId}`)

    // Sort: Mastermind first, then Subscribed, then Enrolled, then everyone else
    const priority: Record<string, number> = { mastermind: 0, subscribed: 1, enrolled: 2 }
    const sorted = contacts.sort((a, b) => {
      const aP = priority[(a.pipeline_stage || '').toLowerCase()] ?? 50
      const bP = priority[(b.pipeline_stage || '').toLowerCase()] ?? 50
      if (aP !== bP) return aP - bP
      return (a.last_name || '').localeCompare(b.last_name || '')
    })

    return NextResponse.json({ contacts: sorted })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
