import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { verifyCronSecret } from '@/lib/crm-server'

// GET /api/usage/rollup — Cron job: aggregate yesterday's usage into daily stats
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabase()

  // Aggregate yesterday's data
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const dateStr = yesterday.toISOString().split('T')[0]
  const dayStart = `${dateStr}T00:00:00Z`
  const dayEnd = `${dateStr}T23:59:59Z`

  // Get all page_view events from yesterday grouped by org, page, user
  const { data: events } = await supabase
    .from('usage_events')
    .select('org_id, user_id, event_type, event_target, duration_ms')
    .gte('occurred_at', dayStart)
    .lte('occurred_at', dayEnd)

  if (!events || events.length === 0) {
    return NextResponse.json({ processed: 0, date: dateStr })
  }

  // Group by org + page + user
  const groups: Record<string, {
    org_id: string; page_path: string; user_id: string;
    page_views: number; feature_clicks: number; errors: number;
    api_calls: number; durations: number[]
  }> = {}

  events.forEach(e => {
    if (!e.org_id) return
    const page = e.event_target || '/'
    const key = `${e.org_id}::${page}::${e.user_id || 'anon'}`

    if (!groups[key]) {
      groups[key] = {
        org_id: e.org_id, page_path: page, user_id: e.user_id || '',
        page_views: 0, feature_clicks: 0, errors: 0, api_calls: 0, durations: [],
      }
    }

    const g = groups[key]
    if (e.event_type === 'page_view') g.page_views++
    if (e.event_type === 'feature_click') g.feature_clicks++
    if (e.event_type === 'error') g.errors++
    if (e.event_type === 'api_call') g.api_calls++
    if (e.event_type === 'page_exit' && e.duration_ms) g.durations.push(e.duration_ms)
  })

  // Upsert rollup rows
  const rows = Object.values(groups).map(g => ({
    org_id: g.org_id,
    stat_date: dateStr,
    page_path: g.page_path,
    user_id: g.user_id || null,
    page_views: g.page_views,
    unique_users: 1,
    avg_duration_ms: g.durations.length > 0
      ? Math.round(g.durations.reduce((a, b) => a + b, 0) / g.durations.length)
      : 0,
    feature_clicks: g.feature_clicks,
    errors: g.errors,
    api_calls: g.api_calls,
  }))

  const { error } = await supabase.from('usage_daily_stats').upsert(rows, {
    onConflict: 'org_id,stat_date,page_path,user_id',
  })

  if (error) console.error('Rollup error:', error)

  // Purge raw events older than 30 days to keep table lean
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  await supabase.from('usage_events').delete().lt('occurred_at', thirtyDaysAgo.toISOString())

  return NextResponse.json({ processed: rows.length, date: dateStr })
}
