import { NextRequest, NextResponse } from 'next/server'
import { getAnthropicClient } from '@/lib/crm-ai'
import { requireOrgMember, STAFF_TEAM_ROLES } from '@/lib/api-guard'

// GET /api/equipment/test-ai?org_id=XXX — test if Anthropic API works
// Guarded (2026-11-08): the caller must be staff of the org named (it spends that org's key).
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const member = await requireOrgMember(orgId, STAFF_TEAM_ROLES)
  if (member instanceof Response) return member
  const steps: string[] = []

  try {
    steps.push('1. Getting Anthropic client...')
    const client = await getAnthropicClient(member.orgId)
    steps.push('2. Client created OK')

    steps.push('3. Sending test message (text only, no image)...')
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Reply with just the word "OK"' }],
    })
    steps.push('4. Response received')

    const text = response.content[0]?.type === 'text' ? response.content[0].text : 'no text'
    steps.push(`5. Result: "${text}"`)

    return NextResponse.json({ success: true, steps, response: text })
  } catch (e: any) {
    steps.push('FAILED')
    console.error(`[test-ai] org=${member.orgId} failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ success: false, steps, error: 'The AI test failed.' }, { status: 500 })
  }
}
