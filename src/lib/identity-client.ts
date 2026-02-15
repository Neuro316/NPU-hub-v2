'use client'

// ═══════════════════════════════════════════════════════════════
// UNIFIED IDENTITY CLIENT
// Handles: identity resolution, funnel tracking, timeline,
//   cross-app bridge (CRM ↔ Mastermind ↔ Social ↔ Analytics)
// ═══════════════════════════════════════════════════════════════

import { createClient } from '@/lib/supabase-browser'

// ─── Types ────────────────────────────────────────────────────

export interface IdentityRecord {
  id: string
  org_id: string
  ga4_client_id?: string
  meta_fbclid?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  first_touch_url?: string
  first_touch_at?: string
  email?: string
  full_name?: string
  phone?: string
  contact_id?: string
  user_id?: string
  cohort_id?: string
  enrollment_date?: string
  quiz_completions: any[]
  psychographic_segment?: string
  icp_classification?: string
  intake_nsci?: Record<string, any>
  midpoint_nsci?: Record<string, any>
  post_nsci?: Record<string, any>
  followup_3mo?: Record<string, any>
  followup_6mo?: Record<string, any>
  outcome_delta?: Record<string, any>
  ehr_patient_id?: string
  ehr_system?: string
  ehr_linked_at?: string
  clinical_data_consent: boolean
  match_confidence: number
  match_method?: string
  matched_at?: string
  created_at: string
  updated_at: string
}

export interface FunnelEvent {
  id?: string
  org_id: string
  identity_id?: string
  contact_id?: string
  event_type: string
  campaign_id?: string
  social_post_id?: string
  quiz_id?: string
  creative_variant?: string
  platform?: string
  funnel_stage?: number
  funnel_stage_name?: string
  event_data?: Record<string, any>
  source_module?: string
  occurred_at?: string
}

export interface TimelineEntry {
  id: string
  org_id: string
  contact_id: string
  event_type: string
  title: string
  description?: string
  metadata?: Record<string, any>
  source_table?: string
  source_id?: string
  actor_type: string
  actor_id?: string
  occurred_at: string
}

export type FunnelStage =
  | 'ad_impression' | 'landing_view' | 'quiz_start' | 'quiz_progress'
  | 'quiz_complete' | 'email_capture' | 'nurture_engaged' | 'discovery_booked'
  | 'enrollment' | 'program_active' | 'midpoint_assessment' | 'program_complete'
  | 'graduated' | 'followup_3mo' | 'followup_6mo'

const STAGE_NUMBERS: Record<FunnelStage, number> = {
  ad_impression: 1, landing_view: 2, quiz_start: 3, quiz_progress: 3,
  quiz_complete: 4, email_capture: 5, nurture_engaged: 6, discovery_booked: 7,
  enrollment: 8, program_active: 9, midpoint_assessment: 10, program_complete: 11,
  graduated: 12, followup_3mo: 13, followup_6mo: 14,
}

// ─── Identity Resolution ──────────────────────────────────────

export async function resolveIdentity(params: {
  orgId: string
  email: string
  name?: string
  contactId?: string
  userId?: string
}): Promise<IdentityRecord | null> {
  const sb = createClient()
  const { data, error } = await sb.rpc('resolve_identity', {
    p_org_id: params.orgId,
    p_email: params.email,
    p_name: params.name || null,
    p_contact_id: params.contactId || null,
    p_user_id: params.userId || null,
  })
  if (error || !data) return null

  // Fetch the full identity record
  const { data: identity } = await sb
    .from('identity_graph')
    .select('*')
    .eq('id', data)
    .single()
  return identity
}

export async function fetchIdentity(identityId: string): Promise<IdentityRecord | null> {
  const sb = createClient()
  const { data } = await sb.from('identity_graph').select('*').eq('id', identityId).single()
  return data
}

export async function fetchIdentityByContact(contactId: string): Promise<IdentityRecord | null> {
  const sb = createClient()
  const { data } = await sb.from('identity_graph').select('*').eq('contact_id', contactId).single()
  return data
}

