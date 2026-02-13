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

  // Try apps_script setting first (unified)
  const { data: asSetting } = await supabase
    .from('org_settings')
    .select('value')
    .eq('org_id', orgId)
    .eq('key', 'apps_script')
    .single()

  if (asSetting?.value?.url && asSetting?.value?.enabled) {
    return asSetting.value.url
  }

  // Fallback to gmail setting
  const { data: gmailSetting } = await supabase
    .from('org_settings')
    .select('value')
    .eq('org_id', orgId)
    .eq('key', 'gmail')
    .single()

  if (gmailSetting?.value?.apps_script_url && gmailSetting?.value?.enabled) {
    return gmailSetting.value.apps_script_url
  }

  // Fallback to env var
  return process.env.APPS_SCRIPT_URL || null
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    const { recipientName, recipientEmail, personalNote, resources, cardName, senderName, senderEmail, orgId, useSenderFromSettings } = data

    if (!recipientName?.trim()) return NextResponse.json({ success: false, error: 'Recipient name required' })
    if (!recipientEmail?.trim() || !recipientEmail.includes('@')) return NextResponse.json({ success: false, error: 'Valid email required' })
    if (!resources?.length) return NextResponse.json({ success: false, error: 'At least one resource required' })

    // Get sender info from settings if requested
    let finalSenderName = senderName || 'Cameron Allen'
    let finalSenderEmail = senderEmail || 'cameron.allen@neuroprogeny.com'

    if (useSenderFromSettings && orgId) {
      const cookieStore = await cookies()
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
      )
      const { data: gmailSetting } = await supabase.from('org_settings').select('value').eq('org_id', orgId).eq('key', 'gmail').single()
      if (gmailSetting?.value?.sender_name) finalSenderName = gmailSetting.value.sender_name
      if (gmailSetting?.value?.sender_email) finalSenderEmail = gmailSetting.value.sender_email
    }

    const appsScriptUrl = orgId ? await getAppsScriptUrl(orgId) : process.env.APPS_SCRIPT_URL || null

    if (appsScriptUrl) {
      const response = await fetch(appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sendResourceEmail',
          recipientName,
          recipientEmail,
          personalNote: personalNote || '',
          resources,
          cardName: cardName || 'Journey Card',
          senderName: finalSenderName,
          senderEmail: finalSenderEmail,
        }),
      })

      const text = await response.text()
      try {
        return NextResponse.json(JSON.parse(text))
      } catch {
        return NextResponse.json({ success: false, error: 'Apps Script returned invalid response. Redeploy the Web App.' })
      }
    }

    return NextResponse.json({
      success: false,
      error: 'Google Apps Script not configured. Go to Integrations to set it up.',
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Server error' }, { status: 500 })
  }
}
