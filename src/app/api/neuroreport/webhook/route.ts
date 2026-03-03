import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createHmac } from 'crypto'

export const maxDuration = 30

/* ═══════════════════════════════════════════════════════════════
   POST /api/neuroreport/webhook
   
   Called by NeuroReport (reports.neuroprogeny.com) when a report
   is finalized. Creates a care plan with recommended services.
   
   Expected payload:
   {
     event: 'report.finalized',
     report_id: string,
     report_type: 'FNA' | 'qEEG' | 'follow_up' | 'reassessment',
     report_date: ISO string,
     client_email: string,
     client_name: string,
     org_slug: string,           // 'sensorium' or 'neuro-progeny'
     
     // Structured recommendations (preferred path)
     recommendations?: {
       services: Array<{
         service_type: string,   // matches ecr_service_types keys
         priority: 'critical' | 'high' | 'standard' | 'optional',
         frequency?: string,     // '2x/week', 'weekly', etc.
         duration_weeks?: number,
         notes?: string,
       }>,
       summary?: string,
     },
     
     // Free-text fallback (parsed by AI agent)
     recommendation_text?: string,
     
     // Assessment scores (updates ecr_assessment_links)
     scores?: Record<string, any>,
   }
   
   Auth: HMAC-SHA256 signature in x-webhook-signature header.
   Signature = HMAC(request body, shared secret)
   ═══════════════════════════════════════════════════════════════ */

// ─── Service Type Mapping ────────────────────────────────────
// Maps common NeuroReport recommendation terms to our service keys.
// This handles slight naming differences between systems.
const SERVICE_TYPE_MAP: Record<string, string> = {
  // Direct matches
  'neurofeedback': 'neurofeedback',
  'vr_biofeedback': 'vr_biofeedback',
  'vr biofeedback': 'vr_biofeedback',
  'hbot': 'hbot',
  'hyperbaric': 'hbot',
  'red_light_bed': 'red_light_bed',
  'red light bed': 'red_light_bed',
  'photobiomodulation': 'red_light_bed',
  'redlight_helmet': 'redlight_helmet',
  'red light helmet': 'redlight_helmet',
  'vielight': 'vielight',
  'ssp': 'ssp',
  'safe and sound': 'ssp',
  'safe_and_sound': 'ssp',
  'vagus_nerve_stim': 'vagus_nerve_stim',
  'vagus nerve': 'vagus_nerve_stim',
  'vns': 'vagus_nerve_stim',
  'oculomotor': 'oculomotor',
  'eye tracking': 'oculomotor',
  'vestibular': 'vestibular',
  'balance': 'vestibular',
  'proprioception': 'proprioception',
  'fna_assessment': 'fna_assessment',
  'fna': 'fna_assessment',
  'functional neuro': 'fna_assessment',
  'initial_map': 'initial_map',
  'qeeg': 'initial_map',
  'brain map': 'initial_map',
  'neuro_program': 'neuro_program',
  'follow_up_consult': 'follow_up_consult',
  'follow up': 'follow_up_consult',
  'consultation': 'follow_up_consult',
  'consult': 'follow_up_consult',
}

function resolveServiceType(input: string): string {
  const normalized = input.toLowerCase().trim()
  return SERVICE_TYPE_MAP[normalized] || 'custom'
}

// ─── Signature Verification ──────────────────────────────────
async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  const expected = createHmac('sha256', secret).update(body).digest('hex')
  return signature === expected
}

