import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

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
      .select('*, contacts!assigned_to(first_name, last_name, phone, pipeline_stage)')
      .eq('org_id', orgId)
      .or(`bundle_serial.eq.${serial},headset_serial.eq.${serial}`)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ equipment: null })

    // Flatten joined contact
    const equipment = {
      ...data,
      contact_first_name: (data as any).contacts?.first_name || null,
      contact_last_name: (data as any).contacts?.last_name || null,
      contact_phone: (data as any).contacts?.phone || null,
      contact_pipeline_stage: (data as any).contacts?.pipeline_stage || null,
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
