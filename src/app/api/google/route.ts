import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const maxDuration = 30

async function getAppsScriptUrl(orgId: string): Promise<string | null> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )

  const { data } = await supabase
    .from('org_settings')
    .select('setting_value')
    .eq('org_id', orgId)
    .eq('setting_key', 'apps_script')
    .single()

  if (data?.setting_value?.url && data?.setting_value?.enabled) return data.setting_value.url
  return process.env.APPS_SCRIPT_URL || null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { orgId, action, ...payload } = body

    if (!action) return NextResponse.json({ success: false, error: 'action required' })
    if (!orgId) return NextResponse.json({ success: false, error: 'orgId required' })

    const url = await getAppsScriptUrl(orgId)
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
}
