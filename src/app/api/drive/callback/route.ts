import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { exchangeCode } from '@/lib/google-drive'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const orgId = req.nextUrl.searchParams.get('state') // We pass orgId as state

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 })
  }

  try {
    const tokens = await exchangeCode(code)

    if (!tokens.refresh_token) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      return NextResponse.redirect(`${baseUrl}/settings?drive=error&msg=no_refresh_token`)
    }

    // Store refresh token in org_settings
    if (orgId) {
      const cookieStore = await cookies()
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
      )

      await supabase.from('org_settings').upsert({
        org_id: orgId,
        setting_key: 'google_drive',
        setting_value: {
          refresh_token: tokens.refresh_token,
          connected_at: new Date().toISOString(),
        },
      }, { onConflict: 'org_id,setting_key' })
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    return NextResponse.redirect(`${baseUrl}/settings?drive=connected`)
  } catch (error: any) {
    console.error('Drive OAuth callback error:', error)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    return NextResponse.redirect(`${baseUrl}/settings?drive=error&msg=${encodeURIComponent(error.message)}`)
  }
}
