import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'Missing ANTHROPIC_API_KEY' }, { status: 500 })

  const { raw_text, template, duration_minutes, title } = await req.json()
  if (!raw_text?.trim()) return NextResponse.json({ error: 'No text provided' }, { status: 400 })

  const systemPrompt = `You are a world-class meeting facilitator and productivity expert.

Parse the provided agenda text into structured meeting sections. Follow these rules precisely:

TIME DETECTION:
- Look for times embedded in the text like "(5 min)", "- 10 minutes", "15m", "[20 min]", etc.
- If a section has a time specified, use EXACTLY that time
- If no time is specified for a section, distribute remaining time proportionally
- Total should approximately equal ${duration_minutes || 60} minutes

SECTION EXTRACTION:
- Each major topic, header, or numbered item becomes a section
- Preserve the original section names as closely as possible
- If text has sub-bullets under a header, those become talking_points

DISCUSSION PROMPTS:
- For EACH section, generate 2-4 guiding questions that a facilitator would ask
- These should be specific, actionable questions that drive productive discussion
- Examples: "What's our biggest blocker this week?", "Who owns the follow-up on this?"

Return ONLY valid JSON:
{
  "sections": [
    {
      "section": "Section Name",
      "duration_min": 10,
      "talking_points": ["Sub-topic 1", "Sub-topic 2"],
      "prompts": ["Question to ask the team?", "What decision needs to be made?"],
      "notes": ""
    }
  ]
}`

  const userPrompt = `Meeting: ${title || 'Team Meeting'}
Total Duration: ${duration_minutes || 60} minutes
Template: ${template || 'custom'}

Agenda to parse (detect any times in headers):
---
${raw_text}
---

Parse into sections. Detect times from the text. Generate facilitator prompts for each section. Return only JSON.`

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
      return NextResponse.json({ error: `AI error: ${res.status}`, details: errText }, { status: 502 })
    }

    const data = await res.json()
    const text = data.content?.[0]?.text || ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })

    const parsed = JSON.parse(jsonMatch[0])
    const sections = (parsed.sections || []).map((s: any) => ({
      section: s.section || 'Untitled',
      duration_min: s.duration_min || 10,
      notes: s.notes || '',
      completed: false,
      talking_points: Array.isArray(s.talking_points) ? s.talking_points : [],
      prompts: Array.isArray(s.prompts) ? s.prompts : [],
    }))

    return NextResponse.json({ sections })
  } catch (e: any) {
    return NextResponse.json({ error: 'AI parse failed', details: e.message }, { status: 500 })
  }
}
