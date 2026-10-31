// src/app/api/quick-send/upload-complete/route.ts
// Step 2 of a Quick Send upload: the file is in storage (upload-url), so record it.
//
// POST { org_id, path, name, category_id, description?, available? }
//   A new Media Library item (media_assets, the same fields /api/media/upload
//   writes), already in Quick Send with its category.
// POST { org_id, path, replace_asset_id }
//   "Replace file": the existing item points at the new file. Its title, category,
//   availability and send history stay. The old file is left in storage.
//
// The path must be one upload-url hands out for this org, and the object must
// exist; its size and type are read from storage, not from the request.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { QUICK_SEND_UPLOAD_TYPES } from '@/lib/quick-send'
import { MEDIA_BUCKET, brandForOrg, categoryInOrg } from '@/lib/quick-send-server'

export const POST = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null)
  const orgId = requireOrg(ctx, body?.org_id)
  if (orgId instanceof Response) return orgId
  const path = typeof body?.path === 'string' ? body.path : ''
  const folder = `${orgId}/assets`
  const file = path.slice(folder.length + 1)
  if (!path.startsWith(`${folder}/`) || !file || file.includes('/') || path.includes('..')) return bad('That upload is not valid. Try again.')

  const { data: listed, error: lErr } = await ctx.db.storage.from(MEDIA_BUCKET).list(folder, { search: file, limit: 10 })
  const obj = (listed || []).find(o => o.name === file)
  if (lErr || !obj) return bad('The file did not finish uploading. Try again.')
  const size = Number((obj.metadata as any)?.size) || null
  const mime = String((obj.metadata as any)?.mimetype || '')
  if (!QUICK_SEND_UPLOAD_TYPES[mime]) return bad('Upload a PDF, Word (.docx), PowerPoint (.pptx), PNG or JPG file.')
  const url = ctx.db.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl
  const thumbnail = mime.startsWith('image/') ? `${url}?width=400&height=300&resize=cover` : null

  // Replace the file behind an existing Quick Send resource.
  if (typeof body?.replace_asset_id === 'string') {
    const { data: item } = await ctx.db.from('hub_quick_send_items').select('media_asset_id')
      .eq('media_asset_id', body.replace_asset_id).eq('org_id', orgId).maybeSingle()
    if (!item) return NextResponse.json({ error: 'That resource was not found.' }, { status: 404 })
    const { error } = await ctx.db.from('media_assets')
      .update({ url, storage_path: path, mime_type: mime, file_size: size, thumbnail_url: thumbnail })
      .eq('id', body.replace_asset_id).eq('org_id', orgId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await ctx.db.from('hub_quick_send_items').update({ updated_by: ctx.userId, updated_at: new Date().toISOString() })
      .eq('media_asset_id', body.replace_asset_id).eq('org_id', orgId)
    return NextResponse.json({ ok: true, media_asset_id: body.replace_asset_id })
  }

  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : file
  if (!(await categoryInOrg(ctx.db, orgId, body?.category_id))) return bad('Pick a Quick Send category.')
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  if (description.length > 200) return bad('Keep the description to one line, 200 characters at most.')

  const { data: asset, error: aErr } = await ctx.db.from('media_assets').insert({
    org_id: orgId,
    collection_id: null,
    name,
    url,
    thumbnail_url: thumbnail,
    storage_path: path,
    mime_type: mime,
    file_size: size,
    brand: brandForOrg(orgId),
    created_by: ctx.userId,
  }).select('id').single()
  if (aErr || !asset) return NextResponse.json({ error: `The file uploaded but could not be saved: ${aErr?.message || 'unknown error'}` }, { status: 500 })

  const { error: iErr } = await ctx.db.from('hub_quick_send_items').insert({
    media_asset_id: asset.id,
    org_id: orgId,
    category_id: body.category_id,
    available: body?.available !== false,
    description: description || null,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  })
  if (iErr) return NextResponse.json({ error: `The file is in the Media Library but not in Quick Send: ${iErr.message}` }, { status: 500 })
  return NextResponse.json({ ok: true, media_asset_id: asset.id })
})
