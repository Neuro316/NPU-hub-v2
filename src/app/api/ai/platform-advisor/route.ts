import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase'

export const maxDuration = 60

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

// POST /api/ai/platform-advisor — Analyze platform data and generate recommendations
export async function POST(request: NextRequest) {
  const userSupabase = createServerSupabase()
  const { data: { user } } = await userSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ANTHROPIC_API_KEY) return NextResponse.json({ error: 'AI not configured' }, { status: 500 })

  const { org_id } = await request.json()
  const supabase = createAdminSupabase()
  const since30d = new Date(Date.now() - 30 * 86400000).toISOString()

  // ─── Gather all platform intelligence ───

  // 1. Usage events (page views, clicks, errors)
  const { data: usageEvents } = await supabase
    .from('usage_events')
    .select('event_type, event_target, event_data, duration_ms, user_id')
    .eq('org_id', org_id)
    .gte('occurred_at', since30d)
    .limit(3000)

  // 2. Help bot questions (what users struggle with)
  const { data: helpRequests } = await supabase
    .from('help_requests')
    .select('question, category, page_context, helpful, resolved')
    .eq('org_id', org_id)
    .gte('occurred_at', since30d)
    .limit(200)

  // 3. Activity log (what CRM actions happen most)
  const { data: activityEvents } = await supabase
    .from('activity_log')
    .select('event_type')
    .eq('org_id', org_id)
    .gte('occurred_at', since30d)
    .limit(2000)

  // 4. Team members count
  const { count: teamCount } = await supabase
    .from('team_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org_id)

  // ─── Aggregate metrics ───
  const pageViews: Record<string, number> = {}
  const pageErrors: Record<string, number> = {}
  const pageDurations: Record<string, number[]> = {}
  const featureClicks: Record<string, number> = {}
  const uniquePageUsers: Record<string, Set<string>> = {}
  let totalErrors = 0

  ;(usageEvents || []).forEach(e => {
    const target = e.event_target || '/'
    if (e.event_type === 'page_view') {
      pageViews[target] = (pageViews[target] || 0) + 1
      if (e.user_id) {
        if (!uniquePageUsers[target]) uniquePageUsers[target] = new Set()
        uniquePageUsers[target].add(e.user_id)
      }
    }
    if (e.event_type === 'page_exit' && e.duration_ms) {
      if (!pageDurations[target]) pageDurations[target] = []
      pageDurations[target].push(e.duration_ms)
    }
    if (e.event_type === 'error') {
      pageErrors[target] = (pageErrors[target] || 0) + 1
      totalErrors++
    }
    if (e.event_type === 'feature_click') {
      featureClicks[target] = (featureClicks[target] || 0) + 1
    }
  })

  // Activity type counts
  const activityCounts: Record<string, number> = {}
  ;(activityEvents || []).forEach(e => {
    activityCounts[e.event_type] = (activityCounts[e.event_type] || 0) + 1
  })

  // Help request patterns
  const helpCategories: Record<string, number> = {}
  const helpPages: Record<string, number> = {}
  const unhelpfulCount = (helpRequests || []).filter(h => h.helpful === false).length
  ;(helpRequests || []).forEach(h => {
    if (h.category) helpCategories[h.category] = (helpCategories[h.category] || 0) + 1
    if (h.page_context) helpPages[h.page_context] = (helpPages[h.page_context] || 0) + 1
  })

  // Top 5 help questions (deduplicated by similarity)
  const topHelpQuestions = (helpRequests || [])
    .map(h => h.question)
    .slice(0, 30)

  // ─── Build the AI prompt ───
  const dataPayload = {
    period: 'Last 30 days',
    team_size: teamCount || 0,
    total_page_views: Object.values(pageViews).reduce((s, v) => s + v, 0),
    total_errors: totalErrors,
    total_help_requests: helpRequests?.length || 0,
    unhelpful_answers: unhelpfulCount,
    page_views_ranked: Object.entries(pageViews).sort((a, b) => b[1] - a[1]).slice(0, 20),
    pages_with_errors: Object.entries(pageErrors).sort((a, b) => b[1] - a[1]).slice(0, 10),
    pages_never_visited: [
      '/', '/crm', '/crm/contacts', '/crm/pipelines', '/crm/conversations',
      '/crm/sequences', '/crm/tasks', '/crm/analytics', '/crm/network',
      '/campaigns', '/analytics', '/tasks', '/journeys', '/social', '/media',
      '/calendar', '/shipit', '/ideas', '/library', '/ehr/sessions', '/ehr/forms',
      '/ehr/accounting', '/team', '/integrations', '/settings', '/auditor',
      '/advisory', '/icps', '/sops', '/tickets', '/media-appearances',
    ].filter(p => !pageViews[p]),
    avg_time_on_page: Object.entries(pageDurations).map(([page, durations]) => ({
      page,
      avg_seconds: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000),
    })).sort((a, b) => b.avg_seconds - a.avg_seconds).slice(0, 10),
    crm_activity_breakdown: Object.entries(activityCounts).sort((a, b) => b[1] - a[1]).slice(0, 15),
    help_request_categories: helpCategories,
    pages_generating_help_requests: Object.entries(helpPages).sort((a, b) => b[1] - a[1]).slice(0, 10),
    sample_help_questions: topHelpQuestions,
    feature_click_ranking: Object.entries(featureClicks).sort((a, b) => b[1] - a[1]).slice(0, 15),
  }

  const systemPrompt = `You are an expert product analytics advisor for NPU Hub, a multi-tenant business operations platform. You analyze real usage telemetry and user behavior data to produce actionable recommendations.

Your output must be a JSON array of recommendation objects. Each recommendation:
{
  "category": "redundancy" | "ux" | "sunset" | "performance" | "tutorial" | "adoption",
  "severity": "critical" | "warning" | "info" | "success",
  "title": "Short actionable title",
  "description": "2-3 sentence explanation with specific data backing",
  "action_items": [{"action": "verb phrase", "target": "specific page/feature", "detail": "how to do it"}]
}

Guidelines:
- REDUNDANCY: Identify pages that serve duplicate purposes based on similar view counts and overlapping paths (e.g., /analytics vs /crm/analytics, /crm/messages redirecting to /crm/conversations)
- UX: Pages with high views but low clicks = users can't find what they need. Pages with very short time = bouncing. Pages with help requests = confusing.
- SUNSET: Pages with zero or near-zero visits in 30 days are candidates for removal or consolidation.
- PERFORMANCE: Pages with high error counts need debugging. 
- TUTORIAL: Pages generating the most help requests need walkthroughs. Common questions reveal missing UI affordances.
- ADOPTION: Features with low team adoption that should be promoted or simplified.
- Be specific — reference actual page paths and data numbers.
- Prioritize critical items first.
- Generate 8-15 recommendations.
- If certain data is empty (e.g., no help requests yet), note it and recommend based on available data.`

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
          content: `Analyze this platform usage data and generate recommendations:\n\n${JSON.stringify(dataPayload, null, 2)}`,
        }],
      }),
    })

    const aiResult = await response.json()
    const text = aiResult.content?.[0]?.text || '[]'

    // Parse JSON from response (handle markdown fences)
    const cleaned = text.replace(/```json\n?|```\n?/g, '').trim()
    let recommendations = []
    try {
      recommendations = JSON.parse(cleaned)
    } catch {
      recommendations = [{ category: 'info', severity: 'info', title: 'Analysis Complete', description: text, action_items: [] }]
    }

    // Store recommendations in database
    if (Array.isArray(recommendations) && recommendations.length > 0) {
      // Clear old recommendations
      await supabase.from('ai_recommendations').delete().eq('org_id', org_id).eq('status', 'open')

      // Insert new ones
      const rows = recommendations.map((r: any) => ({
        org_id,
        category: r.category || 'info',
        title: r.title || 'Recommendation',
        description: r.description || '',
        severity: r.severity || 'info',
        action_items: r.action_items || [],
        data_basis: dataPayload,
        status: 'open',
      }))

      await supabase.from('ai_recommendations').insert(rows)
    }

    return NextResponse.json({ recommendations, data_summary: dataPayload })
  } catch (err: any) {
    console.error('Platform advisor error:', err)
    return NextResponse.json({ error: err.message || 'AI analysis failed' }, { status: 500 })
  }
}
