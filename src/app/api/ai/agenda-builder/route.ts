import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'Missing ANTHROPIC_API_KEY' }, { status: 500 })

  const { meeting_title, meeting_template, duration_minutes, description } = await req.json()
  if (!description) return NextResponse.json({ error: 'description required' }, { status: 400 })

  const templateHints: Record<string, string> = {
    level_10: 'Level 10 (EOS L10) — Segue, Scorecard, Rock Review, To-Do Review, IDS, Conclude',
    one_on_one: 'One-on-One — Check-in, Updates & Wins, Challenges & Support, Action Items',
    standup: 'Standup — Yesterday, Today, Blockers',
    quarterly: 'Quarterly Planning — Review Previous Quarter, SWOT, Set Rocks, Team Health',
    custom: 'Custom meeting',
  }

  const systemPrompt = `You are a meeting facilitation expert. Build a structured agenda as a JSON array.
Each item must have: section (string), duration_min (number), notes (string, empty), prompts (array of strings — 2-4 discussion questions), talking_points (array of strings — 2-3 key points to cover).
The total duration_min values must sum to exactly ${duration_minutes || 60} minutes.
Return ONLY valid JSON array, no markdown, no preamble.
Example: [{"section":"Opening","duration_min":5,"notes":"","prompts":["How is everyone?"],"talking_points":["Quick wins from last week"]}]`

  const userPrompt = `Meeting: "${meeting_title}"
Template style: ${templateHints[meeting_template] || 'Custom'}
Total duration: ${duration_minutes || 60} minutes
Context: ${description}

Build an agenda that fits this meeting. Make prompts specific and actionable, not generic. Keep section names concise.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    const data = await res.json()
    const text = data.content?.[0]?.text || ''
    const clean = text.replace(/```json|```/g, '').trim()
    const agenda = JSON.parse(clean)

    if (!Array.isArray(agenda)) throw new Error('Invalid agenda format')

    // Ensure all required fields
    const normalized = agenda.map((s: any) => ({
      section: s.section || 'Untitled',
      duration_min: parseInt(s.duration_min) || 10,
      notes: s.notes || '',
      completed: false,
      prompts: Array.isArray(s.prompts) ? s.prompts : [],
      talking_points: Array.isArray(s.talking_points) ? s.talking_points : [],
    }))

    return NextResponse.json({ agenda: normalized })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