export async function fetchIdentityByEmail(orgId: string, email: string): Promise<IdentityRecord | null> {
  const sb = createClient()
  const { data } = await sb
    .from('identity_graph')
    .select('*')
    .eq('org_id', orgId)
    .ilike('email', email)
    .single()
  return data
}

// ─── Funnel Event Tracking ────────────────────────────────────

export async function trackFunnelEvent(event: FunnelEvent): Promise<void> {
  const sb = createClient()
  const stageKey = event.event_type as FunnelStage
  await sb.from('unified_funnel_events').insert({
    ...event,
    funnel_stage: event.funnel_stage || STAGE_NUMBERS[stageKey] || null,
    funnel_stage_name: event.funnel_stage_name || event.event_type,
    occurred_at: event.occurred_at || new Date().toISOString(),
  })
}

export async function trackBulkFunnelEvents(events: FunnelEvent[]): Promise<void> {
  const sb = createClient()
  const rows = events.map(event => ({
    ...event,
    funnel_stage: event.funnel_stage || STAGE_NUMBERS[event.event_type as FunnelStage] || null,
    funnel_stage_name: event.funnel_stage_name || event.event_type,
    occurred_at: event.occurred_at || new Date().toISOString(),
  }))
  await sb.from('unified_funnel_events').insert(rows)
}

export async function fetchFunnelEvents(params: {
  orgId: string
  identityId?: string
  contactId?: string
  campaignId?: string
  eventType?: string
  limit?: number
}): Promise<FunnelEvent[]> {
  const sb = createClient()
  let q = sb.from('unified_funnel_events')
    .select('*')
    .eq('org_id', params.orgId)
    .order('occurred_at', { ascending: false })
    .limit(params.limit || 100)

  if (params.identityId) q = q.eq('identity_id', params.identityId)
  if (params.contactId) q = q.eq('contact_id', params.contactId)
  if (params.campaignId) q = q.eq('campaign_id', params.campaignId)
  if (params.eventType) q = q.eq('event_type', params.eventType)

  const { data } = await q
  return data || []
}

// ─── Funnel Conversion Summary ────────────────────────────────

export async function fetchFunnelSummary(orgId: string, campaignId?: string): Promise<{
  stage: number
  name: string
  count: number
  conversion_rate: number
}[]> {
  const sb = createClient()
  let q = sb.from('unified_funnel_events')
    .select('funnel_stage, funnel_stage_name')
    .eq('org_id', orgId)
    .gte('occurred_at', new Date(Date.now() - 90 * 86400000).toISOString())

  if (campaignId) q = q.eq('campaign_id', campaignId)

  const { data } = await q
  if (!data) return []

  // Aggregate by stage
  const stageMap = new Map<number, { name: string; count: number }>()
  data.forEach((e: any) => {
    const stage = e.funnel_stage || 0
    const existing = stageMap.get(stage) || { name: e.funnel_stage_name || 'Unknown', count: 0 }
    existing.count++
    stageMap.set(stage, existing)
  })

  const stages = Array.from(stageMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([stage, data], i, arr) => ({
      stage,
      name: data.name,
      count: data.count,
      conversion_rate: i === 0 ? 1 : data.count / (arr[i - 1]?.[1]?.count || data.count),
    }))

  return stages
}

// ─── Contact Timeline ─────────────────────────────────────────

export async function fetchContactTimeline(contactId: string, limit = 50): Promise<TimelineEntry[]> {
  const sb = createClient()
  const { data } = await sb
    .from('contact_timeline')
    .select('*')
    .eq('contact_id', contactId)
    .order('occurred_at', { ascending: false })
    .limit(limit)
  return data || []
}

export async function addTimelineEntry(entry: Omit<TimelineEntry, 'id' | 'occurred_at'> & { occurred_at?: string }): Promise<void> {
  const sb = createClient()
  await sb.from('contact_timeline').insert({
    ...entry,
    occurred_at: entry.occurred_at || new Date().toISOString(),
  })
}

