import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg } from '@/lib/api-guard'
import { appsScriptUrl } from '@/lib/apps-script-url'

// Guarded (2026-11-08): Hub staff of the org named. The Apps Script URL is a credential (Vault); this route proxies
// to it and never returns it.
export const maxDuration = 30
export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json()
    const { orgId, action, ...payload } = body

    if (!action) return NextResponse.json({ success: false, error: 'action required' })
    const org = requireOrg(ctx, orgId)
    if (org instanceof Response) return org

    const url = await appsScriptUrl(ctx.db, org)
    if (!url) {
      return NextResponse.json({ success: false, error: 'Google Apps Script not configured. Go to Integrations to set it up.' })
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    })

    const text = await response.text()
    try {
      return NextResponse.json(JSON.parse(text))
    } catch {
      return NextResponse.json({ success: false, error: 'Apps Script returned invalid response.' })
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Server error' }, { status: 500 })
  }
})
