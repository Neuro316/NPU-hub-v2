import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

// ═══════════════════════════════════════════════════════════════
// POST /api/identity/resolve
// Called by Mastermind platform on enrollment to:
// 1. Find or create identity graph record
// 2. Link CRM contact to Mastermind user
// 3. Pull full attribution history
// 4. Track enrollment funnel event
// ═══════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { org_id, email, name, user_id, cohort_id, phone } = body

    if (!org_id || !email) {
      return NextResponse.json({ error: 'org_id and email required' }, { status: 400 })
    }

    const sb = createAdminSupabase()

    // 1. Resolve identity
    const { data: identityId, error: resolveErr } = await sb.rpc('resolve_identity', {
      p_org_id: org_id,
      p_email: email,
      p_name: name || null,
      p_contact_id: null,
      p_user_id: user_id || null,
    })

    if (resolveErr) {
      return NextResponse.json({ error: resolveErr.message }, { status: 500 })
    }

    // 2. Update identity with enrollment data
    if (identityId) {
      await sb.from('identity_graph').update({
        user_id: user_id || null,
        cohort_id: cohort_id || null,
        enrollment_date: new Date().toISOString(),
        phone: phone || null,
        updated_at: new Date().toISOString(),
      }).eq('id', identityId)
    }

    // 3. Find or create CRM contact
    let contactId: string | null = null

    // Check if identity already linked to a contact
    const { data: identity } = await sb.from('identity_graph')
      .select('contact_id')
      .eq('id', identityId)
      .single()

    if (identity?.contact_id) {
      contactId = identity.contact_id
    } else {
      // Check if contact exists by email
      const { data: existing } = await sb.from('contacts')
        .select('id')
        .eq('org_id', org_id)
        .ilike('email', email)
        .is('merged_into_id', null)
        .limit(1)
        .single()

      if (existing) {
        contactId = existing.id
      } else {
        // Create CRM contact from enrollment
        const nameParts = (name || '').split(' ')
        const { data: newContact } = await sb.from('contacts').insert({
          org_id,
          first_name: nameParts[0] || 'Unknown',
          last_name: nameParts.slice(1).join(' ') || '',
          email,
          phone: phone || null,
          source: 'mastermind_enrollment',
          pipeline_stage: 'Enrolled',
          identity_id: identityId,
          mastermind_user_id: user_id,
          mastermind_status: 'enrolled',
          tags: ['Mastermind Participant'],
        }).select('id').single()

        contactId = newContact?.id || null
      }
    }

    // 4. Link contact to identity and update status
    if (contactId) {
      await sb.from('contacts').update({
        identity_id: identityId,
        mastermind_user_id: user_id || null,
        mastermind_status: 'enrolled',
        pipeline_stage: 'Enrolled',
        last_contacted_at: new Date().toISOString(),
      }).eq('id', contactId)

      await sb.from('identity_graph').update({
        contact_id: contactId,
      }).eq('id', identityId)

      // 5. Create timeline entry
      await sb.from('contact_timeline').insert({
        org_id,
        contact_id: contactId,
        event_type: 'mastermind_enrolled',
        title: 'Enrolled in Immersive Mastermind',
        description: cohort_id ? `Cohort: ${cohort_id}` : 'Enrollment confirmed',
        metadata: { cohort_id, user_id },
        actor_type: 'system',
        occurred_at: new Date().toISOString(),
      })

      // 6. Track funnel event
      await sb.from('unified_funnel_events').insert({
        org_id,
        identity_id: identityId,
        contact_id: contactId,
        event_type: 'enrollment',
        funnel_stage: 8,
        funnel_stage_name: 'Enrollment',
        source_module: 'mastermind',
        event_data: { cohort_id, user_id },
        occurred_at: new Date().toISOString(),
      })
    }

    // 7. Fetch full attribution history for the identity
    const { data: fullIdentity } = await sb.from('identity_graph')
      .select('*')
      .eq('id', identityId)
      .single()

    return NextResponse.json({
      success: true,
      identity_id: identityId,
      contact_id: contactId,
      attribution: fullIdentity ? {
        utm_source: fullIdentity.utm_source,
        utm_medium: fullIdentity.utm_medium,
        utm_campaign: fullIdentity.utm_campaign,
        utm_content: fullIdentity.utm_content,
        first_touch_at: fullIdentity.first_touch_at,
        quiz_completions: fullIdentity.quiz_completions,
        psychographic_segment: fullIdentity.psychographic_segment,
        icp_classification: fullIdentity.icp_classification,
      } : null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/identity/resolve?email=...&org_id=...
// Lookup identity by email - returns attribution + program status
// Used by Mastermind platform to show where a participant came from
// ═══════════════════════════════════════════════════════════════

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const email = searchParams.get('email')
  const orgId = searchParams.get('org_id')

  if (!email || !orgId) {
    return NextResponse.json({ error: 'email and org_id required' }, { status: 400 })
  }

  const sb = createAdminSupabase()
  const { data: identity } = await sb.from('identity_graph')
    .select('*')
    .eq('org_id', orgId)
    .ilike('email', email)
    .single()

  if (!identity) {
    return NextResponse.json({ found: false })
  }

  // Fetch linked contact data
  let contact = null
  if (identity.contact_id) {
    const { data } = await sb.from('contacts')
      .select('id, first_name, last_name, phone, tags, pipeline_stage, health_score, health_tier, mastermind_status, acquisition_source, acquisition_campaign')
      .eq('id', identity.contact_id)
      .single()
    contact = data
  }

  // Fetch recent funnel events
  const { data: funnelEvents } = await sb.from('unified_funnel_events')
    .select('event_type, funnel_stage, funnel_stage_name, occurred_at, event_data')
    .eq('identity_id', identity.id)
    .order('occurred_at', { ascending: true })
    .limit(50)

  return NextResponse.json({
    found: true,
    identity: {
      id: identity.id,
      email: identity.email,
      full_name: identity.full_name,
      psychographic_segment: identity.psychographic_segment,
      icp_classification: identity.icp_classification,
      quiz_completions: identity.quiz_completions,
      intake_nsci: identity.intake_nsci,
      post_nsci: identity.post_nsci,
      outcome_delta: identity.outcome_delta,
      enrollment_date: identity.enrollment_date,
      cohort_id: identity.cohort_id,
    },
    contact,
    funnel_journey: funnelEvents || [],
    attribution: {
      source: identity.utm_source,
      medium: identity.utm_medium,
      campaign: identity.utm_campaign,
      content: identity.utm_content,
      first_touch: identity.first_touch_at,
    },
  })
}
