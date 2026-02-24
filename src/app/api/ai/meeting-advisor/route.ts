import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { org_id, meeting_id, issue_text, meeting_notes } = await req.json()
  if (!org_id) return NextResponse.json({ error: 'Missing org_id' }, { status: 400 })

  const sb = createAdminSupabase()

  // ═══ 1. GATHER FULL PLATFORM CONTEXT ═══

  // All tasks (current + historical) with column info
  const [tasksRes, colsRes, rocksRes, meetingsRes, teamRes, settingsRes, contactsRes] = await Promise.all([
    sb.from('kanban_tasks').select('*').eq('org_id', org_id).order('created_at', { ascending: false }).limit(500),
    sb.from('kanban_columns').select('*').eq('org_id', org_id).order('sort_order'),
    sb.from('rocks').select('*').eq('org_id', org_id).order('created_at', { ascending: false }).limit(50),
    sb.from('meetings').select('id, title, template, scheduled_at, status, notes, agenda, read_ai_data, action_items, ids_items')
      .eq('org_id', org_id).order('scheduled_at', { ascending: false }).limit(20),
    sb.from('team_profiles').select('*').eq('org_id', org_id).eq('status', 'active'),
    sb.from('org_settings').select('setting_key, setting_value').eq('org_id', org_id),
    sb.from('contacts').select('id, first_name, last_name, pipeline_stage, tags, occupation, reason_for_contact')
      .eq('org_id', org_id).is('merged_into_id', null).limit(100),
  ])

  const tasks = tasksRes.data || []
  const columns = colsRes.data || []
  const rocks = rocksRes.data || []
  const meetings = meetingsRes.data || []
  const team = teamRes.data || []
  const settings = settingsRes.data || []
  const contacts = contactsRes.data || []

  // Build column map (id → title)
  const colMap: Record<string, string> = {}
  columns.forEach(c => { colMap[c.id] = c.title })

  // Identify done/complete columns
  const doneColIds = new Set(columns.filter(c =>
    c.title.toLowerCase().includes('done') || c.title.toLowerCase().includes('complete')
  ).map(c => c.id))

  // ═══ 2. COMPUTE TASK HISTORY METRICS ═══

  const now = Date.now()

  // Categorize tasks
  const completedTasks = tasks.filter(t => doneColIds.has(t.column_id))
  const activeTasks = tasks.filter(t => !doneColIds.has(t.column_id))
  const overdueTasks = activeTasks.filter(t => t.due_date && new Date(t.due_date).getTime() < now)
  const abandonedTasks = activeTasks.filter(t => {
    const age = now - new Date(t.updated_at).getTime()
    return age > 30 * 24 * 60 * 60 * 1000 // Not touched in 30+ days
  })

  // Average completion time (created → moved to done column)
  const completionTimes: number[] = []
  completedTasks.forEach(t => {
    const created = new Date(t.created_at).getTime()
    const updated = new Date(t.updated_at).getTime()
    const days = (updated - created) / (24 * 60 * 60 * 1000)
    if (days > 0 && days < 365) completionTimes.push(days)
  })
  const avgCompletionDays = completionTimes.length > 0
    ? Math.round(completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length)
    : null

  // Completion time by priority
  const completionByPriority: Record<string, number[]> = { low: [], medium: [], high: [], urgent: [] }
  completedTasks.forEach(t => {
    const days = (new Date(t.updated_at).getTime() - new Date(t.created_at).getTime()) / (24 * 60 * 60 * 1000)
    if (days > 0 && days < 365 && completionByPriority[t.priority]) {
      completionByPriority[t.priority].push(days)
    }
  })
  const avgByPriority: Record<string, number | null> = {}
  Object.entries(completionByPriority).forEach(([p, times]) => {
    avgByPriority[p] = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null
  })

  // Completion by assignee
  const completionByAssignee: Record<string, { completed: number; total: number; avgDays: number[] }> = {}
  tasks.forEach(t => {
    const key = t.assignee || 'unassigned'
    if (!completionByAssignee[key]) completionByAssignee[key] = { completed: 0, total: 0, avgDays: [] }
    completionByAssignee[key].total++
    if (doneColIds.has(t.column_id)) {
      completionByAssignee[key].completed++
      const days = (new Date(t.updated_at).getTime() - new Date(t.created_at).getTime()) / (24 * 60 * 60 * 1000)
      if (days > 0 && days < 365) completionByAssignee[key].avgDays.push(days)
    }
  })

  // Due date accuracy
  let dueDatesHit = 0, dueDatesTotal = 0
  completedTasks.forEach(t => {
    if (t.due_date) {
      dueDatesTotal++
      if (new Date(t.updated_at) <= new Date(t.due_date)) dueDatesHit++
    }
  })
  const dueDateAccuracy = dueDatesTotal > 0 ? Math.round((dueDatesHit / dueDatesTotal) * 100) : null

  // ═══ 3. BUILD CONTEXT STRING ═══

  // Find AI custom instructions from org_settings
  const aiSettings = settings.find(s => s.setting_key === 'meeting_ai_settings')?.setting_value || {}
  const customInstructions = aiSettings.custom_instructions || ''

  // Team member map for names
  const teamMap: Record<string, string> = {}
  team.forEach(t => { teamMap[t.user_id || t.id] = t.display_name || 'Unknown' })

  const context = `
═══ PLATFORM CONTEXT ═══

TEAM (${team.length} members):
${team.map(t => `- ${t.display_name} (${t.role || 'member'})`).join('\n')}

TASK HISTORY METRICS:
- Total tasks ever: ${tasks.length}
- Completed: ${completedTasks.length} | Active: ${activeTasks.length} | Overdue: ${overdueTasks.length} | Abandoned (30d+ stale): ${abandonedTasks.length}
- Average completion time: ${avgCompletionDays !== null ? `${avgCompletionDays} days` : 'insufficient data'}
- Avg by priority: Low=${avgByPriority.low ?? '?'}d | Medium=${avgByPriority.medium ?? '?'}d | High=${avgByPriority.high ?? '?'}d | Urgent=${avgByPriority.urgent ?? '?'}d
- Due date accuracy: ${dueDateAccuracy !== null ? `${dueDateAccuracy}% of tasks with due dates completed on time` : 'insufficient data'}

TEAM VELOCITY:
${Object.entries(completionByAssignee).map(([uid, stats]) => {
    const name = teamMap[uid] || uid
    const avg = stats.avgDays.length > 0 ? Math.round(stats.avgDays.reduce((a, b) => a + b, 0) / stats.avgDays.length) : '?'
    const rate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0
    return `- ${name}: ${stats.completed}/${stats.total} completed (${rate}%), avg ${avg} days`
  }).join('\n')}

CURRENTLY OVERDUE TASKS:
${overdueTasks.slice(0, 10).map(t =>
    `- "${t.title}" (assigned: ${teamMap[t.assignee || ''] || 'unassigned'}, due: ${t.due_date}, priority: ${t.priority}, in column: ${colMap[t.column_id] || 'unknown'})`
  ).join('\n') || '(none)'}

ABANDONED TASKS (not touched 30+ days):
${abandonedTasks.slice(0, 10).map(t =>
    `- "${t.title}" (assigned: ${teamMap[t.assignee || ''] || 'unassigned'}, last updated: ${t.updated_at?.split('T')[0]}, priority: ${t.priority})`
  ).join('\n') || '(none)'}

ACTIVE TASKS (current board):
${activeTasks.filter(t => !abandonedTasks.includes(t)).slice(0, 20).map(t =>
    `- "${t.title}" [${colMap[t.column_id] || '?'}] (assigned: ${teamMap[t.assignee || ''] || 'unassigned'}, priority: ${t.priority}, due: ${t.due_date || 'none'})`
  ).join('\n')}

ROCKS (${rocks.length}):
${rocks.slice(0, 15).map(r =>
    `- "${r.title}" (${r.status}, ${r.progress_pct}%, owner: ${teamMap[r.owner_id || ''] || 'unassigned'}, due: ${r.due_date || 'none'})`
  ).join('\n')}

RECENT MEETINGS (last 10):
${meetings.slice(0, 10).map(m =>
    `- ${m.scheduled_at?.split('T')[0] || '?'}: "${m.title}" (${m.status})${m.notes ? ' — notes: ' + m.notes.slice(0, 200) : ''}`
  ).join('\n')}

KEY CONTACTS:
${contacts.slice(0, 20).map(c =>
    `- ${c.first_name} ${c.last_name} (${c.pipeline_stage || 'no stage'}, tags: ${(c.tags || []).join(', ') || 'none'})`
  ).join('\n')}

${customInstructions ? `\nCUSTOM AI INSTRUCTIONS:\n${customInstructions}` : ''}
`.trim()

  // ═══ 4. CALL CLAUDE ═══

  const systemPrompt = `You are an executive operations advisor for a neurotechnology company. You have access to the ENTIRE platform: task history, team velocity, rocks, meetings, and contacts.

Your job is to analyze issues raised in meetings and produce STRATEGIC, DATA-DRIVEN recommendations. You MUST reference the actual task history metrics when recommending timelines.

CRITICAL RULES:
1. REALISTIC TIMELINES: Base due date recommendations on actual team velocity data. If the average task takes ${avgCompletionDays || '?'} days and the team hits ${dueDateAccuracy || '?'}% of due dates, factor this into your recommendations. Add buffer for historically unreliable completion rates.
2. ABANDONED TASK AWARENESS: If similar tasks were abandoned before, call this out explicitly and recommend what needs to be different this time.
3. ACCOUNTABILITY: Name specific people based on their roles and capacity. Reference their completion rates.
4. CROSS-REFERENCE: Connect issues to existing rocks, active tasks, and overdue items. Don't create duplicate work.
5. PATTERN RECOGNITION: If you see recurring themes in overdue/abandoned tasks, flag the systemic issue.

OUTPUT FORMAT (strict JSON):
{
  "analysis": {
    "summary": "2-3 sentence strategic assessment referencing specific data points",
    "related_existing_work": ["list of related active tasks/rocks that overlap"],
    "historical_patterns": "what does the task history tell us about this type of work",
    "risk_factors": ["specific risks based on team data"]
  },
  "recommended_actions": [
    {
      "title": "Concrete action step",
      "description": "Detailed description with rationale",
      "suggested_owner": "Name (based on role fit and current capacity)",
      "suggested_priority": "low|medium|high|urgent",
      "suggested_due_date": "YYYY-MM-DD (with reasoning)",
      "timeline_reasoning": "Why this date - reference team velocity, similar past tasks, current workload",
      "raci": { "responsible": "Name", "accountable": "Name", "consulted": "Names", "informed": "Names" },
      "success_criteria": "How we know this is done",
      "dependencies": ["what must happen first"]
    }
  ],
  "accountability_notes": "Specific observations about workload balance, who's overloaded, who has capacity",
  "systemic_recommendations": "If this issue reveals a process gap, what should change"
}`

  const userPrompt = `${context}

═══ ISSUE TO ANALYZE ═══
${issue_text || 'General meeting review'}

${meeting_notes ? `MEETING NOTES:\n${meeting_notes}` : ''}

Analyze this issue using ALL the platform data above. Be specific — reference actual task names, team member completion rates, and historical patterns. Recommend realistic timelines based on the actual velocity data, not optimistic guesses.

Respond ONLY with valid JSON matching the specified format.`

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'Missing ANTHROPIC_API_KEY' }, { status: 500 })

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `Claude API error: ${res.status} - ${err}` }, { status: 502 })
    }

    const data = await res.json()
    const text = data.content?.[0]?.text || ''

    // Parse JSON from response (strip markdown fences if present)
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const analysis = JSON.parse(cleaned)

    return NextResponse.json({
      analysis,
      metrics: {
        total_tasks: tasks.length,
        completed: completedTasks.length,
        active: activeTasks.length,
        overdue: overdueTasks.length,
        abandoned: abandonedTasks.length,
        avg_completion_days: avgCompletionDays,
        due_date_accuracy: dueDateAccuracy,
        avg_by_priority: avgByPriority,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'AI analysis failed' }, { status: 500 })
  }
}
