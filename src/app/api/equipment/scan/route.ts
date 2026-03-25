import { NextRequest, NextResponse } from 'next/server'
import { getAnthropicClient } from '@/lib/crm-ai'

// Increase Vercel function timeout
export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const { image_base64, media_type, org_id } = await req.json()
    if (!image_base64) {
      return NextResponse.json({ error: 'image_base64 is required' }, { status: 400 })
    }
    if (!org_id) {
      return NextResponse.json({ error: 'org_id is required' }, { status: 400 })
    }

    const imageSizeKB = Math.round(image_base64.length / 1024)
    console.log('[equipment/scan] Processing image, size:', imageSizeKB, 'KB, org:', org_id)

    // Reject if image is too large (>4MB base64 = ~3MB image)
    if (image_base64.length > 4 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large. Move closer to the serial number.' }, { status: 400 })
    }

    let client
    try {
      client = await getAnthropicClient(org_id)
    } catch (e: any) {
      console.error('[equipment/scan] Failed to get Anthropic client:', e)
      return NextResponse.json({ error: 'AI not configured. Check Settings > AI Integration for API key.' }, { status: 500 })
    }

    console.log('[equipment/scan] Calling Claude vision API...')
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: media_type || 'image/jpeg',
              data: image_base64,
            },
          },
          {
            type: 'text',
            text: `Extract all serial numbers from this image of a Meta Quest headset label/sticker.

Serial number patterns:
- Bundle serial: starts with "340YB" or "3497B", 14 characters alphanumeric
- Headset serial: starts with "340YC" or "3497C", 14 characters alphanumeric

Return ONLY valid JSON, no other text:
{"serials":[{"value":"XXXXX","type":"bundle"}],"raw_text":"all visible text","confidence":85}

If no serial numbers found, return:
{"serials":[],"raw_text":"","confidence":0}`,
          },
        ],
      }],
    })
    console.log('[equipment/scan] Claude responded, stop_reason:', response.stop_reason)

    const block = response.content[0]
    if (block.type !== 'text') {
      console.log('[equipment/scan] Non-text response block:', block.type)
      return NextResponse.json({ serials: [], raw_text: '', confidence: 0 })
    }

    console.log('[equipment/scan] Response text:', block.text.substring(0, 300))

    // Parse JSON from response, handling potential markdown wrapping
    let text = block.text.trim()
    if (text.startsWith('```')) {
      text = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()
    }

    try {
      const result = JSON.parse(text)
      return NextResponse.json(result)
    } catch {
      console.warn('[equipment/scan] Failed to parse JSON, raw:', text)
      return NextResponse.json({ serials: [], raw_text: text, confidence: 0 })
    }
  } catch (e: any) {
    console.error('[equipment/scan] error:', e?.message || e)
    const msg = e?.message || 'Scan failed'
    // Common Anthropic errors
    if (msg.includes('401') || msg.includes('authentication')) {
      return NextResponse.json({ error: 'AI API key invalid. Check Settings > AI Integration.' }, { status: 500 })
    }
    if (msg.includes('rate_limit') || msg.includes('429')) {
      return NextResponse.json({ error: 'AI rate limited. Wait a moment and try again.' }, { status: 429 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
