import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

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
        .select('id, first_name, last_name, phone, pipeline_stage')
        .in('id', contactIds)
      if (contacts) {
        for (const c of contacts) contactMap[c.id] = c
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