export async function POST(request: NextRequest) {
  const supabase = createAdminSupabase()
  const rawBody = await request.text()
  
  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { event, report_id, report_type, report_date, client_email, org_slug } = payload

  // ── Validate required fields ────────────────────────────────
  if (event !== 'report.finalized') {
    return NextResponse.json({ error: 'Unsupported event', received: event }, { status: 400 })
  }

  if (!report_id || !client_email || !org_slug) {
    return NextResponse.json({ error: 'Missing required fields: report_id, client_email, org_slug' }, { status: 400 })
  }

  // ── Find org ────────────────────────────────────────────────
  const { data: org } = await supabase
    .from('organizations')
    .select('id, slug')
    .or(`slug.ilike.%${org_slug}%,name.ilike.%${org_slug}%`)
    .limit(1)
    .maybeSingle()

  if (!org) {
    return NextResponse.json({ error: `Organization not found: ${org_slug}` }, { status: 404 })
  }

  // ── Verify webhook signature ────────────────────────────────
  const signature = request.headers.get('x-webhook-signature') || ''
  const { data: secretRow } = await supabase
    .from('webhook_secrets')
    .select('secret_key')
    .eq('org_id', org.id)
    .eq('service_name', 'neuroreport')
    .eq('is_active', true)
    .maybeSingle()

  if (secretRow?.secret_key) {
    const valid = await verifySignature(rawBody, signature, secretRow.secret_key)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
    }
  }
  // If no secret configured, allow (dev mode) but log warning
  if (!secretRow) {
    console.warn(`[neuroreport-webhook] No webhook secret configured for org ${org.id}. Accepting without verification.`)
  }

  // ── Find contact by email ───────────────────────────────────
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, email')
    .eq('org_id', org.id)
    .ilike('email', client_email)
    .limit(1)
    .maybeSingle()

  if (!contact) {
    return NextResponse.json({
      error: `Contact not found for email: ${client_email}`,
      hint: 'Ensure the client exists in the CRM before finalizing reports.',
    }, { status: 404 })
  }

  // ── Update assessment link if exists ────────────────────────
  const assessType = report_type === 'FNA' ? 'fna' : report_type === 'qEEG' ? 'qeeg' : report_type?.toLowerCase()
  if (assessType) {
    await supabase
      .from('ecr_assessment_links')
      .update({
        status: 'completed',
        completed_at: report_date || new Date().toISOString(),
        report_id: report_id,
        report_finalized_at: report_date || new Date().toISOString(),
        report_url: `${process.env.NEUROREPORT_URL || 'https://reports.neuroprogeny.com'}/reports/${report_id}`,
        score: payload.scores || null,
      })
      .eq('org_id', org.id)
      .eq('contact_id', contact.id)
      .eq('assessment_type', assessType)

    // Create link if it didn't exist
    await supabase.from('ecr_assessment_links').upsert({
      org_id: org.id,
      contact_id: contact.id,
      assessment_type: assessType,
      assessment_name: report_type || assessType,
      status: 'completed',
      completed_at: report_date || new Date().toISOString(),
      report_id: report_id,
      report_finalized_at: report_date || new Date().toISOString(),
      report_url: `${process.env.NEUROREPORT_URL || 'https://reports.neuroprogeny.com'}/reports/${report_id}`,
      score: payload.scores || null,
    }, { onConflict: 'org_id,contact_id,assessment_type', ignoreDuplicates: true })
  }

  // ── Process Recommendations ─────────────────────────────────
  const structuredRecs = payload.recommendations?.services
  const freeTextRecs = payload.recommendation_text
  let serviceEntries: any[] = []
  let source: string = 'clinician_manual'

  if (structuredRecs && structuredRecs.length > 0) {
    // Path 1: Structured recommendations (deterministic)
    source = 'neuroreport_structured'
    serviceEntries = structuredRecs.map((rec: any) => ({
      org_id: org.id,
      contact_id: contact.id,
      service_type: resolveServiceType(rec.service_type),
      service_date: new Date().toISOString().split('T')[0],
      status: 'recommended',
      recommendation_source: source,
      recommendation_text: rec.notes || null,
      neuroreport_report_id: report_id,
      priority: rec.priority || 'standard',
      notes: [
        rec.notes || '',
        rec.frequency ? `Frequency: ${rec.frequency}` : '',
        rec.duration_weeks ? `Duration: ${rec.duration_weeks} weeks` : '',
      ].filter(Boolean).join('\n'),
      metadata: { frequency: rec.frequency, duration_weeks: rec.duration_weeks },
    }))
  } else if (freeTextRecs) {
    // Path 2: AI parsing (stored raw, parsed async)
    source = 'neuroreport_ai_parsed'
    // We'll create the care plan with raw text and parse via the AI endpoint.
    // The parse-recommendations endpoint is called separately.
  }

  // ── Create Care Plan ────────────────────────────────────────
  const { data: carePlan, error: cpError } = await supabase
    .from('ecr_care_plans')
    .insert({
      org_id: org.id,
      contact_id: contact.id,
      neuroreport_report_id: report_id,
      report_type: report_type,
      report_date: report_date || new Date().toISOString(),
      title: `${report_type || 'Assessment'} Care Plan - ${contact.first_name} ${contact.last_name}`,
      raw_recommendations: freeTextRecs || payload.recommendations?.summary || null,
      parsed_services: structuredRecs ? serviceEntries : [],
      status: structuredRecs ? 'pending' : 'pending', // both start pending
    })
    .select()
    .single()

  if (cpError) {
    console.error('[neuroreport-webhook] Care plan creation error:', cpError)
    return NextResponse.json({ error: 'Failed to create care plan', detail: cpError.message }, { status: 500 })
  }

  // ── Create Recommended Service Entries (structured path) ────
  let createdServices = 0
  if (serviceEntries.length > 0 && carePlan) {
    const { data: inserted, error: svcError } = await supabase
      .from('ecr_service_entries')
      .insert(serviceEntries)
      .select()

    if (svcError) {
      console.error('[neuroreport-webhook] Service entry error:', svcError)
    } else {
      createdServices = inserted?.length || 0
    }

    // Link care plan to assessment
    if (assessType) {
      await supabase
        .from('ecr_assessment_links')
        .update({ care_plan_id: carePlan.id })
        .eq('org_id', org.id)
        .eq('contact_id', contact.id)
        .eq('assessment_type', assessType)
    }
  }

  // ── If free-text only, trigger AI parsing ───────────────────
  if (!structuredRecs && freeTextRecs && carePlan) {
    // Fire-and-forget call to the AI parsing endpoint.
    // In production, you'd use a queue. For now, we call it inline.
    try {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin
      await fetch(`${baseUrl}/api/neuroreport/parse-recommendations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          care_plan_id: carePlan.id,
          org_id: org.id,
          contact_id: contact.id,
          report_id: report_id,
          recommendation_text: freeTextRecs,
        }),
      })
    } catch (err) {
      console.error('[neuroreport-webhook] AI parse trigger error:', err)
      // Non-fatal: care plan exists with raw text, clinician can review manually
    }
  }

  return NextResponse.json({
    success: true,
    care_plan_id: carePlan?.id,
    services_created: createdServices,
    source,
    contact_id: contact.id,
    parse_pending: !structuredRecs && !!freeTextRecs,
  })
}
