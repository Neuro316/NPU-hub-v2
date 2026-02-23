import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function POST(req: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  try {
    const { issue_text, org_id, meeting_template, attendees } = await req.json()

    if (!issue_text?.trim()) {
      return NextResponse.json({ error: 'issue_text is required' }, { status: 400 })
    }

    // Pull context from platform modules
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    let contextParts: string[] = []

    // 1. Active rocks
    const { data: rocks } = await supabase
      .from('rocks').select('title, description, status, quarter')
      .eq('org_id', org_id).limit(20)
    if (rocks?.length) {
      contextParts.push(`ACTIVE ROCKS:\n${rocks.map(r => `- ${r.title} (${r.status}): ${r.description || 'No desc'}`).join('\n')}`)
    }

    // 2. Recent tasks
    const { data: tasks } = await supabase
      .from('kanban_tasks').select('title, priority, assignee, custom_fields')
      .eq('org_id', org_id).order('created_at', { ascending: false }).limit(30)
    if (tasks?.length) {
      contextParts.push(`RECENT TASKS:\n${tasks.map(t => `- [${t.priority}] ${t.title}`).join('\n')}`)
    }

    // 3. Company library docs
    const { data: docs } = await supabase
      .from('company_library').select('title, category, content')
      .eq('org_id', org_id).limit(10)
    if (docs?.length) {
      contextParts.push(`COMPANY LIBRARY:\n${docs.map(d => `- ${d.title} (${d.category}): ${(d.content || '').slice(0, 200)}`).join('\n')}`)
    }

    // 4. SOPs
    const { data: sops } = await supabase
      .from('sops').select('title, category')
      .eq('org_id', org_id).limit(10)
    if (sops?.length) {
      contextParts.push(`SOPs:\n${sops.map(s => `- ${s.title} (${s.category})`).join('\n')}`)
    }

    // 5. Team members
    const { data: team } = await supabase
      .from('team_profiles').select('display_name, job_title, role')
      .eq('org_id', org_id)
    if (team?.length) {
      contextParts.push(`TEAM:\n${team.map(t => `- ${t.display_name} (${t.job_title || t.role})`).join('\n')}`)
    }

    const platformContext = contextParts.length > 0
      ? `\n\nPLATFORM CONTEXT (use this to inform your analysis):\n${contextParts.join('\n\n')}`
      : ''

    const prompt = `You are an EOS (Entrepreneurial Operating System) meeting facilitator AI for Neuro Progeny, a nervous system training and clinical neuroscience company.

A team member has raised the following issue during a ${meeting_template || 'L10'} meeting:

"${issue_text}"

Attendees: ${attendees?.join(', ') || 'Not specified'}
${platformContext}

Break this issue down into the structured IDS (Identify, Discuss, Solve) format. Fill out ALL fields thoughtfully using the platform context above. Assign owners to actual team members listed above when possible.

Return ONLY valid JSON (no markdown, no backticks):
{
  "issue_category": "Short category label (2-4 words, e.g. 'Revenue Strategy', 'Hiring Pipeline', 'Product Readiness')",
  "description": "Expanded description of the issue with context (2-3 sentences)",
  "dependencies_context": "What this depends on, blockers, related work items from platform context",
  "decisions_needed": "Specific decisions the team needs to make",
  "action_items": "Concrete next steps with specificity",
  "due_date": "Suggested timeframe (e.g. '2 weeks', 'Next meeting', specific date if obvious)",
  "owner": "Team member name(s) from the team list above, or 'TBD'"
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
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Anthropic error:', err)
      return NextResponse.json({ error: 'AI service error' }, { status: 502 })
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || '{}'
    const clean = text.replace(/```json\n?|```\n?/g, '').trim()
    const parsed = JSON.parse(clean)

    return NextResponse.json({ ids_item: parsed })
  } catch (error: any) {
    console.error('IDS analyzer error:', error)
    return NextResponse.json({ error: error.message || 'Failed to analyze issue' }, { status: 500 })
  }
}
