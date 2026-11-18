// GET   /api/resources?org_id=[&archived=1]   the org's resources (files and links), in order, with
//                                             the staff who can own one and, for each link, the
//                                             campaign steps that contain its URL
// POST  /api/resources {org_id, storage_path, name, description, is_default_followup, owner_id?, where_used?}
//                                             records a file the browser uploaded
// POST  /api/resources {org_id, url, kind, name, description?, owner_id?, where_used?}
//                                             adds a link resource (Running List q33, hub_240)
// PATCH /api/resources {org_id, id, name?, description?, is_default_followup?, archived?,
//                       replace_path?, kind?, url?, owner_id?, where_used?}
//                                             replace_path: Replace file (file rows only); url: link rows only.
//                                             archived: true is Retire. Nothing is ever deleted.
// PUT   /api/resources {org_id, order: [id, ...]}   rewrites sort_order
//
// Resources page (Build 2, docs/plans/hub-resource-library-rulings.md). Platform superadmin
// and a member of the org on every call. Size and type are read from storage, never from
// the browser. Archive, never delete: an archived file's object stays so links already
// sent keep working until they expire. Replace file points the resource at a new upload
// and keeps the old object for the same reason. Thumbnails: GET adds a short-lived
// thumb_url where one exists; the page asks /api/resources/thumbnail to make them.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, forbidden, bad } from '@/lib/api-guard'
import { RESOURCE_BUCKET, RESOURCE_MIME, RESOURCE_MAX_BYTES, RESOURCE_COLS, ONLY_SUPERADMIN, isUuid, isKind, kindForMime, cleanLinkUrl } from '@/lib/resources/common'
import { stepsUsing } from '@/lib/resources/links'
import { recipientOptions, STAFF_ROLES, type TeamRow } from '@/lib/notify/recipients'
import { thumbUrls } from '@/lib/resources/thumb-store'
import type { SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const cleanText = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** The org's active staff, each with its login's email: the choices for a resource's owner. */
async function staffOf(db: SupabaseClient, orgId: string) {
  const { data } = await db.from('team_profiles').select('user_id, display_name, email, role, status').eq('org_id', orgId)
    .eq('status', 'active').in('role', STAFF_ROLES)
  return recipientOptions((data ?? []) as TeamRow[])
}

/** An owner from the request: null to clear, a uuid of active staff of the org, else an error. */
async function ownerFrom(db: SupabaseClient, orgId: string, v: unknown): Promise<{ ok: true; value: string | null } | { ok: false }> {
  if (v === null || v === '') return { ok: true, value: null }
  if (!isUuid(v)) return { ok: false }
  return (await staffOf(db, orgId)).some((s) => s.user_id === v) ? { ok: true, value: v } : { ok: false }
}

/** For each link resource, the org's campaign steps whose subject or body contains its URL. */
async function whereUsedAuto(db: SupabaseClient, orgId: string, rows: Array<{ id: string; url?: unknown }>) {
  const out = new Map<string, Array<{ sequence_id: string; sequence_name: string; step_order: number }>>()
  const links = rows.filter((r) => typeof r.url === 'string' && r.url)
  if (!links.length) return out
  const { data: seqs } = await db.from('sequences').select('id, name').eq('org_id', orgId)
  const names = new Map(((seqs ?? []) as any[]).map((q) => [q.id as string, String(q.name ?? 'Untitled sequence')]))
  if (!names.size) return out
  const { data: steps } = await db.from('sequence_steps').select('id, sequence_id, step_order, subject, body').in('sequence_id', Array.from(names.keys()))
  for (const r of links) {
    const hit = stepsUsing(r.url as string, (steps ?? []) as any[])
    if (hit.length) out.set(r.id, hit.map((s) => ({ sequence_id: s.sequence_id, sequence_name: names.get(s.sequence_id) ?? 'Untitled sequence', step_order: s.step_order })))
  }
  return out
}

/** A browser upload at `path`, checked against storage: the type and size as stored, and
 *  the file name without its uuid prefix. A rejected object is removed. */
type Upload = { ok: false; error: string } | { ok: true; path: string; size: number; mime: string; fileName: string }

async function checkUpload(db: SupabaseClient, orgId: string | undefined, path: unknown): Promise<Upload> {
  if (!orgId || typeof path !== 'string' || !path.startsWith(`${orgId}/`) || path.includes('..') || path.endsWith('.thumb.webp')) {
    return { ok: false, error: 'That upload is not recognised.' }
  }
  const bucket = db.storage.from(RESOURCE_BUCKET)
  const { data: info, error } = await bucket.info(path)
  if (error || !info) return { ok: false, error: 'The upload did not finish. Try again.' }
  const size = Number(info.size ?? 0)
  const mime = String(info.contentType ?? '').split(';')[0].trim().toLowerCase()
  if (!RESOURCE_MIME.includes(mime) || !(size > 0 && size <= RESOURCE_MAX_BYTES)) {
    await bucket.remove([path])
    return { ok: false, error: 'Only PDF, DOCX and image files up to 50 MB can be added.' }
  }
  return { ok: true, path, size, mime, fileName: path.split('/').pop()!.replace(/^[0-9a-f-]{36}-/i, '') }
}

export const GET = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const orgId = requireOrg(ctx, req.nextUrl.searchParams.get('org_id'))
  if (orgId instanceof Response) return orgId
  let q = ctx.db.from('hub_resources').select(`${RESOURCE_COLS}, storage_path`).eq('org_id', orgId)
  if (req.nextUrl.searchParams.get('archived') !== '1') q = q.is('archived_at', null)
  const { data, error } = await q.order('sort_order').order('created_at')
  if (error) return NextResponse.json({ error: 'Resources could not be loaded.' }, { status: 500 })
  const rows = (data ?? []) as unknown as ({ id: string; storage_path: string } & Record<string, unknown>)[]
  const files = rows.filter((r) => r.storage_path)
  const [thumbs, used, staff] = await Promise.all([thumbUrls(ctx.db, orgId, files), whereUsedAuto(ctx.db, orgId, rows), staffOf(ctx.db, orgId)])
  return NextResponse.json({
    resources: rows.map(({ storage_path: _path, ...r }) => ({ ...r, thumb_url: thumbs.get(r.id) ?? null, used_in_steps: used.get(r.id) ?? [] })),
    staff,
  })
})

