// GET /api/resources/preview?org_id=&id=   a 5-minute signed URL to view one library file
//                                          (opened in a new tab from its thumbnail)
//
// Platform superadmin and a member of the org, like every Resource Library route. The URL
// is minted per click and never stored; the bucket stays private.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, forbidden } from '@/lib/api-guard'
import { RESOURCE_BUCKET, ONLY_SUPERADMIN, isUuid } from '@/lib/resources/common'

export const dynamic = 'force-dynamic'

const PREVIEW_SECONDS = 5 * 60

export const GET = withStaff(async (req: NextRequest, ctx) => {
  if (!ctx.isSuperadmin) return forbidden(ONLY_SUPERADMIN)
  const orgId = requireOrg(ctx, req.nextUrl.searchParams.get('org_id'))
  if (orgId instanceof Response) return orgId
  const id = req.nextUrl.searchParams.get('id')
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const { data: row } = await ctx.db.from('hub_resources').select('storage_path').eq('id', id).eq('org_id', orgId).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const { data, error } = await ctx.db.storage.from(RESOURCE_BUCKET).createSignedUrl(row.storage_path, PREVIEW_SECONDS)
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'The file could not be opened.' }, { status: 500 })
  return NextResponse.json({ url: data.signedUrl })
})
