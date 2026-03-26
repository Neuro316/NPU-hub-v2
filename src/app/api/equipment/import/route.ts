import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    const { org_id, csv_text } = await req.json()
    if (!org_id || !csv_text) {
      return NextResponse.json({ error: 'org_id and csv_text required' }, { status: 400 })
    }

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

    // Pre-fetch existing equipment for this org (match by device_id, bundle_serial, or headset_serial)
    const { data: existingEquip } = await admin
      .from('equipment')
      .select('id, device_id, bundle_serial, headset_serial, status, assigned_to')
      .eq('org_id', org_id)
    const existing = existingEquip || []

    const findExisting = (row: Record<string, string>) => {
      // Match by device_id first, then by either serial
      if (row.device_id) {
        const match = existing.find(e => e.device_id === row.device_id)
        if (match) return match
      }
      if (row.bundle_serial) {
        const match = existing.find(e => e.bundle_serial === row.bundle_serial)
        if (match) return match
      }
      if (row.headset_serial) {
        const match = existing.find(e => e.headset_serial === row.headset_serial)
        if (match) return match
      }
      return null
    }

    // Parse rows
    const errors: string[] = []
    const warnings: string[] = []
    let created = 0
    let updated = 0
    let assigned = 0
    let contactsCreated = 0

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      // Parse CSV fields (handle quotes)
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
      let status = row.status || 'available'
      if (assignedName && status === 'available') status = 'checked_out'
      if (!VALID_STATUSES.includes(status)) {
        errors.push(`Row ${i + 1}: invalid status "${status}"`)
        continue
      }

      let contact = assignedName ? findContact(assignedName) : null
      if (assignedName && !contact) {
        // Auto-create contact
        const nameParts = assignedName.trim().split(/\s+/)
        const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : null
        const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : nameParts[0]
        const { data: newContact, error: contactErr } = await admin
          .from('contacts')
          .insert({
            org_id,
            first_name: firstName,
            last_name: lastName,
            pipeline_stage: 'Enrolled',
          })
          .select('id, first_name, last_name')
          .single()
        if (newContact && !contactErr) {
          contact = newContact
          contactList.push(newContact) // Add to local cache for subsequent rows
          contactsCreated++
          warnings.push(`Row ${i + 1}: created new contact "${assignedName}" (Enrolled pipeline)`)
        } else {
          warnings.push(`Row ${i + 1}: failed to create contact "${assignedName}" — ${contactErr?.message || 'unknown'}, imported as available`)
          status = 'available'
        }
      }

      // Skip rows with no identifying info
      if (!row.device_id && !row.bundle_serial && !row.headset_serial) {
        warnings.push(`Row ${i + 1}: skipped — no device_id or serial numbers`)
        continue
      }

      const equipData = {
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
        updated_at: new Date().toISOString(),
      }

      const match = findExisting(row)

      if (match) {
        // UPDATE existing equipment
        const { error: updateErr } = await admin
          .from('equipment')
          .update(equipData)
          .eq('id', match.id)

        if (updateErr) {
          errors.push(`Row ${i + 1}: update failed — ${updateErr.message}`)
          continue
        }

        // If assignment changed, handle checkout/checkin
        const newAssignee = contact?.id || null
        const oldAssignee = match.assigned_to

        if (newAssignee && newAssignee !== oldAssignee) {
          // Close old assignment if any
          if (oldAssignee) {
            await admin.from('equipment_assignments')
              .update({ checked_in_at: new Date().toISOString(), checked_in_by: user?.id || null, notes: 'CSV import reassignment' })
              .eq('equipment_id', match.id)
              .is('checked_in_at', null)
          }
          // Create new assignment
          await admin.from('equipment_assignments').insert({
            equipment_id: match.id,
            assigned_to_contact_id: newAssignee,
            checked_out_by: user?.id || null,
            purpose: 'CSV import',
            condition_out: 'good',
          })
          await admin.from('equipment_history').insert({
            equipment_id: match.id,
            action: 'checked_out',
            contact_id: newAssignee,
            performed_by: user?.id || null,
            notes: `CSV import — assigned to ${assignedName}`,
          })
          assigned++
        } else if (!newAssignee && oldAssignee) {
          // Contact removed — check in
          await admin.from('equipment_assignments')
            .update({ checked_in_at: new Date().toISOString(), checked_in_by: user?.id || null, notes: 'CSV import' })
            .eq('equipment_id', match.id)
            .is('checked_in_at', null)
          await admin.from('equipment_history').insert({
            equipment_id: match.id,
            action: 'checked_in',
            contact_id: oldAssignee,
            performed_by: user?.id || null,
            notes: 'CSV import — unassigned',
          })
        }

        await admin.from('equipment_history').insert({
          equipment_id: match.id,
          action: 'updated',
          performed_by: user?.id || null,
          notes: 'CSV import update',
        })
        updated++
      } else {
        // INSERT new equipment
        const { data: newEquip, error: insertErr } = await admin
          .from('equipment')
          .insert(equipData)
          .select().single()

        if (insertErr || !newEquip) {
          errors.push(`Row ${i + 1}: insert failed — ${insertErr?.message || 'unknown'}`)
          continue
        }

        await admin.from('equipment_history').insert({
          equipment_id: newEquip.id,
          action: 'registered',
          performed_by: user?.id || null,
          notes: 'CSV import',
        })

        if (contact) {
          await admin.from('equipment_assignments').insert({
            equipment_id: newEquip.id,
            assigned_to_contact_id: contact.id,
            checked_out_by: user?.id || null,
            purpose: 'CSV import',
            condition_out: 'good',
          })
          await admin.from('equipment_history').insert({
            equipment_id: newEquip.id,
            action: 'checked_out',
            contact_id: contact.id,
            performed_by: user?.id || null,
            notes: `CSV import — assigned to ${assignedName}`,
          })
          assigned++
        }
        created++
      }
    }

    return NextResponse.json({
      created,
      updated,
      assigned,
      total: created + updated,
      contacts_created: contactsCreated,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