export const POST = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const body = await req.json().catch(() => ({}))
  const orgId = requireOrg(ctx, body.org_id)
  if (orgId instanceof Response) return orgId
  const name = cleanText(body.name, 200)
  if (!name) return bad('Give the resource a name.')
  const description = cleanText(body.description, 2000) || null
  const where_used = cleanText(body.where_used, 2000) || null
  const owner = await ownerFrom(ctx.db, orgId, body.owner_id ?? ctx.userId)
  if (!owner.ok) return bad('The owner must be active staff of this organization.')

  let source: Record<string, unknown>
  if (body.url !== undefined) {
    // a link resource: no file
    const url = cleanLinkUrl(body.url)
    if (!url) return bad('Enter a full https:// address.')
    if (!isKind(body.kind)) return bad('Choose a type.')
    source = { url, kind: body.kind }
  } else {
    const up = await checkUpload(ctx.db, orgId, body.storage_path)
    if (!up.ok) return bad(up.error)
    source = { file_name: up.fileName, storage_path: up.path, mime_type: up.mime, size_bytes: up.size, kind: isKind(body.kind) ? body.kind : kindForMime(up.mime) }
  }

  const { data: last } = await ctx.db.from('hub_resources').select('sort_order').eq('org_id', orgId)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const { data, error } = await ctx.db.from('hub_resources').insert({
    org_id: orgId, name, description, ...source, owner_id: owner.value, where_used,
    is_default_followup: source.url ? false : body.is_default_followup === true, sort_order: (last?.sort_order ?? -1) + 1, created_by: ctx.userId,
  }).select(RESOURCE_COLS).single()
  if (error?.code === '23505') return bad('That link is already in the library.')
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
  if (body.where_used !== undefined) patch.where_used = cleanText(body.where_used, 2000) || null
  if (body.kind !== undefined) {
    if (!isKind(body.kind)) return bad('Choose a type.')
    patch.kind = body.kind
  }
  if (body.owner_id !== undefined) {
    const owner = await ownerFrom(ctx.db, orgId, body.owner_id)
    if (!owner.ok) return bad('The owner must be active staff of this organization.')
    patch.owner_id = owner.value
  }
  if (body.url !== undefined || body.replace_path !== undefined) {
    const { data: cur } = await ctx.db.from('hub_resources').select('url').eq('id', body.id).eq('org_id', orgId).maybeSingle()
    if (!cur) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    if (body.url !== undefined && !(cur as any).url) return bad('A file resource has no address. Use Replace file.')
    if (body.replace_path !== undefined && (cur as any).url) return bad('A link resource has no file.')
  }
  if (body.url !== undefined) {
    const url = cleanLinkUrl(body.url)
    if (!url) return bad('Enter a full https:// address.')
    patch.url = url
  }
  if (body.replace_path !== undefined) {
    // Replace file: the resource points at the new upload. The old object (and its
    // thumbnail) stay in storage, so download links already sent keep working.
    const up = await checkUpload(ctx.db, orgId, body.replace_path)
    if (!up.ok) return bad(up.error)
    Object.assign(patch, { storage_path: up.path, file_name: up.fileName, mime_type: up.mime, size_bytes: up.size })
  }
  const { data, error } = await ctx.db.from('hub_resources').update(patch)
    .eq('id', body.id).eq('org_id', orgId).select(RESOURCE_COLS).maybeSingle()
  if (error?.code === '23505') return bad('That link is already in the library.')
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
