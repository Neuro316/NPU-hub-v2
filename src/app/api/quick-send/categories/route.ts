// src/app/api/quick-send/categories/route.ts
// Add a Quick Send category. Admins only.
//
// POST { org_id, name }
//
// Names are unique per org, ignoring case (hub_quick_send_categories_org_name), so
// adding "programs" when "Programs" exists returns the existing one.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, isOrgAdmin, forbidden, bad } from '@/lib/api-guard'

export const POST = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null)
  const orgId = requireOrg(ctx, body?.org_id)
  if (orgId instanceof Response) return orgId
  if (!isOrgAdmin(ctx, orgId)) return forbidden('Only an admin can add a category.')
  const name = typeof body?.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : ''
  if (!name || name.length > 60) return bad('Name the category in 60 characters or fewer.')

  const { data: live } = await ctx.db.from('hub_quick_send_categories')
    .select('id, name, sort_order').eq('org_id', orgId).is('archived_at', null)
  const same = (live || []).find(c => c.name.toLowerCase() === name.toLowerCase())
  if (same) return NextResponse.json({ category: same })

  const sortOrder = Math.max(-1, ...(live || []).map(c => c.sort_order)) + 1
  const { data, error } = await ctx.db.from('hub_quick_send_categories')
    .insert({ org_id: orgId, name, sort_order: sortOrder, created_by: ctx.userId })
    .select('id, name, sort_order').single()
  if (error) return NextResponse.json({ error: `The category could not be added: ${error.message}` }, { status: 500 })
  return NextResponse.json({ category: data })
})
