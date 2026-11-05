// src/lib/resources/thumb-store.ts
// Thumbnails against storage: list which thumbnails exist in an org's folder, and sign
// short-lived URLs for the list and the Send resources panel. Nothing here renders
// (thumb-generate.ts does), so the routes using it stay free of pdfjs and canvas. Service role
// only; the bucket stays private and no URL outlives SIGNED_THUMB_SECONDS.
import type { SupabaseClient } from '@supabase/supabase-js'
import { RESOURCE_BUCKET } from './common'
import { thumbPath, THUMB_SUFFIX } from './thumbs'

export const SIGNED_THUMB_SECONDS = 60 * 60

/** Every thumbnail object in the org's folder, as full storage paths (null on a read error). */
export async function existingThumbs(db: SupabaseClient, orgId: string): Promise<Set<string> | null> {
  const found = new Set<string>()
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const { data, error } = await db.storage.from(RESOURCE_BUCKET).list(orgId, { limit: 1000, offset })
    if (error) return null
    for (const o of data ?? []) if (o.name.endsWith(THUMB_SUFFIX)) found.add(`${orgId}/${o.name}`)
    if (!data || data.length < 1000) break
  }
  return found
}

/** Signed thumbnail URLs by resource id, for the resources whose thumbnail exists. Files
 *  without one are left out, and the page shows their file-type tile. */
export async function thumbUrls(
  db: SupabaseClient, orgId: string, rows: { id: string; storage_path: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!rows.length) return out
  const existing = await existingThumbs(db, orgId)
  if (!existing) return out
  const withThumb = rows.filter(r => existing.has(thumbPath(r.storage_path)))
  if (!withThumb.length) return out
  const { data } = await db.storage.from(RESOURCE_BUCKET)
    .createSignedUrls(withThumb.map(r => thumbPath(r.storage_path)), SIGNED_THUMB_SECONDS)
  for (const s of data ?? []) {
    const row = withThumb.find(r => thumbPath(r.storage_path) === s.path)
    if (row && s.signedUrl && !s.error) out.set(row.id, s.signedUrl)
  }
  return out
}
