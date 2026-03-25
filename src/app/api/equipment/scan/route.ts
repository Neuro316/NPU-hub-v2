import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { getAnthropicClient } from '@/lib/crm-ai'

export async function POST(req: NextRequest) {
  try {
    // Auth check (soft — log but don't block if cookies issue)
    try {
      const supabase = createServerSupabase()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        console.warn('[equipment/scan] No user from auth — proceeding anyway (cookies issue)')
      }
    } catch (authErr) {
      console.warn('[equipment/scan] Auth check failed:', authErr)
    }

    const { image_base64, media_type, org_id } = await req.json()
    if (!image_base64) {
      return NextResponse.json({ error: 'image_base64 is required' }, { status: 400 })
    }
    if (!org_id) {
      return NextResponse.json({ error: 'org_id is required' }, { status: 400 })
    }

    console.log('[equipment/scan] Processing image, size:', Math.round(image_base64.length / 1024), 'KB, org:', org_id)

    const client = await getAnthropicClient(org_id)
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

    const block = response.content[0]
    if (block.type !== 'text') {
      console.log('[equipment/scan] Non-text response block:', block.type)
      return NextResponse.json({ serials: [], raw_text: '', confidence: 0 })
    }

    console.log('[equipment/scan] Claude response:', block.text.substring(0, 200))

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
    console.error('[equipment/scan] error:', e)
    return NextResponse.json({ error: e.message || 'Scan failed' }, { status: 500 })
  }
}
