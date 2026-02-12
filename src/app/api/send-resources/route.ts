import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    const { recipientName, recipientEmail, personalNote, resources, cardName, senderName, senderEmail } = data

    // Validation
    if (!recipientName?.trim()) {
      return NextResponse.json({ success: false, error: 'Recipient name is required' })
    }
    if (!recipientEmail?.trim() || !recipientEmail.includes('@')) {
      return NextResponse.json({ success: false, error: 'Valid email is required' })
    }
    if (!resources?.length) {
      return NextResponse.json({ success: false, error: 'At least one resource is required' })
    }

    // Try Apps Script URL from env
    const appsScriptUrl = process.env.APPS_SCRIPT_URL

    if (appsScriptUrl) {
      // Forward to Apps Script for Gmail sending
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
          senderName: senderName || 'Cameron Allen',
          senderEmail: senderEmail || 'cameron.allen@neuroprogeny.com',
        }),
      })

      // Apps Script returns JSON wrapped in various formats
      const text = await response.text()
      try {
        const result = JSON.parse(text)
        return NextResponse.json(result)
      } catch {
        // Sometimes Apps Script returns HTML on first auth
        return NextResponse.json({ success: false, error: 'Apps Script returned non-JSON. Make sure the Web App is deployed and accessible.' })
      }
    }

    // Fallback: No Apps Script configured, return success with mailto hint
    // In production, this would use a proper email service (SendGrid, Resend, etc.)
    return NextResponse.json({
      success: false,
      error: 'Email service not configured. Add APPS_SCRIPT_URL to Vercel environment variables. See the Apps Script deployment guide.',
      fallback: {
        mailto: `mailto:${recipientEmail}?subject=${encodeURIComponent(`Resources from ${senderName || 'Cameron Allen'} - Neuro Progeny`)}&body=${encodeURIComponent(
          `Hi ${recipientName},\n\n${personalNote ? personalNote + '\n\n' : ''}Here are the resources from "${cardName}":\n\n${resources.map((r: any, i: number) => `${i + 1}. ${r.name}\n   ${r.url}`).join('\n\n')}\n\nSent from NPU Hub`
        )}`,
      },
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Server error' }, { status: 500 })
  }
}
