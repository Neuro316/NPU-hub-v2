import { NextRequest, NextResponse } from 'next/server'
import { getAnthropicClient } from '@/lib/crm-ai'

// GET /api/equipment/test-ai?org_id=XXX — test if Anthropic API works
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const steps: string[] = []

  try {
    steps.push('1. Getting Anthropic client...')
    const client = await getAnthropicClient(orgId || undefined)
    steps.push('2. Client created OK')

    steps.push('3. Sending test message (text only, no image)...')
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Reply with just the word "OK"' }],
    })
    steps.push('4. Response received')

    const text = response.content[0]?.type === 'text' ? response.content[0].text : 'no text'
    steps.push(`5. Result: "${text}"`)

    return NextResponse.json({ success: true, steps, response: text })
  } catch (e: any) {
    steps.push(`FAILED: ${e.message || String(e)}`)
    return NextResponse.json({ success: false, steps, error: e.message }, { status: 500 })
  }
}
