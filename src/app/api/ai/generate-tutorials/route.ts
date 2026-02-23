import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase'

export const maxDuration = 60

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

// POST /api/ai/generate-tutorials — Analyze help patterns and generate tutorials
export async function POST(request: NextRequest) {
  const userSupabase = createServerSupabase()
  const { data: { user } } = await userSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ANTHROPIC_API_KEY) return NextResponse.json({ error: 'AI not configured' }, { status: 500 })

  const { org_id } = await request.json()
  const supabase = createAdminSupabase()

  // Gather help request patterns
  const { data: helpRequests } = await supabase
    .from('help_requests')
    .select('question, category, page_context, helpful')
    .eq('org_id', org_id)
    .order('occurred_at', { ascending: false })
    .limit(200)

  // Gather usage data for context
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data: usageEvents } = await supabase
    .from('usage_events')
    .select('event_type, event_target, duration_ms')
    .eq('org_id', org_id)
    .gte('occurred_at', since)
    .in('event_type', ['page_view', 'error'])
    .limit(2000)

  // Get existing tutorials to avoid duplicates
  const { data: existingTutorials } = await supabase
    .from('tutorials')
    .select('title, target_page')
    .eq('org_id', org_id)

  // Aggregate help patterns by page
  const pageQuestions: Record<string, string[]> = {}
  const categoryCount: Record<string, number> = {}
  ;(helpRequests || []).forEach(h => {
    if (h.page_context) {
      if (!pageQuestions[h.page_context]) pageQuestions[h.page_context] = []
      pageQuestions[h.page_context].push(h.question)
    }
    if (h.category) categoryCount[h.category] = (categoryCount[h.category] || 0) + 1
  })

  // Pages with errors
  const errorPages: Record<string, number> = {}
  ;(usageEvents || []).forEach(e => {
    if (e.event_type === 'error' && e.event_target) {
      errorPages[e.event_target] = (errorPages[e.event_target] || 0) + 1
    }
  })

  const dataPayload = {
    help_questions_by_page: pageQuestions,
    category_breakdown: categoryCount,
    error_prone_pages: errorPages,
    existing_tutorials: (existingTutorials || []).map(t => t.title),
    total_help_requests: helpRequests?.length || 0,
  }

  const systemPrompt = `You are a tutorial content generator for NPU Hub, a business operations platform. Based on user help request patterns and error data, generate step-by-step walkthrough tutorials.

Each tutorial should be a JSON object:
{
  "title": "Clear action-oriented title (e.g., 'How to Send Your First SMS')",
  "description": "One sentence explaining what the user will learn",
  "target_page": "/path/to/page",
  "category": "getting_started" | "crm" | "ehr" | "marketing" | "admin",
  "steps": [
    {
      "title": "Step title",
      "content": "Clear instruction with specific UI element references. Be very specific about button labels, menu locations, and what to expect.",
      "page_path": "/crm/conversations"
    }
  ],
  "trigger_patterns": ["sample questions that should trigger this tutorial"]
}

RULES:
- Generate tutorials for the pages/topics that generate the MOST help requests
- If no help data exists, generate essential "Getting Started" tutorials
- Each tutorial should have 3-7 steps
- Steps should reference exact button labels and navigation paths
- Don't duplicate existing tutorials
- Generate 3-5 tutorials, prioritized by user need
- Use friendly, encouraging tone
- Return a JSON array of tutorial objects`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `Generate tutorials based on this data:\n\n${JSON.stringify(dataPayload, null, 2)}`,
        }],
      }),
    })

    const aiResult = await response.json()
    const text = aiResult.content?.[0]?.text || '[]'
    const cleaned = text.replace(/```json\n?|```\n?/g, '').trim()

    let tutorials = []
    try {
      tutorials = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({ error: 'Failed to parse tutorial output', raw: text }, { status: 500 })
    }

    // Store tutorials
    if (Array.isArray(tutorials) && tutorials.length > 0) {
      const rows = tutorials.map((t: any) => ({
        org_id,
        title: t.title,
        description: t.description,
        target_page: t.target_page,
        category: t.category || 'getting_started',
        steps: t.steps || [],
        trigger_patterns: t.trigger_patterns || [],
        generated_from: 'help_patterns',
        is_published: false,
      }))

      await supabase.from('tutorials').insert(rows)
    }

    return NextResponse.json({ tutorials, count: tutorials.length })
  } catch (err: any) {
    console.error('Tutorial generator error:', err)
    return NextResponse.json({ error: err.message || 'Generation failed' }, { status: 500 })
  }
}
