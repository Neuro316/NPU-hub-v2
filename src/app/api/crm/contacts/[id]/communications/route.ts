// GET /api/crm/contacts/[id]/communications
// The contact card's Communications section (Running List q02): every touch with this contact and every contact
// merged into it, newest first. Staff of the CONTACT's org only (the org comes from the contact row, never the
// request). Service role behind withStaff; the browser never reads the mail, message, call or campaign tables.
// Mail privacy is applied here, per row, before anything is returned (src/lib/comms/privacy.ts). No body is ever
// selected or returned.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg } from '@/lib/api-guard'
import { loadCommunications, subjectFor } from '@/lib/comms/history'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GET = withStaff<{ id: string }>(async (_req: NextRequest, ctx, params) => {
  const id = params?.id
  if (!id || !UUID.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  try {
    const subject = await subjectFor(ctx.db, id)
    if (!subject) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const orgId = requireOrg(ctx, subject.orgId)
    if (orgId instanceof Response) return orgId
    const touches = await loadCommunications(ctx.db, { userId: ctx.userId, isSuperadmin: ctx.isSuperadmin }, subject)
    return NextResponse.json({ touches, merged: subject.ids.length - 1 })
  } catch (e: any) {
    console.error(`[communications] contact=${id} failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ error: 'Communications could not be loaded.' }, { status: 500 })
  }
})
