// src/app/api/quick-send/upload-url/route.ts
// Step 1 of a Quick Send upload: a one-time signed upload URL into the existing
// 'media-library' bucket, at the same path shape /api/media/upload uses
// ({org}/assets/{timestamp}-{name}).
//
// POST { org_id, filename, content_type, size }  ->  { path, token }
//
// The browser then uploads the file straight to storage. A file never passes
// through this function, because Vercel caps a function's request body at 4.5 MB
// and handouts are often larger. Step 2 is /api/quick-send/upload-complete.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { QUICK_SEND_UPLOAD_TYPES, BUCKET_FILE_LIMIT_BYTES, formatBytes } from '@/lib/quick-send'
import { MEDIA_BUCKET } from '@/lib/quick-send-server'

export const POST = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null)
  const orgId = requireOrg(ctx, body?.org_id)
  if (orgId instanceof Response) return orgId
  const filename = typeof body?.filename === 'string' ? body.filename : ''
  const contentType = typeof body?.content_type === 'string' ? body.content_type : ''
  const size = Number(body?.size)
  if (!filename) return bad('filename is required')
  if (!QUICK_SEND_UPLOAD_TYPES[contentType]) return bad('Upload a PDF, Word (.docx), PowerPoint (.pptx), PNG or JPG file.')
  if (!Number.isFinite(size) || size <= 0) return bad('That file is empty.')
  if (size > BUCKET_FILE_LIMIT_BYTES) return bad(`That file is ${formatBytes(size)}. The Media Library takes files up to ${formatBytes(BUCKET_FILE_LIMIT_BYTES)}.`)

  const safe = filename.replace(/[^a-z0-9._-]/gi, '-').replace(/-+/g, '-').toLowerCase().slice(-120)
  const path = `${orgId}/assets/${Date.now()}-${safe}`
  const { data, error } = await ctx.db.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: `The upload could not start: ${error?.message || 'unknown error'}` }, { status: 500 })
  return NextResponse.json({ path: data.path, token: data.token })
})
