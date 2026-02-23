import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

export async function POST(req: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
  }

  try {
    const { title, template, duration_minutes, attendee_names, context } = await req.json()

    const prompt = `You are a meeting facilitator AI for Neuro Progeny, a nervous system training and clinical neuroscience company.

Generate a focused, time-boxed agenda for this meeting:

Meeting: ${title}
Template: ${template}
Total Duration: ${duration_minutes} minutes
Attendees: ${attendee_names?.join(', ') || 'Not specified'}
${context ? `Additional Context: ${context}` : ''}

Rules:
- Each section must have a clear name and specific time allocation in minutes
- Total time of all sections must equal ${duration_minutes} minutes
- For L10 meetings: follow EOS format (Segue → Scorecard → Rock Review → To-Do Review → IDS → Conclude)
- For 1:1s: focus on check-in, updates, challenges, action items
- For standups: keep to yesterday/today/blockers format
- For quarterly: include review, SWOT, rock-setting, team health
- For custom: design best agenda for the topic described in the title

Return ONLY valid JSON array, no markdown, no explanation:
[{"section":"Section Name","duration_min":5,"notes":"Brief facilitator note for this section"}]`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Anthropic API error:', errorText)
      return NextResponse.json({ error: 'AI service error' }, { status: 502 })
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || '[]'

    // Parse the JSON response - strip any markdown fences
    const clean = text.replace(/```json\n?|```\n?/g, '').trim()
    const agenda = JSON.parse(clean)

    // Validate structure and add completed field
    const validatedAgenda = agenda.map((item: any) => ({
      section: String(item.section || 'Untitled'),
      duration_min: Number(item.duration_min) || 5,
      notes: String(item.notes || ''),
      completed: false,
    }))

    return NextResponse.json({ agenda: validatedAgenda })
  } catch (error) {
    console.error('Agenda generator error:', error)
    return NextResponse.json({ error: 'Failed to generate agenda' }, { status: 500 })
  }
}
