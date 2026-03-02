import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

export async function POST(req: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
  }

  try {
    const { rock, allRocks, existingTasks, teamMembers, mode = 'single' } = await req.json()

    let prompt: string

    if (mode === 'full') {
      prompt = `You are a world-class strategic project manager and efficiency optimizer for Neuro Progeny, a nervous system training and clinical neuroscience company using EOS methodology.

Analyze ALL quarterly Rocks holistically. Your job is to:
1. Break each rock into actionable tasks with RACI assignments
2. Identify cross-rock dependencies and redundancies
3. Establish the critical path and optimal sequencing
4. Detect resource conflicts (same person overloaded)
5. Optimize the timeline so no one is waiting on someone else

RACI Framework:
- Responsible (R): Person who does the work (can be multiple)
- Accountable (A): Person ultimately answerable (ONLY ONE per task)
- Consulted (C): People whose input is sought before action
- Informed (I): People who are kept updated after action

ALL ROCKS THIS QUARTER:
${allRocks?.map((r: any, i: number) => `
Rock ${i + 1}: "${r.title}"
  Description: ${r.description || 'None'}
  Status: ${r.status} | Progress: ${r.progress_pct}% | Owner: ${r.owner_name || 'Unassigned'}
  Due: ${r.due_date || 'No date'}
  Existing Tasks: ${r.existing_tasks?.map((t: any) => `[${t.done ? '✓' : '○'}] ${t.title} (${t.priority}${t.assignee_name ? ', ' + t.assignee_name : ''})`).join('; ') || 'None'}
`).join('\n') || 'None'}

TEAM MEMBERS:
${teamMembers?.map((m: any) => `- ${m.display_name} (${m.job_title || m.role})`).join('\n') || 'Not specified'}

CRITICAL RULES:
- Each task MUST have exactly ONE Accountable person
- Estimate hours realistically (most tasks 1-8 hours)
- Sequence tasks so dependencies are respected
- Flag when one person has >20 hours of R tasks in a single week
- Merge duplicate tasks across rocks into one task tagged to both rocks
- Be specific with task titles (not vague like "Plan things")

Return ONLY valid JSON (no markdown, no explanation):
{
  "per_rock": {
    "<rock_title>": {
      "recommended_tasks": [
        {
          "title": "Specific actionable task title",
          "description": "What this task involves",
          "priority": "high|medium|low",
          "estimated_hours": 4,
          "sequence_order": 1,
          "raci": {
            "responsible": "Team member name",
            "accountable": "Team member name",
            "consulted": "Team member name or null",
            "informed": "Team member name or null"
          },
          "depends_on_tasks": ["Title of task this depends on"],
          "rationale": "Why this task and these assignments"
        }
      ],
      "risk_assessment": {
        "level": "low|medium|high",
        "factors": ["Risk factor 1"],
        "mitigation": "Strategy"
      },
      "insights": "1-2 sentence insight for this rock"
    }
  },
  "cross_rock": {
    "dependencies": [
      {
        "source_rock": "Rock title",
        "source_task": "Task title in source rock",
        "target_rock": "Rock title",
        "target_task": "Task title in target rock",
        "relationship": "blocks|depends_on",
        "explanation": "Why this dependency exists"
      }
    ],
    "redundancies": [
      {
        "tasks": ["Rock A: Task title", "Rock B: Task title"],
        "recommendation": "Merge into single task",
        "merged_title": "Combined task title"
      }
    ],
    "critical_path": [
      {
        "rock": "Rock title",
        "task": "Task title",
        "sequence": 1,
        "estimated_hours": 4,
        "why_critical": "Brief explanation"
      }
    ],
    "resource_conflicts": [
      {
        "person": "Team member name",
        "total_hours": 45,
        "concern": "Overloaded in weeks 2-3",
        "suggestion": "Redistribute X task to Y person"
      }
    ],
    "timeline": [
      {
        "week": 1,
        "focus": "Brief description of what should happen this week",
        "key_tasks": ["Task 1", "Task 2"]
      }
    ]
  },
  "global_insights": "3-4 sentence strategic overview of the quarter's execution plan, biggest risks, and recommended priorities"
}`
    } else {
      // Single rock mode (existing behavior)
      prompt = `You are a strategic planning AI for Neuro Progeny, a nervous system training and clinical neuroscience company using EOS methodology.

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
Notes: ${rock.notes || 'None'}
Existing Tasks (${existingTasks?.length || 0}):
${existingTasks?.map((t: any) => `  - [${t.done ? '✓' : '○'}] ${t.title} (${t.priority}${t.assignee_name ? ', ' + t.assignee_name : ''})`).join('\n') || '  None'}

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
      "description": "What this involves",
      "priority": "high|medium|low",
      "estimated_hours": 4,
      "sequence_order": 1,
      "raci": {
        "responsible": "Team member name or null",
        "accountable": "Team member name or null",
        "consulted": "Team member name or null",
        "informed": "Team member name or null"
      },
      "depends_on_tasks": [],
      "rationale": "Why this task and why these RACI assignments"
    }
  ],
  "insights": "2-3 sentence strategic insight about this rock's trajectory, dependencies, and what to focus on next"
}`
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: mode === 'full' ? 8192 : 2048,
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

    return NextResponse.json({ analysis, mode })
  } catch (error) {
    console.error('Rock advisor error:', error)
    return NextResponse.json({ error: 'Failed to analyze rock' }, { status: 500 })
  }
}