// ─── Cross-Module Integrations ────────────────────────────────

/**
 * When a social media campaign is published, create a funnel event
 * and optionally link to CRM contacts who were targeted
 */
export async function trackSocialCampaignPublished(params: {
  orgId: string
  campaignId: string
  platform: string
  postId?: string
}) {
  await trackFunnelEvent({
    org_id: params.orgId,
    event_type: 'social_post_published',
    campaign_id: params.campaignId,
    social_post_id: params.postId,
    platform: params.platform,
    source_module: 'social',
    event_data: { platform: params.platform },
  })
}

/**
 * When a CRM email campaign is sent, log funnel events for each recipient
 */
export async function trackCampaignEmailsSent(params: {
  orgId: string
  campaignId: string
  contactIds: string[]
}) {
  const events: FunnelEvent[] = params.contactIds.map(contactId => ({
    org_id: params.orgId,
    contact_id: contactId,
    event_type: 'campaign_sent',
    campaign_id: params.campaignId,
    source_module: 'crm',
  }))
  await trackBulkFunnelEvents(events)
}

/**
 * When someone enrolls in Mastermind, link CRM contact to platform user
 */
export async function linkContactToMastermind(params: {
  orgId: string
  contactId: string
  userId: string
  cohortId?: string
  email: string
  name?: string
}): Promise<IdentityRecord | null> {
  const sb = createClient()

  // 1. Update the CRM contact
  await sb.from('contacts').update({
    mastermind_user_id: params.userId,
    mastermind_status: 'enrolled',
  }).eq('id', params.contactId)

  // 2. Resolve identity (links everything)
  const identity = await resolveIdentity({
    orgId: params.orgId,
    email: params.email,
    name: params.name,
    contactId: params.contactId,
    userId: params.userId,
  })

  // 3. Update identity with cohort
  if (identity && params.cohortId) {
    await sb.from('identity_graph').update({
      cohort_id: params.cohortId,
      enrollment_date: new Date().toISOString(),
    }).eq('id', identity.id)
  }

  // 4. Track funnel event
  await trackFunnelEvent({
    org_id: params.orgId,
    identity_id: identity?.id,
    contact_id: params.contactId,
    event_type: 'enrollment',
    funnel_stage: 8,
    funnel_stage_name: 'Enrollment',
    source_module: 'mastermind',
    event_data: { cohort_id: params.cohortId },
  })

  // 5. Add timeline entry
  await addTimelineEntry({
    org_id: params.orgId,
    contact_id: params.contactId,
    event_type: 'mastermind_enrolled',
    title: 'Enrolled in Immersive Mastermind',
    description: params.cohortId ? `Cohort: ${params.cohortId}` : undefined,
    metadata: { cohort_id: params.cohortId, user_id: params.userId },
    actor_type: 'system',
  })

  // 6. Update pipeline stage
  await sb.from('contacts').update({ pipeline_stage: 'Enrolled' }).eq('id', params.contactId)

  return identity
}

/**
 * Record assessment scores (intake, midpoint, post, followup)
 */
