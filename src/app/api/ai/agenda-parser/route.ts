import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'Missing ANTHROPIC_API_KEY' }, { status: 500 })

  const { raw_text, template, duration_minutes, title } = await req.json()

  if (!raw_text?.trim()) return NextResponse.json({ error: 'No text provided' }, { status: 400 })

  const systemPrompt = `You are a world-class meeting facilitator. Parse the provided agenda text into structured sections.

Rules:
- Extract distinct agenda sections/topics from the text
- For each section, identify the key talking points, discussion items, or sub-topics
- Assign reasonable time allocations that total approximately ${duration_minutes || 60} minutes
- If the text is very brief, expand each topic into 2-3 concrete talking points
- If a meeting template "${template || 'custom'}" is specified, try to map content to that framework
- Return ONLY valid JSON, no markdown

Return format:
{
  "sections": [
    {
      "section": "Section Name",
      "duration_min": 10,
      "talking_points": ["Point 1", "Point 2", "Point 3"],
      "notes": ""
    }
  ]
}`

  const userPrompt = `Meeting: ${title || 'Team Meeting'}
Duration: ${duration_minutes || 60} minutes
Template: ${template || 'custom'}

Agenda content to parse:
---
${raw_text}
---

Parse this into structured sections with talking points. Return only JSON.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json({ error: `AI service error: ${res.status}`, details: errText }, { status: 502 })
    }

    const data = await res.json()
    const text = data.content?.[0]?.text || ''

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })

    const parsed = JSON.parse(jsonMatch[0])
    const sections = (parsed.sections || []).map((s: any) => ({
      section: s.section || 'Untitled',
      duration_min: s.duration_min || 10,
      notes: s.notes || '',
      completed: false,
      talking_points: Array.isArray(s.talking_points) ? s.talking_points : [],
    }))

    return NextResponse.json({ sections })
  } catch (e: any) {
    return NextResponse.json({ error: 'AI parse failed', details: e.message }, { status: 500 })
  }
}
