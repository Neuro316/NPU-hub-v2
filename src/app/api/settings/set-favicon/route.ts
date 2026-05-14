import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const url = req.nextUrl.searchParams.get('url')

  if (!orgId || !url) {
    return NextResponse.json({ error: 'org_id and url required' }, { status: 400 })
  }

  const admin = createAdminSupabase()
  const { error } = await admin.from('org_settings').upsert(
    { org_id: orgId, setting_key: 'branding', setting_value: { favicon_url: url } },
    { onConflict: 'org_id,setting_key' }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, favicon_url: url })
}
