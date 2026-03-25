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

    const rows = []
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

      const status = row.status || 'available'
      if (!VALID_STATUSES.includes(status)) {
        errors.push(`Row ${i + 1}: invalid status "${status}"`)
        continue
      }

      rows.push({
        org_id,
        device_id: row.device_id || null,
        device_type: row.device_type || 'meta_quest',
        bundle_serial: row.bundle_serial || null,
        headset_serial: row.headset_serial || null,
        status,
        meta_account_email: row.meta_account_email || null,
        location: row.location || null,
        notes: row.notes || null,
      })
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No valid rows found', errors }, { status: 400 })
    }

    const admin = createAdminSupabase()
    const { data, error } = await admin.from('equipment').insert(rows).select()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Log history for each
    const historyRows = (data || []).map((e: any) => ({
      equipment_id: e.id,
      action: 'registered',
      performed_by: user.id,
      notes: 'CSV import',
    }))
    if (historyRows.length > 0) {
      await admin.from('equipment_history').insert(historyRows)
    }

    return NextResponse.json({
      imported: data?.length || 0,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
