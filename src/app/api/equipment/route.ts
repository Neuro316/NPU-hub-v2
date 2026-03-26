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

// POST /api/equipment — register new equipment (with dedup/merge)
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    const body = await req.json()
    const { org_id, device_id, device_type, bundle_serial, headset_serial, meta_account_email, location, notes } = body
    if (!org_id) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

    const admin = createAdminSupabase()

    // Check for existing equipment with matching serial(s)
    let existing = null
    if (bundle_serial) {
      const { data } = await admin.from('equipment').select('*').eq('org_id', org_id).eq('bundle_serial', bundle_serial).maybeSingle()
      if (data) existing = data
    }
    if (!existing && headset_serial) {
      const { data } = await admin.from('equipment').select('*').eq('org_id', org_id).eq('headset_serial', headset_serial).maybeSingle()
      if (data) existing = data
    }
    if (!existing && device_id) {
      const { data } = await admin.from('equipment').select('*').eq('org_id', org_id).eq('device_id', device_id).maybeSingle()
      if (data) existing = data
    }

    if (existing) {
      // Merge into existing — prefer checked_out version's data, fill in blanks
      const mergeUpdates: Record<string, any> = { updated_at: new Date().toISOString() }
      if (!existing.device_id && device_id) mergeUpdates.device_id = device_id
      if (!existing.bundle_serial && bundle_serial) mergeUpdates.bundle_serial = bundle_serial
      if (!existing.headset_serial && headset_serial) mergeUpdates.headset_serial = headset_serial
      if (!existing.meta_account_email && meta_account_email) mergeUpdates.meta_account_email = meta_account_email
      if (!existing.location && location) mergeUpdates.location = location
      if (notes && notes !== existing.notes) mergeUpdates.notes = [existing.notes, notes].filter(Boolean).join(' | ')

      if (Object.keys(mergeUpdates).length > 1) {
        await admin.from('equipment').update(mergeUpdates).eq('id', existing.id)
      }

      // Delete any other duplicates with the same serials (keep the one with checked_out status, or the existing one)
      const dupeFilters = []
      if (bundle_serial) dupeFilters.push(`bundle_serial.eq.${bundle_serial}`)
      if (headset_serial) dupeFilters.push(`headset_serial.eq.${headset_serial}`)
      if (dupeFilters.length > 0) {
        const { data: dupes } = await admin
          .from('equipment')
          .select('id, status')
          .eq('org_id', org_id)
          .or(dupeFilters.join(','))
          .neq('id', existing.id)
        if (dupes && dupes.length > 0) {
          const dupeIds = dupes.map(d => d.id)
          // Move any assignments from dupes to the kept record
          await admin.from('equipment_assignments').update({ equipment_id: existing.id }).in('equipment_id', dupeIds)
          await admin.from('equipment_history').update({ equipment_id: existing.id }).in('equipment_id', dupeIds)
          await admin.from('equipment').delete().in('id', dupeIds)
        }
      }

      await admin.from('equipment_history').insert({
        equipment_id: existing.id,
        action: 'merged',
        performed_by: user?.id || null,
        notes: `Merged duplicate registration (${device_id || bundle_serial || headset_serial})`,
      })

      // Return the updated existing record
      const { data: merged } = await admin.from('equipment').select('*').eq('id', existing.id).single()
      return NextResponse.json({ equipment: merged, merged: true })
    }

    // No duplicate — create new
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

// PATCH /api/equipment — update equipment fields
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const admin = createAdminSupabase()
    const { data, error } = await admin
      .from('equipment')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Log status change
    if (updates.status) {
      await admin.from('equipment_history').insert({
        equipment_id: id,
        action: `status_${updates.status}`,
        notes: `Status changed to ${updates.status}`,
      })
    }

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
