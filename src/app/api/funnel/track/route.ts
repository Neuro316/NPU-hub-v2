import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

// ═══════════════════════════════════════════════════════════════
// POST /api/funnel/track
// External endpoint for quiz frontends, Mastermind platform,
// and webhook integrations to post funnel events
// ═══════════════════════════════════════════════════════════════

const STAGE_MAP: Record<string, number> = {
  ad_impression: 1, landing_view: 2, quiz_start: 3, quiz_progress: 3,
  quiz_complete: 4, email_capture: 5, nurture_engaged: 6, discovery_booked: 7,
  enrollment: 8, program_active: 9, midpoint_assessment: 10, program_complete: 11,
  graduated: 12, followup_3mo: 13, followup_6mo: 14,
  social_post_published: 0, campaign_sent: 0, sms_sent: 0, call_completed: 0,
  lesson_complete: 9, session_complete: 9, journal_entry: 9, assessment_complete: 10,
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { org_id, events, event } = body

    if (!org_id) {
      return NextResponse.json({ error: 'org_id required' }, { status: 400 })
    }

    const sb = createAdminSupabase()
    const eventList = events || (event ? [event] : [])

    if (eventList.length === 0) {
      return NextResponse.json({ error: 'No events provided' }, { status: 400 })
    }

    const rows = eventList.map((e: any) => ({
      org_id,
      identity_id: e.identity_id || null,
      contact_id: e.contact_id || null,
      event_type: e.event_type,
      campaign_id: e.campaign_id || null,
      social_post_id: e.social_post_id || null,
      quiz_id: e.quiz_id || null,
      creative_variant: e.creative_variant || null,
      platform: e.platform || null,
      funnel_stage: e.funnel_stage || STAGE_MAP[e.event_type] || null,
      funnel_stage_name: e.funnel_stage_name || e.event_type,
      event_data: e.event_data || {},
      source_module: e.source_module || 'external',
      occurred_at: e.occurred_at || new Date().toISOString(),
    }))

    const { error } = await sb.from('unified_funnel_events').insert(rows)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Auto-resolve identity for quiz_complete / email_capture events
    for (const e of eventList) {
      if ((e.event_type === 'quiz_complete' || e.event_type === 'email_capture') && e.email) {
        const { data: identityId } = await sb.rpc('resolve_identity', {
          p_org_id: org_id,
          p_email: e.email,
          p_name: e.name || null,
          p_contact_id: null,
          p_user_id: null,
        })

        // Update the funnel event with identity
        if (identityId) {
          await sb.from('unified_funnel_events')
            .update({ identity_id: identityId })
            .eq('org_id', org_id)
            .eq('event_type', e.event_type)
            .eq('quiz_id', e.quiz_id)
            .is('identity_id', null)
            .limit(1)

          // Update identity with quiz data
          if (e.event_type === 'quiz_complete' && e.scores) {
            const { data: existing } = await sb.from('identity_graph')
              .select('quiz_completions')
              .eq('id', identityId)
              .single()

            const completions = [...(existing?.quiz_completions || []), {
              quiz_id: e.quiz_id,
              scores: e.scores,
              segment: e.segment,
              completed_at: new Date().toISOString(),
            }]

            await sb.from('identity_graph').update({
              quiz_completions: completions,
              psychographic_segment: e.segment || null,
              icp_classification: e.icp || null,
              utm_source: e.utm_source || null,
              utm_medium: e.utm_medium || null,
              utm_campaign: e.utm_campaign || null,
              utm_content: e.utm_content || null,
            }).eq('id', identityId)
          }
        }
      }
    }

    return NextResponse.json({ success: true, count: rows.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// GET: Fetch funnel summary for a campaign or org
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('org_id')
  const campaignId = searchParams.get('campaign_id')
  const days = parseInt(searchParams.get('days') || '90')

  if (!orgId) {
    return NextResponse.json({ error: 'org_id required' }, { status: 400 })
  }

  const sb = createAdminSupabase()
  const since = new Date(Date.now() - days * 86400000).toISOString()

  let q = sb.from('unified_funnel_events')
    .select('funnel_stage, funnel_stage_name, identity_id')
    .eq('org_id', orgId)
    .gte('occurred_at', since)
    .not('funnel_stage', 'is', null)

  if (campaignId) q = q.eq('campaign_id', campaignId)

  const { data, error } = await q

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aggregate
  const stages = new Map<number, { name: string; total: number; unique: Set<string> }>()
  ;(data || []).forEach((e: any) => {
    const existing = stages.get(e.funnel_stage) || { name: e.funnel_stage_name, total: 0, unique: new Set() }
    existing.total++
    if (e.identity_id) existing.unique.add(e.identity_id)
    stages.set(e.funnel_stage, existing)
  })

  const summary = Array.from(stages.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([stage, data]) => ({
      stage,
      name: data.name,
      total_events: data.total,
      unique_people: data.unique.size,
    }))

  return NextResponse.json({ summary })
}