export async function recordAssessmentScores(params: {
  orgId: string
  contactId: string
  identityId?: string
  assessmentType: 'intake' | 'midpoint' | 'post' | '3mo_followup' | '6mo_followup'
  scores: Record<string, any>
  compositeScore?: number
}) {
  const sb = createClient()

  // Map assessment type to identity field
  const fieldMap: Record<string, string> = {
    intake: 'intake_nsci',
    midpoint: 'midpoint_nsci',
    post: 'post_nsci',
    '3mo_followup': 'followup_3mo',
    '6mo_followup': 'followup_6mo',
  }

  const funnelMap: Record<string, { stage: number; name: string }> = {
    intake: { stage: 9, name: 'Program Active' },
    midpoint: { stage: 10, name: 'Midpoint Assessment' },
    post: { stage: 11, name: 'Program Complete' },
    '3mo_followup': { stage: 13, name: '3-Month Follow-up' },
    '6mo_followup': { stage: 14, name: '6-Month Follow-up' },
  }

  // Update identity graph if we have one
  let identityId = params.identityId
  if (!identityId) {
    const { data: contact } = await sb.from('contacts').select('identity_id, email').eq('id', params.contactId).single()
    identityId = contact?.identity_id
  }

  if (identityId) {
    const field = fieldMap[params.assessmentType]
    if (field) {
      await sb.from('identity_graph').update({
        [field]: params.scores,
        updated_at: new Date().toISOString(),
      }).eq('id', identityId)

      // Compute outcome delta if post-program
      if (params.assessmentType === 'post') {
        const { data: identity } = await sb.from('identity_graph').select('intake_nsci').eq('id', identityId).single()
        if (identity?.intake_nsci) {
          const delta: Record<string, number> = {}
          Object.keys(params.scores).forEach(domain => {
            if (identity.intake_nsci[domain] !== undefined) {
              delta[domain] = params.scores[domain] - identity.intake_nsci[domain]
            }
          })
          if (params.compositeScore !== undefined) {
            const intakeComposite = Object.values(identity.intake_nsci as Record<string, number>).reduce((a, b) => a + b, 0) / Object.keys(identity.intake_nsci).length
            delta.composite = params.compositeScore - intakeComposite
          }
          await sb.from('identity_graph').update({ outcome_delta: delta }).eq('id', identityId)
        }
      }
    }
  }

  // Track funnel event
  const funnel = funnelMap[params.assessmentType]
  if (funnel) {
    await trackFunnelEvent({
      org_id: params.orgId,
      identity_id: identityId || undefined,
      contact_id: params.contactId,
      event_type: 'assessment_complete',
      funnel_stage: funnel.stage,
      funnel_stage_name: funnel.name,
      source_module: 'mastermind',
      event_data: { assessment_type: params.assessmentType, composite_score: params.compositeScore },
    })
  }

  // Timeline
  await addTimelineEntry({
    org_id: params.orgId,
    contact_id: params.contactId,
    event_type: 'assessment',
    title: `${params.assessmentType.replace('_', ' ')} assessment completed`,
    description: params.compositeScore ? `Composite score: ${params.compositeScore}` : undefined,
    metadata: { type: params.assessmentType, scores: params.scores },
    actor_type: 'system',
  })
}

/**
 * Update contact's mastermind status as they progress
 */
export async function updateMastermindStatus(
  contactId: string,
  status: 'prospect' | 'enrolled' | 'active' | 'completed' | 'graduated' | 'alumni'
) {
  const sb = createClient()
  await sb.from('contacts').update({ mastermind_status: status }).eq('id', contactId)
}

/**
 * Link a quiz completion to a CRM contact (identity resolution)
 */
