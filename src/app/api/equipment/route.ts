import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

// GET /api/equipment — list all equipment for org
export async function GET(req: NextRequest) {
  try {
    const orgId = req.nextUrl.searchParams.get('org_id')
    if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

    const admin = createAdminSupabase()

    // Fetch equipment
    const { data: equipData, error } = await admin
      .from('equipment')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const items = equipData || []

    // Fetch assigned contact names
    const assignedIds = items.filter(e => e.assigned_to).map(e => e.assigned_to)
    let contactMap: Record<string, any> = {}
    if (assignedIds.length > 0) {
      const { data: contacts } = await admin
        .from('contacts')
        .select('id, first_name, last_name, phone, pipeline_stage')
        .in('id', assignedIds)
      if (contacts) {
        for (const c of contacts) contactMap[c.id] = c
      }
    }

    const equipment = items.map(e => ({
      ...e,
      contact_first_name: e.assigned_to ? contactMap[e.assigned_to]?.first_name || null : null,
      contact_last_name: e.assigned_to ? contactMap[e.assigned_to]?.last_name || null : null,
      contact_phone: e.assigned_to ? contactMap[e.assigned_to]?.phone || null : null,
      contact_pipeline_stage: e.assigned_to ? contactMap[e.assigned_to]?.pipeline_stage || null : null,
    }))

    return NextResponse.json({ equipment })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/equipment — register new equipment
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    const body = await req.json()
    const { org_id, device_id, device_type, bundle_serial, headset_serial, meta_account_email, location, notes } = body
    if (!org_id) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

    const admin = createAdminSupabase()
    const { data, error } = await admin
      .from('equipment')
      .insert({
        org_id, device_id, device_type: device_type || 'meta_quest',
        bundle_serial: bundle_serial || null,
        headset_serial: headset_serial || null,
        meta_account_email: meta_account_email || null,
        location: location || null,
        notes: notes || null,
      })
      .select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await admin.from('equipment_history').insert({
      equipment_id: data.id,
      action: 'registered',
      performed_by: user?.id || null,
      notes: `Registered ${device_type || 'meta_quest'} ${device_id || ''}`.trim(),
    })

    return NextResponse.json({ equipment: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/equipment — delete one or many equipment records
// Body: { id: string } or { ids: string[] }
export async function DELETE(req: NextRequest) {
  try {
    const admin = createAdminSupabase()

    // Support both query param (single) and body (bulk)
    let ids: string[] = []
    const paramId = req.nextUrl.searchParams.get('id')
    if (paramId) {
      ids = [paramId]
    } else {
      try {
        const body = await req.json()
        if (body.id) ids = [body.id]
        else if (body.ids) ids = body.ids
      } catch {}
    }

    if (ids.length === 0) return NextResponse.json({ error: 'id or ids required' }, { status: 400 })

    // Bulk delete: history → assignments → equipment
    await admin.from('equipment_history').delete().in('equipment_id', ids)
    await admin.from('equipment_assignments').delete().in('equipment_id', ids)
    const { error } = await admin.from('equipment').delete().in('id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, deleted: ids.length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
