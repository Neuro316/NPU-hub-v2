import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

// GET /api/equipment/contacts?org_id=XXX — eligible contacts for equipment checkout
export async function GET(req: NextRequest) {
  try {
    const orgId = req.nextUrl.searchParams.get('org_id')
    if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

    const admin = createAdminSupabase()

    // Fetch contacts in eligible pipeline stages (case-insensitive)
    const { data, error } = await admin
      .from('contacts')
      .select('id, first_name, last_name, phone, pipeline_stage')
      .eq('org_id', orgId)
      .is('archived_at', null)
      .or('pipeline_stage.ilike.mastermind,pipeline_stage.ilike.enrolled,pipeline_stage.ilike.subscribed')
      .order('last_name')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Sort by priority: Mastermind > Subscribed > Enrolled
    const priority: Record<string, number> = { mastermind: 0, subscribed: 1, enrolled: 2 }
    const sorted = (data || []).sort((a, b) => {
      const aP = priority[(a.pipeline_stage || '').toLowerCase()] ?? 99
      const bP = priority[(b.pipeline_stage || '').toLowerCase()] ?? 99
      return aP - bP
    })

    return NextResponse.json({ contacts: sorted })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
