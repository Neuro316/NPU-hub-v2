import { NextRequest, NextResponse } from 'next/server'
import { getAnthropicClient } from '@/lib/crm-ai'

export const maxDuration = 30

const SERIAL_PROMPT = `Extract all serial numbers from this image of a Meta Quest headset label/sticker.

Serial number patterns:
- Bundle serial: starts with "340YB" or "3497B", 14 characters alphanumeric
- Headset serial: starts with "340YC" or "3497C", 14 characters alphanumeric

Return ONLY valid JSON, no other text:
{"serials":[{"value":"XXXXX","type":"bundle"}],"raw_text":"all visible text","confidence":85}

If no serial numbers found, return:
{"serials":[],"raw_text":"","confidence":0}`

export async function POST(req: NextRequest) {
  let step = 'parsing request'
  try {
    const body = await req.json()
    const { image_base64, media_type, org_id } = body

    if (!image_base64) return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    if (!org_id) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

    const sizeKB = Math.round(image_base64.length / 1024)
    console.log(`[equipment/scan] Image: ${sizeKB}KB, org: ${org_id}`)

    if (image_base64.length > 4 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large. Move closer to the serial number.' }, { status: 400 })
    }

    step = 'getting AI client'
    const client = await getAnthropicClient(org_id)

    step = 'calling Claude API'
    console.log('[equipment/scan] Calling Claude...')

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: (media_type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: image_base64,
            },
          },
          { type: 'text', text: SERIAL_PROMPT },
        ],
      }],
    })

    step = 'parsing response'
    console.log('[equipment/scan] Response received, stop_reason:', response.stop_reason)

    const block = response.content[0]
    if (block.type !== 'text') {
      return NextResponse.json({ serials: [], raw_text: '', confidence: 0 })
    }

    console.log('[equipment/scan] Text:', block.text.substring(0, 200))

    let text = block.text.trim()
    if (text.startsWith('```')) {
      text = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()
    }

    try {
      const result = JSON.parse(text)
      return NextResponse.json(result)
    } catch {
      // Try to extract serials from raw text with regex
      const serialPattern = /3(?:40Y|497)[BC][A-Z0-9]{9,11}/g
      const matches = text.match(serialPattern) || []
      const serials = matches.map(m => ({
        value: m,
        type: m.includes('40YB') || m.includes('497B') ? 'bundle' : 'headset',
      }))
      return NextResponse.json({
        serials,
        raw_text: text,
        confidence: serials.length > 0 ? 60 : 0,
      })
    }
  } catch (e: any) {
    const msg = e?.message || String(e)
    console.error(`[equipment/scan] Failed at step "${step}":`, msg)

    // Return helpful error messages
    if (msg.includes('Could not process image') || msg.includes('invalid_request')) {
      return NextResponse.json({ error: 'Could not read image. Try taking the photo closer and with better lighting.' }, { status: 400 })
    }
    if (msg.includes('model') || msg.includes('not_found')) {
      return NextResponse.json({ error: 'AI model unavailable. Contact admin.' }, { status: 500 })
    }
    if (msg.includes('authentication') || msg.includes('401') || msg.includes('invalid x-api-key')) {
      return NextResponse.json({ error: 'AI API key is invalid. Check Settings > AI Integration.' }, { status: 401 })
    }
    if (msg.includes('rate') || msg.includes('429')) {
      return NextResponse.json({ error: 'AI rate limited. Wait a moment and try again.' }, { status: 429 })
    }
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
      return NextResponse.json({ error: 'AI took too long. Try again with a clearer photo.' }, { status: 504 })
    }

    return NextResponse.json({ error: `Scan failed (${step}): ${msg.substring(0, 100)}` }, { status: 500 })
  }
}
