import { NextRequest, NextResponse } from 'next/server'
import { withStaff, requireOrg } from '@/lib/api-guard'
import { appsScriptUrl } from '@/lib/apps-script-url'

// Guarded (2026-11-08): Hub staff; an orgId must be one of theirs. The Apps Script URL is a credential (Vault).
export const maxDuration = 30
export const dynamic = 'force-dynamic'

export const POST = withStaff(async (req: NextRequest, ctx) => {
  try {
    const data = await req.json()
    const { recipientName, recipientEmail, personalNote, resources, cardName, senderName, senderEmail, orgId: rawOrg, useSenderFromSettings } = data
    let orgId: string | null = null
    if (rawOrg) {
      const org = requireOrg(ctx, rawOrg)
      if (org instanceof Response) return org
      orgId = org
    }

    if (!recipientName?.trim()) return NextResponse.json({ success: false, error: 'Recipient name required' })
    if (!recipientEmail?.trim() || !recipientEmail.includes('@')) return NextResponse.json({ success: false, error: 'Valid email required' })
    if (!resources?.length) return NextResponse.json({ success: false, error: 'At least one resource required' })

    // Get sender info from settings if requested
    let finalSenderName = senderName || 'Cameron Allen'
    let finalSenderEmail = senderEmail || 'cameron.allen@neuroprogeny.com'

    if (useSenderFromSettings && orgId) {
      const { data: gmailSetting } = await ctx.db.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', 'gmail').single()
      if (gmailSetting?.setting_value?.sender_name) finalSenderName = gmailSetting.setting_value.sender_name
      if (gmailSetting?.setting_value?.sender_email) finalSenderEmail = gmailSetting.setting_value.sender_email
    }

    const scriptUrl = orgId ? await appsScriptUrl(ctx.db, orgId) : process.env.APPS_SCRIPT_URL || null

    if (scriptUrl) {
      const response = await fetch(scriptUrl, {
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
})
