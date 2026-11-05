// src/lib/resources/thumb-generate.ts
// Renders and stores one Resource Library thumbnail (src/lib/resources/thumbs.ts holds the
// rules, thumb-render.ts the rendering). Only /api/resources/thumbnail imports this, so
// pdfjs and the canvas binary are traced into that one function; the list and send routes
// use thumb-store.ts, which never renders. Service role only; file contents never logged.
import type { SupabaseClient } from '@supabase/supabase-js'
import { RESOURCE_BUCKET } from './common'
import { makeThumbnail, type ThumbFile, type ThumbResult } from './thumbs'
import { renderPdfThumb, renderImageThumb } from './thumb-render'

/** Renders and stores one file's thumbnail. 'tile' on any failure; never throws. */
export async function generateThumbnail(db: SupabaseClient, file: ThumbFile): Promise<ThumbResult> {
  const bucket = db.storage.from(RESOURCE_BUCKET)
  return makeThumbnail(file, {
    async download(path) {
      const { data, error } = await bucket.download(path)
      if (error || !data) throw new Error('download failed')
      return new Uint8Array(await data.arrayBuffer())
    },
    renderPdf: renderPdfThumb,
    renderImage: renderImageThumb,
    async upload(path, webp) {
      const { error } = await bucket.upload(path, webp, { contentType: 'image/webp', upsert: true, cacheControl: '3600' })
      if (error) throw new Error('upload failed')
    },
  })
}
