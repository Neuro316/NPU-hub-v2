import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { loadPositions, positionsByContact } from '@/lib/pipelines/positions'

// GET /api/equipment/contacts?org_id=XXX — eligible contacts for equipment checkout
export async function GET(req: NextRequest) {
  try {
    const orgId = req.nextUrl.searchParams.get('org_id')
    if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

    const admin = createAdminSupabase()

    // Fetch ALL non-archived contacts for this org (not filtered by pipeline)
    // This ensures contacts created via equipment import always show up
    const { data, error } = await admin
      .from('contacts')
      .select('id, first_name, last_name, phone')
      .eq('org_id', orgId)
      .is('archived_at', null)
      .order('last_name')

    if (error) {
      console.error('[equipment/contacts] query error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const byContact = positionsByContact(await loadPositions(admin, orgId))
    const contacts = (data || []).map(c => {
      const ps = byContact.get(c.id) ?? []
      return { ...c, pipeline_label: ps.map(p => `${p.pipeline_name} · ${p.stage_name}`).join(', '), stages: ps.map(p => p.stage_name) }
    })
    console.log(`[equipment/contacts] Found ${contacts.length} contacts for org ${orgId}`)

    // Sort: a Mastermind stage first, then Subscribed, then Enrolled (a stage of that name in any pipeline), then everyone else
    const priority: Record<string, number> = { mastermind: 0, subscribed: 1, enrolled: 2 }
    const rank = (stages: string[]) => Math.min(50, ...stages.map(s => priority[s.toLowerCase()] ?? 50))
    const sorted = contacts.sort((a, b) => {
      const aP = rank(a.stages)
      const bP = rank(b.stages)
      if (aP !== bP) return aP - bP
      return (a.last_name || '').localeCompare(b.last_name || '')
    })

    return NextResponse.json({ contacts: sorted.map(({ stages, ...c }) => c) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
