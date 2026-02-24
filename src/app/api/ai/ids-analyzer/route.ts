import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'Missing ANTHROPIC_API_KEY' }, { status: 500 })

  const { issue_description, org_id, ai_instructions, team_members } = await req.json()
  if (!issue_description?.trim() || !org_id) return NextResponse.json({ error: 'Missing issue or org_id' }, { status: 400 })

  const supabase = createAdminSupabase()

  // ═══ GATHER FULL PLATFORM CONTEXT ═══

  // 1. All tasks
  const { data: tasks } = await supabase
    .from('kanban_tasks').select('title, description, priority, status, assignee, due_date, custom_fields')
    .eq('org_id', org_id).limit(100)

  // 2. All rocks
  const { data: rocks } = await supabase
    .from('rocks').select('title, description, status, progress_pct, owner, due_date, priority')
    .eq('org_id', org_id).limit(50)

  // 3. Contacts summary
  const { data: contacts } = await supabase
    .from('contacts').select('full_name, email, company, pipeline_stage, source, tags, notes')
    .eq('org_id', org_id).limit(100)

  // 4. Company library docs
  const { data: library } = await supabase
    .from('company_library').select('title, category, description, file_type')
    .eq('org_id', org_id).limit(50)

  // 5. Recent meetings + IDS history
  const { data: recentMeetings } = await supabase
    .from('meetings').select('title, template, status, ids_items, action_items, agenda, notes, scheduled_at')
    .eq('org_id', org_id).order('scheduled_at', { ascending: false }).limit(10)

  // 6. Org settings (brand, AI config)
  const { data: orgSettings } = await supabase
    .from('org_settings').select('setting_key, setting_value')
    .eq('org_id', org_id)
    .in('setting_key', ['brand_settings', 'meeting_ai_instructions'])

  // 7. Team profiles
  const { data: teamProfiles } = await supabase
    .from('team_profiles').select('display_name, role, job_title, email, status')
    .eq('org_id', org_id).eq('status', 'active')

  // Build context
  const brandSettings = orgSettings?.find(s => s.setting_key === 'brand_settings')?.setting_value
  const savedInstructions = orgSettings?.find(s => s.setting_key === 'meeting_ai_instructions')?.setting_value?.instructions || ''
  const finalInstructions = ai_instructions || savedInstructions

  const platformContext = `
=== CURRENT TASKS (${tasks?.length || 0}) ===
${(tasks || []).map(t => `- [${t.priority}] ${t.title}${t.assignee ? ` (assigned: ${t.assignee})` : ''}${t.due_date ? ` due: ${t.due_date}` : ''}${t.description ? ` — ${t.description.slice(0, 100)}` : ''}`).join('\n') || 'No tasks'}

=== ROCKS / QUARTERLY GOALS (${rocks?.length || 0}) ===
${(rocks || []).map(r => `- ${r.title} [${r.status}, ${r.progress_pct}%]${r.owner ? ` owner: ${r.owner}` : ''}${r.description ? ` — ${r.description.slice(0, 100)}` : ''}`).join('\n') || 'No rocks'}

=== CONTACTS / PIPELINE (${contacts?.length || 0}) ===
${(contacts || []).slice(0, 30).map(c => `- ${c.full_name || 'Unknown'}${c.company ? ` @ ${c.company}` : ''} [${c.pipeline_stage || 'none'}]${c.source ? ` src: ${c.source}` : ''}${c.tags ? ` tags: ${c.tags}` : ''}`).join('\n') || 'No contacts'}

=== COMPANY LIBRARY (${library?.length || 0}) ===
${(library || []).map(l => `- ${l.title} [${l.category || 'uncategorized'}] (${l.file_type || 'doc'})`).join('\n') || 'No documents'}

=== RECENT MEETINGS & IDS HISTORY ===
${(recentMeetings || []).map(m => {
  const idsCount = (m.ids_items || []).length
  const actCount = (m.action_items || []).length
  const idsText = idsCount > 0 ? `\n  IDS: ${(m.ids_items || []).map((i: any) => `${i.issue_category || ''}: ${i.description?.slice(0, 60)}`).join('; ')}` : ''
  return `- ${m.title} [${m.status}] ${m.scheduled_at ? new Date(m.scheduled_at).toLocaleDateString() : ''} (${idsCount} IDS, ${actCount} actions)${idsText}`
}).join('\n') || 'No meetings'}

=== TEAM MEMBERS ===
${(team_members || teamProfiles || []).map((t: any) => `- ${t.display_name || t.name} [${t.role || t.job_title || 'team'}]${t.email ? ` (${t.email})` : ''}`).join('\n') || 'No team members'}

${brandSettings ? `=== BRAND CONTEXT ===\nMission: ${brandSettings.mission_statement || ''}\nPositioning: ${brandSettings.positioning_statement || ''}\nDream Outcome: ${brandSettings.dream_outcome || ''}` : ''}
`.trim()

  const systemPrompt = `You are a world-class strategic advisor embedded in the NPU Hub platform. You have full visibility into the organization's tasks, quarterly goals (rocks), contacts pipeline, document library, meeting history, and team structure.

${finalInstructions ? `CUSTOM AI INSTRUCTIONS FROM LEADERSHIP:\n${finalInstructions}\n` : ''}

Your job: Take a brief issue description and produce a comprehensive, strategic IDS (Identify, Discuss, Solve) analysis by filling out all 7 columns of the IDS table.

You must be:
- CRITICAL and honest — don't sugarcoat problems
- STRATEGIC — connect the issue to broader organizational context
- SPECIFIC — reference actual tasks, rocks, contacts, and resources from the platform data
- ACTIONABLE — every action item should be concrete with a clear owner

Platform context is provided below. Cross-reference everything. If a rock, task, or contact is relevant, name it specifically.

Return ONLY valid JSON:
{
  "issue_category": "2-5 word strategic category label (e.g. 'Revenue Velocity', 'Founder Bottleneck', 'Product-Market Fit')",
  "description": "2-4 sentences of strategic analysis. Be specific about the current state, what's working, what's not, and why this matters now. Reference concrete platform data (specific tasks, rocks, contacts, metrics). Example quality: 'Strong resonance signals, but unclear if PMF is sufficient for paid scale. Early conversions and improved call quality suggest traction, but sample size remains small.'",
  "dependencies_context": "List every dependency: related tasks by name, rocks that overlap, contacts who are involved, documents that inform this, and any timing constraints. Use semicolons to separate. Example: 'Mastermind program; therapist-partnership development (~2 weeks dev); HRV + LF/HF metrics; participant feedback.'",
  "decisions_needed": "Frame as specific choices leadership must make. Be direct. Example: 'Determine realistic monthly target; decide whether to integrate upsell + partnership strategies into pro forma.' or 'Launch now vs. design-only vs. defer.'",
  "action_items_text": "Concrete, executable next steps. Each should name who does what. Semicolons between items. Example: 'Build upsell model; explore therapist partnerships; adjust financial projections.' or 'Analyze calls + NSCI data → write 1-page ICP definition (language, pain, readiness).'",
  "due_date": "Specific timeline: '2 weeks', '2-3 weeks', 'Before Q2', 'Advisor meeting', 'Before build', etc.",
  "suggested_owner": "Name + role if multiple people needed, e.g. 'Cameron' or 'Cameron + Paul' or 'Shane + Cameron'"
}

CRITICAL: Even if the user's issue is brief or simple (e.g. "find a marketer"), your analysis must be thorough and strategic. Expand the brief issue into a full strategic assessment by cross-referencing all platform data. A 5-word issue should still produce paragraph-length descriptions and multiple concrete action items.`

  const userPrompt = `ISSUE TO ANALYZE:
"${issue_description}"

FULL PLATFORM CONTEXT:
${platformContext}

Analyze this issue strategically. Cross-reference with all platform data. Fill all 7 IDS columns. Return only JSON.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2500,
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
    return NextResponse.json({
      issue_category: parsed.issue_category || '',
      description: parsed.description || issue_description,
      dependencies_context: parsed.dependencies_context || '',
      decisions_needed: parsed.decisions_needed || '',
      action_items_text: parsed.action_items_text || '',
      due_date: parsed.due_date || '',
      suggested_owner: parsed.suggested_owner || '',
    })
  } catch (e: any) {
    return NextResponse.json({ error: 'AI analysis failed', details: e.message }, { status: 500 })
  }
}
