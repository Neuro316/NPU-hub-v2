import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

// GET /api/settings/read?org_id=XXX&key=YYY — read a single org_settings value (service role)
export async function GET(req: NextRequest) {
  try {
    const orgId = req.nextUrl.searchParams.get('org_id')
    const key = req.nextUrl.searchParams.get('key')
    if (!orgId || !key) return NextResponse.json({ error: 'org_id and key required' }, { status: 400 })

    const admin = createAdminSupabase()
    const { data, error } = await admin
      .from('org_settings')
      .select('setting_value')
      .eq('org_id', orgId)
      .eq('setting_key', key)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data || { setting_value: null })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
