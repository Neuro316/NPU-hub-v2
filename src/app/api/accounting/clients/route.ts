import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase'
import { authorizeAccountingWrite, enrolContact } from '@/lib/accounting-auth'

// ─── POST /api/accounting/clients ───────────────────────────────────────────
// Creates an accounting client and, when its clinic is flagged
// `is_neuro_progeny`, enrols it as a Neuro Progeny CRM contact.
//
// ── WHY THIS ROUTE EXISTS ───────────────────────────────────────────────────
// This was three unguarded browser writes under the anon key
// (`page.tsx` addClient + createNPContactSignedUp). The contact insert was
// refused by `contacts_org_rls` for the operator who actually does the data
// entry, because that policy reads `profiles.role` — a platform-wide column
// that knows nothing about her Hub grant. See src/lib/accounting-auth.ts for
// the full ruling; the short version is that her authority is correct and the
// policy reads the wrong column.
//
// The service role bypasses RLS entirely, so authorizeAccountingWrite() IS the
// boundary. No org id is ever taken from the request body.
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: any = {}
    try { body = await request.json() } catch { /* validated below */ }

    const name = String(body?.name || '').trim()
    const locationId = String(body?.location_id || '').trim()
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
    if (!locationId) return NextResponse.json({ error: 'location_id is required' }, { status: 400 })

    const admin = createAdminSupabase()

    const auth = await authorizeAccountingWrite(admin, user.id, locationId)
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const fields = {
      name,
      date_of_birth: body?.date_of_birth || null,
      phone: body?.phone || null,
      email: body?.email || null,
      address_street: body?.address_street || null,
      address_city: body?.address_city || null,
      address_state: body?.address_state || null,
      address_zip: body?.address_zip || null,
    }

    // org_id comes from the resolved location, never from the caller.
    const { data: client, error: clientErr } = await admin
      .from('acct_clients')
      .insert({ org_id: auth.actingOrgId, location_id: locationId, ...fields })
      .select('id')
      .single()

    if (clientErr || !client?.id) {
      return NextResponse.json(
        { error: `Could not add client: ${clientErr?.message || 'no id returned'}` },
        { status: 500 }
      )
    }

    // The accounting record is the primary one and it now exists, so an enrol
    // failure does not roll it back — it is reported instead. Silence here is
    // exactly the defect this route was written to remove.
    const warnings: string[] = []
    let enrolledContactId: string | null = null

    if (auth.targetOrgId) {
      const res = await enrolContact(admin, client.id, auth.targetOrgId, fields)
      if ('error' in res) warnings.push(res.error)
      else enrolledContactId = res.contactId
    }

    return NextResponse.json({
      client_id: client.id,
      enrolled_contact_id: enrolledContactId,
      enrolled: !!enrolledContactId,
      warnings,
    })
  } catch (e: any) {
    console.error('POST /api/accounting/clients failed', e)
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 })
  }
}
