// POST  /api/resolve { contact_id, scope, reason, note? }   "No reply needed": staff of the contact's org; the session
//                                                          user is resolved_by. Clears for the scope in the same call.
// GET   /api/resolve?contact_id=                           the contact's live resolutions (who, reason, when), for the
//                                                          button and the Waiting on us line; same for every staff login
// PATCH /api/resolve { id, action: 'reopen' }              Reopen: reopened_at with reason 'manual'
// Keyed on the contact, never the login (src/lib/resolve/rules.ts). Before hub_250 is applied, POST and PATCH answer 503
// and GET returns nothing.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg } from '@/lib/api-guard'
import { REASONS, SCOPES, reopenResolution, resolutionsFor, resolveContact, type Reason, type Scope } from '@/lib/resolve/rules'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function contactOrg(db: any, id: unknown): Promise<string | null> {
  if (typeof id !== 'string' || !UUID.test(id)) return null
  const { data } = await db.from('contacts').select('org_id').eq('id', id).maybeSingle()
  return (data as any)?.org_id ?? null
}

export const GET = withStaff(async (req: NextRequest, ctx) => {
  const id = req.nextUrl.searchParams.get('contact_id')
  const orgId = await contactOrg(ctx.db, id)
  if (!orgId) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const ok = requireOrg(ctx, orgId)
  if (ok instanceof Response) return ok
  return NextResponse.json({ resolutions: await resolutionsFor(ctx.db, orgId, id!) })
})

export const POST = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => ({}))
  const orgId = await contactOrg(ctx.db, body?.contact_id)
  if (!orgId) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
  const ok = requireOrg(ctx, orgId)
  if (ok instanceof Response) return ok
  const scope = SCOPES.find((s) => s === body?.scope) as Scope | undefined
  const reason = REASONS.find((r) => r === body?.reason) as Reason | undefined
  if (!scope || !reason) return NextResponse.json({ error: 'Choose a reason.' }, { status: 400 })
  try {
    const r = await resolveContact(ctx.db, { orgId, contactId: body.contact_id, scope, reason, note: body?.note ?? null, byUserId: ctx.userId })
    return NextResponse.json(r.body, { status: r.status })
  } catch (e: any) {
    console.error(`[resolve] failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ error: 'It could not be saved. Try again.' }, { status: 500 })
  }
})

export const PATCH = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => ({}))
  if (body?.action !== 'reopen' || typeof body?.id !== 'string' || !UUID.test(body.id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const { data } = await ctx.db.from('hub_contact_resolutions').select('org_id').eq('id', body.id).maybeSingle()
  const orgId = (data as any)?.org_id
  if (!orgId) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const ok = requireOrg(ctx, orgId)
  if (ok instanceof Response) return ok
  const r = await reopenResolution(ctx.db, orgId, body.id, ctx.userId)
  return NextResponse.json(r.body, { status: r.status })
})
