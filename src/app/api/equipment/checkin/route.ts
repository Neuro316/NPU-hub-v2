import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { equipment_id, condition_in, notes } = await req.json()
    if (!equipment_id) {
      return NextResponse.json({ error: 'equipment_id required' }, { status: 400 })
    }

    const admin = createAdminSupabase()

    // Find the open assignment
    const { data: assignment } = await admin
      .from('equipment_assignments')
      .select('id, assigned_to_contact_id')
      .eq('equipment_id', equipment_id)
      .is('checked_in_at', null)
      .order('checked_out_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!assignment) {
      return NextResponse.json({ error: 'No open assignment found' }, { status: 404 })
    }

    // Close the assignment
    await admin.from('equipment_assignments').update({
      checked_in_at: new Date().toISOString(),
      checked_in_by: user.id,
      condition_in: condition_in || null,
      notes: notes || null,
    }).eq('id', assignment.id)

    // Reset equipment to available
    const { data: updated, error: updateErr } = await admin
      .from('equipment')
      .update({ status: 'available', assigned_to: null, updated_at: new Date().toISOString() })
      .eq('id', equipment_id)
      .select().single()
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    // Log history
    await admin.from('equipment_history').insert({
      equipment_id,
      action: 'checked_in',
      contact_id: assignment.assigned_to_contact_id,
      performed_by: user.id,
      notes: notes || null,
      metadata: { condition: condition_in || 'good' },
    })

    return NextResponse.json({ equipment: updated })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
