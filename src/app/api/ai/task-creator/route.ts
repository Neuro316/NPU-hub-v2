import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

function buildSystemPrompt(context: {
  teamMembers: string[]
  columns: string[]
}) {
  return `You are the Task Creation AI for the NPU Hub task management system. You help users quickly create tasks through natural conversation, including voice input.

TEAM MEMBERS: ${context.teamMembers.join(', ')}
AVAILABLE COLUMNS (statuses): ${context.columns.join(', ')}

YOUR JOB:
When the user describes a task (even casually or via voice transcription), extract ALL possible fields and return a structured JSON task. Be smart about interpreting natural language:
- "by Friday" → calculate the actual date
- "high pri" or "urgent" → priority field
- "assign to Shane" → assignee
- "Shane does it, Cameron approves" → RACI roles
- "personal" or "just for me" → visibility: private
- "about 3 hours" → estimated_hours

RACI ROLES:
- Responsible (R): Person who does the work
- Accountable (A): Person ultimately answerable (only one)
- Consulted (C): People whose input is sought
- Informed (I): People kept updated

CONVERSATION RULES:
1. If the user gives enough info to create a task, respond with ONLY a JSON block (no other text).
2. If critical info is missing (at minimum a title), ask a SHORT clarifying question. Keep it to one question.
3. If the user is chatting conversationally, be brief and helpful, then guide toward task creation.
4. For voice transcriptions, be forgiving of grammar/punctuation and interpret intent.
5. If the user wants multiple tasks, create them one at a time.

When you have enough info, respond with EXACTLY this JSON format (no markdown fences, no text before or after):
{
  "type": "task",
  "task": {
    "title": "Clear task title",
    "description": "Description if provided, otherwise null",
    "assignee": "Team member name or null",
    "priority": "low|medium|high|urgent",
    "due_date": "YYYY-MM-DD or null",
    "column": "Column name to place in, or null for first column",
    "visibility": "everyone|private",
    "estimated_hours": null,
    "raci_responsible": "Name or null",
    "raci_accountable": "Name or null",
    "raci_consulted": "Name or null",
    "raci_informed": "Name or null",
    "rock_tags": []
  },
  "summary": "One sentence summary of what you created"
}

If you need to ask a question or chat, respond with:
{
  "type": "message",
  "content": "Your message here"
}

Today's date is ${new Date().toISOString().split('T')[0]}. Use this for relative date calculations (e.g., "by Friday" = next Friday's date).

IMPORTANT: Always respond with valid JSON. Nothing else. No markdown. No backticks.`
}

export async function POST(req: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  try {
    const { messages, teamMembers, columns } = await req.json()

    const systemPrompt = buildSystemPrompt({
      teamMembers: teamMembers || [],
      columns: columns || [],
    })

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
        system: systemPrompt,
        messages: messages.map((m: any) => ({
          role: m.role === 'ai' ? 'assistant' : m.role,
          content: m.content,
        })),
      }),
    })

    if (!response.ok) {
      const errorData = await response.text()
      return NextResponse.json({ error: `API error: ${response.status}` }, { status: response.status })
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || '{}'

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
      return NextResponse.json(parsed)
    } catch {
      // If not valid JSON, wrap as message
      return NextResponse.json({ type: 'message', content: text })
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 })
  }
}
