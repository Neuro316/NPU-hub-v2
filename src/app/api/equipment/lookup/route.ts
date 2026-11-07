import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'
import { loadPositions, positionsByContact } from '@/lib/pipelines/positions'

/** "Pipeline · Stage" for each pipeline a contact is in, joined (contact_pipeline_positions). */
async function pipelineLabels(db: ReturnType<typeof createAdminSupabase>, orgId: string, contactIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (contactIds.length === 0) return out
  const byContact = positionsByContact(await loadPositions(db, orgId, { contactIds }))
  for (const [id, ps] of Array.from(byContact)) out.set(id, ps.map(p => `${p.pipeline_name} · ${p.stage_name}`).join(', '))
  return out
}

// GET /api/equipment/lookup?serial=XXX&org_id=YYY
export async function GET(req: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const serial = req.nextUrl.searchParams.get('serial')
    const orgId = req.nextUrl.searchParams.get('org_id')
    if (!serial || !orgId) {
      return NextResponse.json({ error: 'serial and org_id required' }, { status: 400 })
    }

    const admin = createAdminSupabase()
    const { data, error } = await admin
      .from('equipment')
      .select('*, contacts!assigned_to(first_name, last_name, phone)')
      .eq('org_id', orgId)
      .or(`bundle_serial.eq.${serial},headset_serial.eq.${serial}`)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ equipment: null })

    // Flatten joined contact
    const labels = await pipelineLabels(admin, orgId, (data as any).assigned_to ? [(data as any).assigned_to] : [])
    const equipment = {
      ...data,
      contact_first_name: (data as any).contacts?.first_name || null,
      contact_last_name: (data as any).contacts?.last_name || null,
      contact_phone: (data as any).contacts?.phone || null,
      contact_pipeline_label: (data as any).assigned_to ? labels.get((data as any).assigned_to) || null : null,
      contacts: undefined,
    }

    // If checked out, get current assignment
    let current_assignment = null
    if (equipment.status === 'checked_out') {
      const { data: assign } = await admin
        .from('equipment_assignments')
        .select('*, contacts!assigned_to_contact_id(first_name, last_name)')
        .eq('equipment_id', equipment.id)
        .is('checked_in_at', null)
        .order('checked_out_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (assign) {
        current_assignment = {
          ...assign,
          contact_first_name: (assign as any).contacts?.first_name || null,
          contact_last_name: (assign as any).contacts?.last_name || null,
          contacts: undefined,
        }
      }
    }

    return NextResponse.json({ equipment, current_assignment })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
