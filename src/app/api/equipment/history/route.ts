import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { loadPositions, positionsByContact } from '@/lib/pipelines/positions'

// GET /api/equipment/history?equipment_id=XXX
export async function GET(req: NextRequest) {
  try {
    const equipmentId = req.nextUrl.searchParams.get('equipment_id')
    if (!equipmentId) return NextResponse.json({ error: 'equipment_id required' }, { status: 400 })

    const admin = createAdminSupabase()

    const [assignRes, historyRes] = await Promise.all([
      admin
        .from('equipment_assignments')
        .select('*')
        .eq('equipment_id', equipmentId)
        .order('checked_out_at', { ascending: false }),
      admin
        .from('equipment_history')
        .select('*')
        .eq('equipment_id', equipmentId)
        .order('created_at', { ascending: false })
        .limit(50),
    ])

    // Enrich assignments with contact names
    const assignments = assignRes.data || []
    const contactIds = Array.from(new Set(assignments.map(a => a.assigned_to_contact_id).filter(Boolean)))
    let contactMap: Record<string, any> = {}
    if (contactIds.length > 0) {
      const { data: contacts } = await admin
        .from('contacts')
        .select('id, org_id, first_name, last_name, phone')
        .in('id', contactIds)
      if (contacts) {
        // Pipelines with stages, per org, from contact_pipeline_positions
        const byOrg = new Map<string, string[]>()
        for (const c of contacts) if (c.org_id) byOrg.set(c.org_id, [...(byOrg.get(c.org_id) ?? []), c.id])
        const labels = new Map<string, string>()
        for (const [org, ids] of Array.from(byOrg)) {
          for (const [id, ps] of Array.from(positionsByContact(await loadPositions(admin, org, { contactIds: ids })))) {
            labels.set(id, ps.map(p => `${p.pipeline_name} · ${p.stage_name}`).join(', '))
          }
        }
        for (const { org_id, ...c } of contacts) contactMap[c.id] = { ...c, pipeline_label: labels.get(c.id) || null }
      }
    }

    const enrichedAssignments = assignments.map(a => ({
      ...a,
      contacts: contactMap[a.assigned_to_contact_id] || null,
    }))

    // Enrich history with contact names
    const history = historyRes.data || []
    const histContactIds = Array.from(new Set(history.map(h => h.contact_id).filter(Boolean)))
    let histContactMap: Record<string, any> = {}
    if (histContactIds.length > 0) {
      const { data: contacts } = await admin
        .from('contacts')
        .select('id, first_name, last_name')
        .in('id', histContactIds)
      if (contacts) {
        for (const c of contacts) histContactMap[c.id] = c
      }
    }

    const enrichedHistory = history.map(h => ({
      ...h,
      contacts: h.contact_id ? histContactMap[h.contact_id] || null : null,
    }))

    return NextResponse.json({ assignments: enrichedAssignments, history: enrichedHistory })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
