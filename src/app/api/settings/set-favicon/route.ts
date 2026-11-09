// POST /api/settings/set-favicon { org_id, url }
// Staff-only (2026-11-08; was an unguarded GET that replaced any org's branding). Merges favicon_url into the org's
// branding setting, keeping logo_url and primary_color. The URL must be https.
import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg, bad } from '@/lib/api-guard'
import { patchSetting } from '@/lib/org-vault'

export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => ({} as any))
  const orgId = requireOrg(ctx, body?.org_id)
  if (orgId instanceof Response) return orgId
  const url = body?.url
  if (typeof url !== 'string' || url.length > 500) return bad('url required')
  try {
    if (new URL(url).protocol !== 'https:') return bad('The favicon URL must be https.')
  } catch {
    return bad('The favicon URL is not valid.')
  }
  try {
    await patchSetting(ctx.db, orgId, 'branding', { favicon_url: url })
    return NextResponse.json({ ok: true, favicon_url: url })
  } catch (e: any) {
    console.error(`[set-favicon] org=${orgId} failed: ${String(e?.message ?? 'error').slice(0, 60)}`)
    return NextResponse.json({ error: 'The favicon could not be saved.' }, { status: 500 })
  }
})
