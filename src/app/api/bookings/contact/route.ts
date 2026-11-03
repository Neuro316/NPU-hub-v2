// GET /api/bookings/contact?contact_id=
// The "Booking answers" section of a contact card: University bookings synced to this
// contact (hub_booking_syncs, Build 1), newest first. Staff of the CONTACT's org only;
// the org comes from the contact row, never the request.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg } from '@/lib/api-guard'

export const dynamic = 'force-dynamic'

export const GET = withStaff(async (req: NextRequest, ctx) => {
  const contactId = req.nextUrl.searchParams.get('contact_id')
  if (!contactId || !/^[0-9a-f-]{36}$/i.test(contactId)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const { data: contact } = await ctx.db.from('contacts').select('id, org_id').eq('id', contactId).maybeSingle()
  if (!contact) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const orgId = requireOrg(ctx, contact.org_id)
  if (orgId instanceof Response) return orgId
  const { data, error } = await ctx.db.from('hub_booking_syncs')
    .select('booking_id, appointment_type, starts_at, ends_at, status, answers, first_synced_at')
    .eq('contact_id', contactId).eq('org_id', orgId).order('starts_at', { ascending: false }).limit(20)
  if (error) return NextResponse.json({ error: 'Bookings could not be loaded.' }, { status: 500 })
  return NextResponse.json({ bookings: data ?? [] })
})
