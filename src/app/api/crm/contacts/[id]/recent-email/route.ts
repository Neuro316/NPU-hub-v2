// GET /api/crm/contacts/[id]/recent-email
// Contact card › Recent email (Running List q31): the contact's last 7 email conversations, newest first. Staff of the
// CONTACT's org only (the org comes from the contact row, never the request). Service role behind withStaff; the
// browser never reads the mail tables. Mail privacy is applied here per thread (src/lib/comms/recent-email.ts, using
// mailView from privacy.ts) before anything is returned. No body, snippet or summary is ever selected or returned.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg } from '@/lib/api-guard'
import { subjectFor } from '@/lib/comms/history'
import { loadRecentEmail } from '@/lib/comms/recent-email'

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
    const lines = await loadRecentEmail(ctx.db, { userId: ctx.userId, isSuperadmin: ctx.isSuperadmin }, subject)
    return NextResponse.json({ lines })
  } catch (e: any) {
    console.error(`[recent-email] contact=${id} failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ error: 'Recent email could not be loaded.' }, { status: 500 })
  }
})
