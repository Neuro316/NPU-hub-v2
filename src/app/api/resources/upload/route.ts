// POST /api/resources/upload {org_id, file_name, mime_type, size_bytes}
// A one-time signed upload URL into the private hub-resources bucket (Build 2). The
// browser uploads straight to storage (Vercel caps request bodies at 4.5 MB), then calls
// POST /api/resources, which reads the size and type back from storage. The bucket itself
// also enforces the type list and the 50 MB limit.
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { withStaff, requireOrg, forbidden, bad } from '@/lib/api-guard'
import { RESOURCE_BUCKET, RESOURCE_MIME, RESOURCE_MAX_BYTES, ONLY_SUPERADMIN, safeFileName } from '@/lib/resources/common'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const body = await req.json().catch(() => ({}))
  const orgId = requireOrg(ctx, body.org_id)
  if (orgId instanceof Response) return orgId
  const mime = typeof body.mime_type === 'string' ? body.mime_type.toLowerCase() : ''
  const size = Number(body.size_bytes)
  if (!RESOURCE_MIME.includes(mime)) return bad('Only PDF, DOCX and image files (JPEG, PNG, GIF, WebP) can be added.')
  if (!(size > 0 && size <= RESOURCE_MAX_BYTES)) return bad('Files can be at most 50 MB.')
  const fileName = safeFileName(typeof body.file_name === 'string' ? body.file_name : '')
  const path = `${orgId}/${randomUUID()}-${fileName}`
  const { data, error } = await ctx.db.storage.from(RESOURCE_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: 'The upload could not be started.' }, { status: 500 })
  return NextResponse.json({ path: data.path, token: data.token })
})
