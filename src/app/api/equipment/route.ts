import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

// GET /api/equipment — list all equipment for org
export async function GET(req: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const orgId = req.nextUrl.searchParams.get('org_id')
    if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

    const admin = createAdminSupabase()
    const { data, error } = await admin
      .from('equipment')
      .select('*, contacts!assigned_to(first_name, last_name, phone, pipeline_stage)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Flatten the joined contact data
    const equipment = (data || []).map((e: any) => ({
      ...e,
      contact_first_name: e.contacts?.first_name || null,
      contact_last_name: e.contacts?.last_name || null,
      contact_phone: e.contacts?.phone || null,
      contact_pipeline_stage: e.contacts?.pipeline_stage || null,
      contacts: undefined,
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
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

    // Log registration
    await admin.from('equipment_history').insert({
      equipment_id: data.id,
      action: 'registered',
      performed_by: user.id,
      notes: `Registered ${device_type || 'meta_quest'} ${device_id || ''}`.trim(),
    })

    return NextResponse.json({ equipment: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
