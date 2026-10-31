// src/app/api/quick-send/items/route.ts
// Put an existing Media Library item in Quick Send, or change its Quick Send fields.
// Used by the Media Library toggle and by CRM Settings, Quick Send Resources.
//
// POST { org_id, media_asset_id, category_id?, available?, description?, name?, archived? }
//
// One row per media asset (hub_quick_send_items primary key), so the same file can
// never be listed twice: the first call creates the row, later calls update it.
// `name` renames the media asset itself (its title, shared with the Media Library).
// `archived: true` takes it out of Quick Send; the media asset is kept.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { categoryInOrg } from '@/lib/quick-send-server'

export const POST = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null)
  const orgId = requireOrg(ctx, body?.org_id)
  if (orgId instanceof Response) return orgId
  const assetId = body?.media_asset_id
  if (typeof assetId !== 'string') return bad('media_asset_id is required')

  const { data: asset, error: aErr } = await ctx.db.from('media_assets')
    .select('id, org_id, storage_path').eq('id', assetId).maybeSingle()
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })
  if (!asset || asset.org_id !== orgId) return NextResponse.json({ error: 'That Media Library item was not found.' }, { status: 404 })

  const { data: existing } = await ctx.db.from('hub_quick_send_items')
    .select('media_asset_id, org_id, category_id').eq('media_asset_id', assetId).maybeSingle()
  if (existing && existing.org_id !== orgId) return NextResponse.json({ error: 'That Media Library item was not found.' }, { status: 404 })

  const patch: Record<string, unknown> = { updated_by: ctx.userId, updated_at: new Date().toISOString() }
  if (body.category_id !== undefined) {
    if (!(await categoryInOrg(ctx.db, orgId, body.category_id))) return bad('Pick a Quick Send category.')
    patch.category_id = body.category_id
  }
  if (body.available !== undefined) {
    if (typeof body.available !== 'boolean') return bad('available must be true or false')
    // Quick Send attaches the stored file. A link-only item has none to attach.
    if (body.available && !asset.storage_path) return bad('Only uploaded files can be sent. This item is a link, so it cannot be attached.')
    patch.available = body.available
    // Turning an archived item back on brings it back to Quick Send.
    if (body.available) patch.archived_at = null
  }
  if (body.description !== undefined) {
    const d = typeof body.description === 'string' ? body.description.trim() : ''
    if (d.length > 200) return bad('Keep the description to one line, 200 characters at most.')
    patch.description = d || null
  }
  if (body.archived !== undefined) {
    patch.archived_at = body.archived ? new Date().toISOString() : null
    if (body.archived) patch.available = false
  }

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name || name.length > 200) return bad('Give the resource a title of 200 characters or fewer.')
    const { error } = await ctx.db.from('media_assets').update({ name }).eq('id', assetId).eq('org_id', orgId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (existing) {
    const { error } = await ctx.db.from('hub_quick_send_items').update(patch).eq('media_asset_id', assetId).eq('org_id', orgId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    if (!patch.category_id) return bad('Pick a Quick Send category.')
    const { error } = await ctx.db.from('hub_quick_send_items').insert({
      media_asset_id: assetId, org_id: orgId, created_by: ctx.userId, available: false, ...patch,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
})
