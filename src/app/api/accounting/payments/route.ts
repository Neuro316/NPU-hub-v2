import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase'
import { authorizeAccountingWrite, enrolContact, NP_STAGE_PAID } from '@/lib/accounting-auth'

// ─── POST /api/accounting/payments ──────────────────────────────────────────
// Records a payment and, on a Neuro Progeny client's FIRST payment, advances
// that client's CRM contact to the paid stage (enrolling it first if the client
// predates enrolment).
//
// ── THIS PATH WAS THE MORE DANGEROUS OF THE TWO ─────────────────────────────
// `page.tsx:1719` did check `error` on the stage move — but an UPDATE refused by
// RLS matches ZERO ROWS AND RETURNS NO ERROR. `USING` filters rows out; only a
// `WITH CHECK` violation raises. So `alert('CRM move-to-Paid failed')` could
// never fire for a permission problem, and stage moves failed in complete
// silence. The insert at :1649 raised only because it was an INSERT.
//
// Every write below is therefore verified by ROW COUNT, not just by `error`.
//
// It also wrote the stage name 'Paid', which is NOT a stage in
// pipeline-1771530511407 — its stage 2 is 'Paid/ payment plan'. See
// src/lib/accounting-auth.ts.
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: any = {}
    try { body = await request.json() } catch { /* validated below */ }

    const clientId = String(body?.client_id || '').trim()
    const serviceId = String(body?.service_id || '').trim()
    const amount = Number(body?.amount)
    if (!clientId) return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
    if (!serviceId) return NextResponse.json({ error: 'service_id is required' }, { status: 400 })
    if (!Number.isFinite(amount)) return NextResponse.json({ error: 'amount must be a number' }, { status: 400 })

    const admin = createAdminSupabase()

    // The client names its own location; the caller does not get to say which.
    const { data: client } = await admin
      .from('acct_clients')
      .select('id, org_id, location_id, name, email, phone, date_of_birth, address_street, address_city, address_state, address_zip, enrolled_contact_id')
      .eq('id', clientId)
      .maybeSingle()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const auth = await authorizeAccountingWrite(admin, user.id, client.location_id)
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    if (client.org_id !== auth.actingOrgId) {
      return NextResponse.json(
        { error: 'This client and its location belong to different organizations. Refusing to guess which one owns the record.' },
        { status: 409 }
      )
    }

    // The service must belong to this client, or a payment could be attached
    // across clients by id alone.
    const { data: service } = await admin
      .from('acct_services').select('id, client_id').eq('id', serviceId).maybeSingle()
    if (!service) return NextResponse.json({ error: 'Service not found' }, { status: 404 })
    if (service.client_id !== clientId) {
      return NextResponse.json({ error: 'That service belongs to a different client' }, { status: 409 })
    }

    // Counted BEFORE the insert — this is what makes it the first payment.
    const { count: priorPayments, error: countErr } = await admin
      .from('acct_payments')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
    if (countErr) {
      return NextResponse.json({ error: `Could not count existing payments: ${countErr.message}` }, { status: 500 })
    }

    const { data: payment, error: payErr } = await admin
      .from('acct_payments')
      .insert({
        org_id: auth.actingOrgId,
        client_id: clientId,
        service_id: serviceId,
        amount,
        payment_date: body?.payment_date || null,
        notes: body?.notes || null,
      })
      .select('id')
      .single()

    if (payErr || !payment?.id) {
      return NextResponse.json(
        { error: `Could not record payment: ${payErr?.message || 'no id returned'}` },
        { status: 500 }
      )
    }

    const warnings: string[] = []
    let movedToPaid = false

    if (auth.targetOrgId && (priorPayments ?? 0) === 0) {
      let contactId = client.enrolled_contact_id

      if (!contactId) {
        const res = await enrolContact(admin, clientId, auth.targetOrgId, {
          name: client.name,
          email: client.email,
          phone: client.phone,
          date_of_birth: client.date_of_birth,
          address_street: client.address_street,
          address_city: client.address_city,
          address_state: client.address_state,
          address_zip: client.address_zip,
        })
        if ('error' in res) warnings.push(res.error)
        else contactId = res.contactId
      }

      if (contactId) {
        const { data: moved, error: moveErr } = await admin
          .from('contacts')
          .update({ pipeline_stage: NP_STAGE_PAID })
          .eq('id', contactId)
          .eq('org_id', auth.targetOrgId)
          .select('id')

        if (moveErr) {
          warnings.push(`Payment saved, but the CRM stage move failed: ${moveErr.message}`)
        } else if (!moved || moved.length === 0) {
          // The silent case, now audible.
          warnings.push(`Payment saved, but the CRM stage move matched 0 rows — contact ${contactId} was not found in that organization. The contact link may be stale.`)
        } else {
          movedToPaid = true
        }
      }
    }

    return NextResponse.json({ payment_id: payment.id, moved_to_paid: movedToPaid, warnings })
  } catch (e: any) {
    console.error('POST /api/accounting/payments failed', e)
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 })
  }
}
