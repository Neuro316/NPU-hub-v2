// src/lib/resources/thumbs.ts
// Resource Library thumbnails: where they live, which files get one, the file-type tile
// label, and the generate-or-fall-back rule. Storage, download and rendering are injected,
// so scripts/tests/resource-thumbnails.test.mjs loads this file directly. No imports on
// purpose: node's type stripping cannot resolve '@/'.
//
// A thumbnail is a WebP beside its file in the same private bucket, at
// <storage path>.thumb.webp. No column records it: a file has a thumbnail when that object
// exists. PDFs (first page) and images get one; DOCX and anything else show a file-type
// tile. A failure never blocks an upload or a replace: the file keeps its tile and the
// backfill can try again.

export const THUMB_SUFFIX = '.thumb.webp'
/** Rendering one file may take this long before it counts as failed. */
export const THUMB_TIMEOUT_MS = 25_000

export type ThumbKind = 'pdf' | 'image' | 'tile'
export type ThumbResult = 'ready' | 'tile'

export const thumbPath = (storagePath: string) => `${storagePath}${THUMB_SUFFIX}`

export function thumbKind(mime: string): ThumbKind {
  const m = mime.toLowerCase()
  if (m === 'application/pdf') return 'pdf'
  if (m === 'image/png' || m === 'image/jpeg' || m === 'image/webp' || m === 'image/gif') return 'image'
  return 'tile'
}

const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/vnd.ms-powerpoint': 'PPT',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/gif': 'GIF', 'image/webp': 'WEBP',
}

/** The tile's label: from the type, else the file extension, else FILE. */
export function tileLabel(mime: string, fileName = ''): string {
  const known = MIME_LABELS[mime.toLowerCase()]
  if (known) return known
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toUpperCase() : ''
  return /^[A-Z0-9]{1,5}$/.test(ext) ? ext : 'FILE'
}

export interface ThumbFile { storage_path: string; mime_type: string }

export interface ThumbDeps {
  download(path: string): Promise<Uint8Array>
  renderPdf(bytes: Uint8Array): Promise<Uint8Array>
  renderImage(bytes: Uint8Array): Promise<Uint8Array>
  /** Writes (or overwrites) the thumbnail object. */
  upload(path: string, webp: Uint8Array): Promise<void>
  timeoutMs?: number
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('thumbnail timed out')), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

/** Makes (or remakes) one file's thumbnail. 'tile' when the type has none or anything
 *  fails: download, render, an empty result, the upload or the timeout. Never throws. */
export async function makeThumbnail(file: ThumbFile, deps: ThumbDeps): Promise<ThumbResult> {
  const kind = thumbKind(file.mime_type)
  if (kind === 'tile') return 'tile'
  try {
    const work = (async () => {
      const bytes = await deps.download(file.storage_path)
      const webp = kind === 'pdf' ? await deps.renderPdf(bytes) : await deps.renderImage(bytes)
      if (!webp || !webp.length) throw new Error('empty thumbnail')
      await deps.upload(thumbPath(file.storage_path), webp)
    })()
    await withTimeout(work, deps.timeoutMs ?? THUMB_TIMEOUT_MS)
    return 'ready'
  } catch {
    return 'tile'
  }
}

/** The files a backfill should render: a type that gets a thumbnail and no thumbnail yet.
 *  `existing` holds the object names present in the org's folder. */
export function needsThumbnail(files: ThumbFile[], existing: Set<string>): ThumbFile[] {
  return files.filter(f => thumbKind(f.mime_type) !== 'tile' && !existing.has(thumbPath(f.storage_path)))
}
