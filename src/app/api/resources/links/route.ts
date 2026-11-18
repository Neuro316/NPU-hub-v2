// GET  /api/resources/links?contact_id=   Share a resource (contact card): the org's active resources, and the
//                                         tracked links already made for this contact with their first and
//                                         latest click
// POST /api/resources/links {contact_id, resource_id}
//                                         makes one tracked link <hub>/r/<code> and returns it to copy
//
// Running List q33 (hub_240). Same access as the rest of the Resource Library: a platform superadmin who is a
// member of the CONTACT's org (the org comes from the contact row). Making a link SENDS NOTHING: the staff member
// pastes it into their own email or text. See src/lib/resources/links.ts.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, forbidden, bad, type StaffContext } from '@/lib/api-guard'
import { ONLY_SUPERADMIN, isUuid } from '@/lib/resources/common'
import { createShareLink, linkUrl } from '@/lib/resources/links'

export const dynamic = 'force-dynamic'

async function contactOrg(ctx: StaffContext, contactId: unknown): Promise<{ id: string; orgId: string } | Response> {
  if (!isUuid(contactId)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const { data: contact } = await ctx.db.from('contacts').select('id, org_id').eq('id', contactId).maybeSingle()
  if (!contact) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const orgId = requireOrg(ctx, (contact as any).org_id)
  if (orgId instanceof Response) return orgId
  return { id: (contact as any).id, orgId }
}

export const GET = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const c = await contactOrg(ctx, req.nextUrl.searchParams.get('contact_id'))
  if (c instanceof Response) return c
  const [resources, links] = await Promise.all([
    ctx.db.from('hub_resources').select('id, name, kind, url').eq('org_id', c.orgId).is('archived_at', null).order('sort_order').order('created_at'),
    ctx.db.from('hub_resource_links').select('id, code, resource_id, created_at, first_clicked_at, last_clicked_at, click_count, revoked_at')
      .eq('contact_id', c.id).eq('org_id', c.orgId).order('created_at', { ascending: false }).limit(20),
  ])
  if (resources.error || links.error) return NextResponse.json({ error: 'Resources could not be loaded.' }, { status: 500 })
  const origin = req.nextUrl.origin
  const names = new Map(((resources.data ?? []) as any[]).map((r) => [r.id, r.name]))
  return NextResponse.json({
    resources: ((resources.data ?? []) as any[]).map((r) => ({ id: r.id, name: r.name, kind: r.kind, is_link: !!r.url })),
    links: ((links.data ?? []) as any[]).map(({ code, ...l }) => ({ ...l, url: linkUrl(origin, code), resource_name: names.get(l.resource_id) ?? 'A retired resource' })),
  })
})

export const POST = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const body = await req.json().catch(() => ({} as any))
  const c = await contactOrg(ctx, body?.contact_id)
  if (c instanceof Response) return c
  if (!isUuid(body?.resource_id)) return bad('Choose a resource.')
  const r = await createShareLink(ctx.db, { orgId: c.orgId, contactId: c.id, resourceId: body.resource_id, userId: ctx.userId, origin: req.nextUrl.origin, now: new Date() })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, id: r.id, url: r.url })
})
