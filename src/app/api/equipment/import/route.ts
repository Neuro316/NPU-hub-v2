import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { org_id, csv_text } = await req.json()
    if (!org_id || !csv_text) {
      return NextResponse.json({ error: 'org_id and csv_text required' }, { status: 400 })
    }

    // Parse CSV
    const lines = csv_text.trim().split('\n')
    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 })
    }

    const headers = lines[0].split(',').map((h: string) => h.trim().toLowerCase())
    const VALID_STATUSES = ['available', 'checked_out', 'maintenance', 'retired']

    const admin = createAdminSupabase()

    // Pre-fetch all contacts for name matching
    const { data: allContacts } = await admin
      .from('contacts')
      .select('id, first_name, last_name')
      .eq('org_id', org_id)
      .is('archived_at', null)
    const contactList = allContacts || []

    // Match contact by name (case-insensitive, "First Last" format)
    const findContact = (name: string) => {
      if (!name) return null
      const normalized = name.trim().toLowerCase()
      return contactList.find(c => {
        const full = `${c.first_name || ''} ${c.last_name || ''}`.trim().toLowerCase()
        const reversed = `${c.last_name || ''} ${c.first_name || ''}`.trim().toLowerCase()
        const lastOnly = (c.last_name || '').toLowerCase()
        return full === normalized || reversed === normalized || lastOnly === normalized
      }) || null
    }

    // Parse rows
    interface ParsedRow {
      equipmentData: Record<string, any>
      assignedToName: string
    }

    const parsed: ParsedRow[] = []
    const errors: string[] = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      // Handle quoted CSV fields
      const values: string[] = []
      let current = ''
      let inQuotes = false
      for (const char of line) {
        if (char === '"') { inQuotes = !inQuotes; continue }
        if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue }
        current += char
      }
      values.push(current.trim())

      const row: Record<string, string> = {}
      headers.forEach((h: string, idx: number) => { row[h] = values[idx] || '' })

      const assignedName = row.assigned_to_name || row.assigned_to || ''
      // If someone is assigned, force status to checked_out
      let status = row.status || 'available'
      if (assignedName && status === 'available') {
        status = 'checked_out'
      }

      if (!VALID_STATUSES.includes(status)) {
        errors.push(`Row ${i + 1}: invalid status "${status}"`)
        continue
      }

      // Try to match contact
      const contact = assignedName ? findContact(assignedName) : null
      if (assignedName && !contact) {
        errors.push(`Row ${i + 1}: contact "${assignedName}" not found — device imported as available`)
        status = 'available'
      }

      parsed.push({
        equipmentData: {
          org_id,
          device_id: row.device_id || null,
          device_type: row.device_type || 'meta_quest',
          bundle_serial: row.bundle_serial || null,
          headset_serial: row.headset_serial || null,
          status: contact ? 'checked_out' : status,
          assigned_to: contact?.id || null,
          meta_account_email: row.meta_account_email || null,
          location: row.location || null,
          notes: row.notes || null,
        },
        assignedToName: contact ? assignedName : '',
      })
    }

    if (parsed.length === 0) {
      return NextResponse.json({ error: 'No valid rows found', errors }, { status: 400 })
    }

    // Insert equipment
    const { data: inserted, error: insertErr } = await admin
      .from('equipment')
      .insert(parsed.map(p => p.equipmentData))
      .select()
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

    const insertedRows = inserted || []

    // Create history + assignment rows
    const historyRows: any[] = []
    const assignmentRows: any[] = []

    for (let i = 0; i < insertedRows.length; i++) {
      const equip = insertedRows[i]
      historyRows.push({
        equipment_id: equip.id,
        action: 'registered',
        performed_by: user.id,
        notes: 'CSV import',
      })

      // If assigned, create checkout history + assignment
      if (equip.assigned_to) {
        historyRows.push({
          equipment_id: equip.id,
          action: 'checked_out',
          contact_id: equip.assigned_to,
          performed_by: user.id,
          notes: `CSV import — assigned to ${parsed[i].assignedToName}`,
        })
        assignmentRows.push({
          equipment_id: equip.id,
          assigned_to_contact_id: equip.assigned_to,
          checked_out_by: user.id,
          purpose: 'CSV import',
          condition_out: 'good',
        })
      }
    }

    if (historyRows.length > 0) await admin.from('equipment_history').insert(historyRows)
    if (assignmentRows.length > 0) await admin.from('equipment_assignments').insert(assignmentRows)

    const assignedCount = assignmentRows.length

    return NextResponse.json({
      imported: insertedRows.length,
      assigned: assignedCount,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
