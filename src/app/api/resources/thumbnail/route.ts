// POST /api/resources/thumbnail {org_id, id}            makes (or remakes) one resource's
//                                                       thumbnail: after an upload and after
//                                                       Replace file
// POST /api/resources/thumbnail {org_id, missing: true} backfill: renders the org's files
//                                                       that have no thumbnail yet, archived
//                                                       ones included, within a time budget;
//                                                       `remaining` says whether to call again
//
// Resource Library thumbnails (docs/plans/hub-resource-thumbnails.md). Platform superadmin
// and a member of the org. PDFs and images are rendered here, server-side, to
// <storage path>.thumb.webp in the same private bucket; DOCX and other types keep their
// file-type tile. A failure answers state 'tile' with status 200: it never blocks the
// upload, and a later backfill can try again. File contents are never logged.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, forbidden, bad } from '@/lib/api-guard'
import { RESOURCE_BUCKET, ONLY_SUPERADMIN, isUuid } from '@/lib/resources/common'
import { existingThumbs, SIGNED_THUMB_SECONDS } from '@/lib/resources/thumb-store'
import { generateThumbnail } from '@/lib/resources/thumb-generate'
import { needsThumbnail, thumbPath, thumbKind } from '@/lib/resources/thumbs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** A backfill stops starting new files after this long, so it ends inside maxDuration. */
const BACKFILL_BUDGET_MS = 30_000

export const POST = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const body = await req.json().catch(() => ({}))
  const orgId = requireOrg(ctx, body.org_id)
  if (orgId instanceof Response) return orgId

  if (body.missing === true) {
    const [{ data: rows, error }, existing] = await Promise.all([
      ctx.db.from('hub_resources').select('id, storage_path, mime_type').eq('org_id', orgId).order('sort_order'),
      existingThumbs(ctx.db, orgId),
    ])
    if (error || !existing) return NextResponse.json({ error: 'The library could not be read.' }, { status: 500 })
    const todo = needsThumbnail(rows ?? [], existing)
    const started = Date.now()
    let ready = 0, tile = 0, done = 0
    for (const f of todo) {
      if (Date.now() - started > BACKFILL_BUDGET_MS) break
      if ((await generateThumbnail(ctx.db, f)) === 'ready') ready++
      else tile++
      done++
    }
    if (tile) console.error(`[resources-thumbnail] backfill: ${tile} file(s) kept the tile`)
    return NextResponse.json({ ok: true, ready, tile, remaining: todo.length - done })
  }

  if (!isUuid(body.id)) return bad('Choose a resource.')
  const { data: row } = await ctx.db.from('hub_resources').select('id, storage_path, mime_type')
    .eq('id', body.id).eq('org_id', orgId).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const state = await generateThumbnail(ctx.db, row)
  if (state === 'tile' && thumbKind(row.mime_type) !== 'tile') console.error('[resources-thumbnail] rendering failed; kept the tile')
  let thumbUrl: string | null = null
  if (state === 'ready') {
    const { data } = await ctx.db.storage.from(RESOURCE_BUCKET).createSignedUrl(thumbPath(row.storage_path), SIGNED_THUMB_SECONDS)
    thumbUrl = data?.signedUrl ?? null
  }
  return NextResponse.json({ ok: true, state, thumb_url: thumbUrl })
})
