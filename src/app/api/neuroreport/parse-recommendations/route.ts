import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

export const maxDuration = 60

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

/* ═══════════════════════════════════════════════════════════════
   POST /api/neuroreport/parse-recommendations
   
   AI agent that parses free-text clinical recommendations into
   structured service entries for the Sensorium ECR.
   
   Called by:
   1. The webhook endpoint (auto, when NeuroReport sends free text)
   2. The ECR UI (manual, when clinician pastes recommendations)
   
   Expected payload:
   {
     care_plan_id: string,       // existing care plan to update
     org_id: string,
     contact_id: string,
     report_id?: string,
     recommendation_text: string, // free-text recommendations
   }
   ═══════════════════════════════════════════════════════════════ */

// Available Sensorium service types for the AI to map to
const AVAILABLE_SERVICES = [
  { key: 'neurofeedback', name: 'Neurofeedback', category: 'treatment' },
  { key: 'vr_biofeedback', name: 'VR Biofeedback', category: 'treatment' },
  { key: 'hbot', name: 'HBOT (Hyperbaric Oxygen Therapy)', category: 'modality' },
  { key: 'red_light_bed', name: 'Red Light Bed / Photobiomodulation', category: 'modality' },
  { key: 'redlight_helmet', name: 'Red Light Helmet', category: 'modality' },
  { key: 'vielight', name: 'Vielight (Intranasal Photobiomodulation)', category: 'modality' },
  { key: 'ssp', name: 'SSP (Safe & Sound Protocol)', category: 'modality' },
  { key: 'vagus_nerve_stim', name: 'Vagus Nerve Stimulation', category: 'modality' },
  { key: 'oculomotor', name: 'Oculomotor Training', category: 'assessment' },
  { key: 'vestibular', name: 'Vestibular Training', category: 'assessment' },
  { key: 'proprioception', name: 'Proprioception Training', category: 'assessment' },
  { key: 'initial_map', name: 'Initial Map (qEEG)', category: 'assessment' },
  { key: 'fna_assessment', name: 'FNA (Functional Neuro Assessment)', category: 'assessment' },
  { key: 'neuro_program', name: 'Neuro Program', category: 'treatment' },
  { key: 'follow_up_consult', name: 'Follow-up Consultation', category: 'consult' },
  { key: 'custom', name: 'Custom / Other', category: 'other' },
]

const SYSTEM_PROMPT = `You are a clinical recommendation parser for a neuroscience wellness center (Sensorium Neuro Wellness). Your job is to extract structured service recommendations from free-text clinical notes and assessment reports.

AVAILABLE SERVICE TYPES:
${AVAILABLE_SERVICES.map(s => `- "${s.key}": ${s.name} (${s.category})`).join('\n')}

RULES:
1. Map each recommendation to one of the available service_type keys above
2. If a recommendation doesn't match any service, use "custom"
3. Extract frequency (e.g., "2x/week", "weekly", "3 sessions")
4. Extract duration if mentioned (e.g., "6 weeks", "ongoing")
5. Extract priority: "critical" (must do), "high" (strongly recommended), "standard" (recommended), "optional" (if budget allows)
6. Include any specific notes or protocols mentioned
7. Do NOT invent recommendations that aren't in the text
8. Do NOT add generic recommendations not mentioned by the clinician
9. Combine related items (e.g., "neurofeedback 2x/week for 12 weeks" = one entry)

Respond ONLY with a JSON array. No markdown, no backticks, no preamble:
[
  {
    "service_type": "neurofeedback",
    "priority": "high",
    "frequency": "2x/week",
    "duration_weeks": 12,
    "notes": "Focus on SMR protocol at Cz, reduce theta/beta ratio"
  }
]

If no actionable service recommendations are found, respond with an empty array: []`

export async function POST(request: NextRequest) {
  const supabase = createAdminSupabase()

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { care_plan_id, org_id, contact_id, report_id, recommendation_text } = body

  if (!care_plan_id || !org_id || !contact_id || !recommendation_text) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  // ── Call Claude to parse recommendations ────────────────────
  let parsedServices: any[] = []

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
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Parse the following clinical recommendations into structured service entries:\n\n${recommendation_text}`,
        }],
      }),
    })

    const data = await response.json()
    const text = data.content?.[0]?.text || '[]'

    // Parse the response - strip any markdown fences just in case
    const cleaned = text.replace(/```json|```/g, '').trim()
    parsedServices = JSON.parse(cleaned)

    if (!Array.isArray(parsedServices)) {
      parsedServices = []
    }
  } catch (err) {
    console.error('[parse-recommendations] AI parsing error:', err)
    // Non-fatal: update care plan with error, clinician can review manually
    await supabase
      .from('ecr_care_plans')
      .update({
        parsed_services: [],
        status: 'pending',
        review_notes: 'AI parsing failed. Please review recommendations manually.',
      })
      .eq('id', care_plan_id)

    return NextResponse.json({
      success: false,
      error: 'AI parsing failed',
      care_plan_id,
    }, { status: 200 }) // 200 because the care plan still exists for manual review
  }

  // ── Create recommended service entries ──────────────────────
  const serviceEntries = parsedServices.map((rec: any) => ({
    org_id,
    contact_id,
    service_type: rec.service_type || 'custom',
    service_date: new Date().toISOString().split('T')[0],
    status: 'recommended',
    recommendation_source: 'neuroreport_ai_parsed',
    recommendation_text: rec.notes || null,
    neuroreport_report_id: report_id || null,
    priority: rec.priority || 'standard',
    notes: [
      rec.notes || '',
      rec.frequency ? `Frequency: ${rec.frequency}` : '',
      rec.duration_weeks ? `Duration: ${rec.duration_weeks} weeks` : '',
    ].filter(Boolean).join('\n'),
    metadata: {
      frequency: rec.frequency,
      duration_weeks: rec.duration_weeks,
      ai_parsed: true,
    },
  }))

  let createdCount = 0

  if (serviceEntries.length > 0) {
    const { data: inserted, error } = await supabase
      .from('ecr_service_entries')
      .insert(serviceEntries)
      .select()

    if (error) {
      console.error('[parse-recommendations] Insert error:', error)
    } else {
      createdCount = inserted?.length || 0
    }
  }

  // ── Update care plan with parsed results ────────────────────
  await supabase
    .from('ecr_care_plans')
    .update({
      parsed_services: parsedServices,
      status: 'pending', // still needs clinician review
    })
    .eq('id', care_plan_id)

  return NextResponse.json({
    success: true,
    care_plan_id,
    services_parsed: parsedServices.length,
    services_created: createdCount,
    parsed: parsedServices,
  })
}