export async function linkQuizToContact(params: {
  orgId: string
  email: string
  name: string
  quizId: string
  scores: Record<string, any>
  segment?: string
  icp?: string
  utm?: Record<string, string>
}): Promise<{ identityId: string; contactId?: string }> {
  const sb = createClient()

  // Resolve or create identity
  const identity = await resolveIdentity({
    orgId: params.orgId,
    email: params.email,
    name: params.name,
  })

  if (!identity) throw new Error('Failed to resolve identity')

  // Append quiz completion to identity
  const completions = [...(identity.quiz_completions || []), {
    quiz_id: params.quizId,
    scores: params.scores,
    segment: params.segment,
    completed_at: new Date().toISOString(),
  }]

  await sb.from('identity_graph').update({
    quiz_completions: completions,
    psychographic_segment: params.segment || identity.psychographic_segment,
    icp_classification: params.icp || identity.icp_classification,
    utm_source: params.utm?.utm_source || identity.utm_source,
    utm_medium: params.utm?.utm_medium || identity.utm_medium,
    utm_campaign: params.utm?.utm_campaign || identity.utm_campaign,
    utm_content: params.utm?.utm_content || identity.utm_content,
    utm_term: params.utm?.utm_term || identity.utm_term,
  }).eq('id', identity.id)

  // If identity linked to a contact, update contact attribution
  if (identity.contact_id) {
    await sb.from('contacts').update({
      acquisition_source: params.utm?.utm_source,
      acquisition_campaign: params.utm?.utm_campaign,
      acquisition_utm: params.utm,
    }).eq('id', identity.contact_id)
  }

  // Track funnel events
  await trackFunnelEvent({
    org_id: params.orgId,
    identity_id: identity.id,
    contact_id: identity.contact_id || undefined,
    event_type: 'quiz_complete',
    quiz_id: params.quizId,
    platform: params.utm?.utm_source,
    source_module: 'quiz',
    event_data: { segment: params.segment, icp: params.icp, composite: params.scores.composite },
  })
  await trackFunnelEvent({
    org_id: params.orgId,
    identity_id: identity.id,
    contact_id: identity.contact_id || undefined,
    event_type: 'email_capture',
    quiz_id: params.quizId,
    source_module: 'quiz',
  })

  // Timeline entry if contact exists
  if (identity.contact_id) {
    await addTimelineEntry({
      org_id: params.orgId,
      contact_id: identity.contact_id,
      event_type: 'quiz_completed',
      title: `Completed quiz: ${params.quizId}`,
      description: params.segment ? `Segment: ${params.segment}` : undefined,
      metadata: { quiz_id: params.quizId, scores: params.scores, segment: params.segment },
      actor_type: 'system',
    })
  }

  return { identityId: identity.id, contactId: identity.contact_id || undefined }
}

// ─── Sensorium EHR Integration Point ─────────────────────────

/**
 * Placeholder for future EHR integration.
 * When Sensorium EHR is built, this function links a CRM contact
 * to a patient record in the EHR system.
 */
export async function linkContactToEHR(params: {
  contactId: string
  ehrPatientId: string
  ehrSystem: string
  clinicalDataConsent: boolean
}): Promise<void> {
  const sb = createClient()

  await sb.from('contacts').update({
    ehr_patient_id: params.ehrPatientId,
  }).eq('id', params.contactId)

  // Also update identity graph
  const { data: contact } = await sb.from('contacts').select('identity_id').eq('id', params.contactId).single()
  if (contact?.identity_id) {
    await sb.from('identity_graph').update({
      ehr_patient_id: params.ehrPatientId,
      ehr_system: params.ehrSystem,
      ehr_linked_at: new Date().toISOString(),
      clinical_data_consent: params.clinicalDataConsent,
    }).eq('id', contact.identity_id)
  }
}

// ─── Analytics Queries ────────────────────────────────────────

/**
 * Get attribution effectiveness: which campaigns produce the best outcomes
 */
export async function fetchAttributionEffectiveness(orgId: string): Promise<{
  campaign: string
  source: string
  icp: string
  total_leads: number
  enrolled: number
  completed: number
  avg_improvement: number | null
}[]> {
  const sb = createClient()
  const { data } = await sb.from('attribution_effectiveness').select('*').eq('org_id', orgId)
  return (data || []).map((r: any) => ({
    campaign: r.utm_campaign || 'Unknown',
    source: r.utm_source || 'Unknown',
    icp: r.icp_classification || 'Unknown',
    total_leads: r.total_leads,
    enrolled: r.enrolled,
    completed: r.completed_program,
    avg_improvement: r.avg_outcome_improvement,
  }))
}

/**
 * Get contact lifecycle breakdown
 */
export async function fetchLifecycleSummary(orgId: string): Promise<{
  status: string
  health_tier: string
  source: string
  count: number
  avg_health: number
}[]> {
  const sb = createClient()
  const { data } = await sb.from('contact_lifecycle_summary').select('*').eq('org_id', orgId)
  return (data || []).map((r: any) => ({
    status: r.mastermind_status || 'prospect',
    health_tier: r.health_tier || 'stable',
    source: r.acquisition_source || 'Unknown',
    count: r.contact_count,
    avg_health: r.avg_health_score,
  }))
}
