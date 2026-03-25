import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { equipment_id, contact_id, org_id, purpose, condition_out } = await req.json()
    if (!equipment_id || !contact_id || !org_id) {
      return NextResponse.json({ error: 'equipment_id, contact_id, and org_id required' }, { status: 400 })
    }

    const admin = createAdminSupabase()

    // Verify equipment is available
    const { data: equip } = await admin
      .from('equipment').select('id, status, device_id').eq('id', equipment_id).single()
    if (!equip) return NextResponse.json({ error: 'Equipment not found' }, { status: 404 })
    if (equip.status === 'checked_out') {
      return NextResponse.json({ error: 'Equipment is already checked out' }, { status: 409 })
    }

    // Get contact info for SMS
    const { data: contact } = await admin
      .from('contacts').select('first_name, last_name, phone').eq('id', contact_id).single()

    // Create assignment
    const { error: assignErr } = await admin.from('equipment_assignments').insert({
      equipment_id,
      assigned_to_contact_id: contact_id,
      checked_out_by: user.id,
      purpose: purpose || null,
      condition_out: condition_out || 'good',
    })
    if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 })

    // Update equipment status
    const { data: updated, error: updateErr } = await admin
      .from('equipment')
      .update({ status: 'checked_out', assigned_to: contact_id, updated_at: new Date().toISOString() })
      .eq('id', equipment_id)
      .select().single()
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    // Log history
    await admin.from('equipment_history').insert({
      equipment_id,
      action: 'checked_out',
      contact_id,
      performed_by: user.id,
      notes: purpose ? `Purpose: ${purpose}` : null,
      metadata: { condition: condition_out || 'good' },
    })

    return NextResponse.json({ equipment: updated, contact_name: `${contact?.first_name || ''} ${contact?.last_name || ''}`.trim() })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
