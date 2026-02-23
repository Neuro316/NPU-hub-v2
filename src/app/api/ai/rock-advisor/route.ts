import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

export async function POST(req: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
  }

  try {
    const { rock, allRocks, existingTasks, teamMembers } = await req.json()

    const prompt = `You are a strategic planning AI for Neuro Progeny, a nervous system training and clinical neuroscience company using EOS methodology.

Analyze this quarterly Rock and provide actionable recommendations with RACI assignments.

RACI Framework:
- Responsible (R): Person who does the work
- Accountable (A): Person ultimately answerable (only one per task)
- Consulted (C): People whose input is sought
- Informed (I): People who are kept updated

CURRENT ROCK:
Title: ${rock.title}
Description: ${rock.description || 'No description provided'}
Status: ${rock.status}
Owner: ${rock.owner_name || 'Unassigned'}
Progress: ${rock.progress_pct || 0}%
Due: ${rock.due_date || 'No due date'}
Existing Tasks (${existingTasks?.length || 0}):
${existingTasks?.map((t: any) => `  - [${t.done ? '✓' : '○'}] ${t.title} (${t.priority || 'medium'}${t.assignee_name ? ', ' + t.assignee_name : ''})`).join('\n') || '  None'}

ALL ROCKS THIS QUARTER:
${allRocks?.map((r: any, i: number) => `${i + 1}. ${r.title} (${r.status}, ${r.progress_pct}%, Owner: ${r.owner_name || 'Unassigned'})`).join('\n') || 'None'}

TEAM MEMBERS:
${teamMembers?.map((m: any) => `- ${m.display_name} (${m.job_title || m.role})`).join('\n') || 'Not specified'}

Return ONLY valid JSON (no markdown, no explanation):
{
  "dependencies": [
    {
      "rock_title": "Exact title of related rock from list above",
      "rock_index": 0,
      "relationship": "depends_on|blocks|supports",
      "explanation": "Brief explanation of the relationship"
    }
  ],
  "risk_assessment": {
    "level": "low|medium|high",
    "factors": ["Risk factor 1", "Risk factor 2"],
    "mitigation": "Suggested mitigation strategy"
  },
  "recommended_tasks": [
    {
      "title": "Task title",
      "priority": "high|medium|low",
      "raci": {
        "responsible": "Team member name or null",
        "accountable": "Team member name or null",
        "consulted": "Team member name or null",
        "informed": "Team member name or null"
      },
      "rationale": "Why this task and why these RACI assignments"
    }
  ],
  "insights": "2-3 sentence strategic insight about this rock's trajectory, dependencies, and what to focus on next"
}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Anthropic API error:', errorText)
      return NextResponse.json({ error: 'AI service error' }, { status: 502 })
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || '{}'
    const clean = text.replace(/```json\n?|```\n?/g, '').trim()
    const analysis = JSON.parse(clean)

    return NextResponse.json({ analysis })
  } catch (error) {
    console.error('Rock advisor error:', error)
    return NextResponse.json({ error: 'Failed to analyze rock' }, { status: 500 })
  }
}
