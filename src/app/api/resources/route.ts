// GET   /api/resources?org_id=[&archived=1]   the org's resources, in order
// POST  /api/resources {org_id, storage_path, name, description, is_default_followup}
//                                             records a file the browser uploaded
// PATCH /api/resources {org_id, id, name?, description?, is_default_followup?, archived?}
// PUT   /api/resources {org_id, order: [id, ...]}   rewrites sort_order
//
// Resources page (Build 2, docs/plans/hub-resource-library-rulings.md). Platform superadmin
// and a member of the org on every call. Size and type are read from storage, never from
// the browser. Archive, never delete: an archived file's object stays so links already
// sent keep working until they expire.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, forbidden, bad } from '@/lib/api-guard'
import { RESOURCE_BUCKET, RESOURCE_MIME, RESOURCE_MAX_BYTES, RESOURCE_COLS, ONLY_SUPERADMIN, isUuid } from '@/lib/resources/common'

export const dynamic = 'force-dynamic'

const cleanText = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export const GET = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const orgId = requireOrg(ctx, req.nextUrl.searchParams.get('org_id'))
  if (orgId instanceof Response) return orgId
  let q = ctx.db.from('hub_resources').select(RESOURCE_COLS).eq('org_id', orgId)
  if (req.nextUrl.searchParams.get('archived') !== '1') q = q.is('archived_at', null)
  const { data, error } = await q.order('sort_order').order('created_at')
  if (error) return NextResponse.json({ error: 'Resources could not be loaded.' }, { status: 500 })
  return NextResponse.json({ resources: data ?? [] })
})

export const POST = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const body = await req.json().catch(() => ({}))
  const orgId = requireOrg(ctx, body.org_id)
  if (orgId instanceof Response) return orgId
  const path = typeof body.storage_path === 'string' ? body.storage_path : ''
  if (!path.startsWith(`${orgId}/`) || path.includes('..')) return bad('That upload is not recognised.')
  const name = cleanText(body.name, 200)
  if (!name) return bad('Give the resource a name.')
  const description = cleanText(body.description, 2000) || null

  const bucket = ctx.db.storage.from(RESOURCE_BUCKET)
  const { data: info, error: infoErr } = await bucket.info(path)
  if (infoErr || !info) return bad('The upload did not finish. Try again.')
  const size = Number(info.size ?? 0)
  const mime = String(info.contentType ?? '').split(';')[0].trim().toLowerCase()
  if (!RESOURCE_MIME.includes(mime) || !(size > 0 && size <= RESOURCE_MAX_BYTES)) {
    await bucket.remove([path])
    return bad('Only PDF, DOCX and image files up to 50 MB can be added.')
  }
  const { data: last } = await ctx.db.from('hub_resources').select('sort_order').eq('org_id', orgId)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const fileName = path.split('/').pop()!.replace(/^[0-9a-f-]{36}-/i, '')
  const { data, error } = await ctx.db.from('hub_resources').insert({
    org_id: orgId, name, description, file_name: fileName, storage_path: path, mime_type: mime, size_bytes: size,
    is_default_followup: body.is_default_followup === true, sort_order: (last?.sort_order ?? -1) + 1, created_by: ctx.userId,
  }).select(RESOURCE_COLS).single()
  if (error) return NextResponse.json({ error: 'The resource could not be saved.' }, { status: 500 })
  return NextResponse.json({ resource: data })
})

export const PATCH = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const body = await req.json().catch(() => ({}))
  const orgId = requireOrg(ctx, body.org_id)
  if (orgId instanceof Response) return orgId
  if (!isUuid(body.id)) return bad('Choose a resource.')
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) {
    const name = cleanText(body.name, 200)
    if (!name) return bad('Give the resource a name.')
    patch.name = name
  }
  if (body.description !== undefined) patch.description = cleanText(body.description, 2000) || null
  if (body.is_default_followup !== undefined) patch.is_default_followup = body.is_default_followup === true
  if (body.archived !== undefined) patch.archived_at = body.archived === true ? new Date().toISOString() : null
  const { data, error } = await ctx.db.from('hub_resources').update(patch)
    .eq('id', body.id).eq('org_id', orgId).select(RESOURCE_COLS).maybeSingle()
  if (error) return NextResponse.json({ error: 'The resource could not be saved.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  return NextResponse.json({ resource: data })
})

export const PUT = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const body = await req.json().catch(() => ({}))
  const orgId = requireOrg(ctx, body.org_id)
  if (orgId instanceof Response) return orgId
  const order: unknown[] = Array.isArray(body.order) ? body.order : []
  if (!order.length || order.length > 500 || !order.every(isUuid)) return bad('The new order is not valid.')
  for (let i = 0; i < order.length; i++) {
    const { error } = await ctx.db.from('hub_resources').update({ sort_order: i }).eq('id', order[i] as string).eq('org_id', orgId)
    if (error) return NextResponse.json({ error: 'The order could not be saved.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
})
