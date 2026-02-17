import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { contact_id, org_id, context, pipeline_stage, attached_resources } = await request.json()

  // Get contact details
  const { data: contact } = await supabase
    .from('contacts').select('*').eq('id', contact_id).single()
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  // Get org info
  const { data: org } = await supabase
    .from('organizations').select('name').eq('id', org_id).single()

  // Get email config for sender info
  const { data: emailConfig } = await supabase
    .from('org_email_config').select('*').eq('org_id', org_id).maybeSingle()

  // Get recent activity for context
  const { data: recentActivity } = await supabase
    .from('crm_activity_log')
    .select('event_type, event_data, created_at')
    .eq('contact_id', contact_id)
    .order('created_at', { ascending: false })
    .limit(5)

  // Get AI config
  const { data: aiConfig } = await supabase
    .from('org_settings')
    .select('setting_value')
    .eq('org_id', org_id)
    .eq('setting_key', 'crm_ai')
    .maybeSingle()

  const apiKey = aiConfig?.setting_value?.api_key || process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'AI not configured. Add API key in CRM Settings > AI.' }, { status: 400 })
  }

  const senderName = emailConfig?.sending_name || 'Team'
  const orgName = org?.name || 'our organization'

  const activitySummary = (recentActivity || []).map(a =>
    `${a.event_type}: ${JSON.stringify(a.event_data || {}).slice(0, 100)} (${new Date(a.created_at).toLocaleDateString()})`
  ).join('\n')

  const prompt = `You are writing a professional, warm email on behalf of ${senderName} at ${orgName}.

Recipient:
- Name: ${contact.first_name} ${contact.last_name}
- Email: ${contact.email}
- Pipeline Stage: ${pipeline_stage || contact.pipeline_stage || 'Unknown'}
- Tags: ${(contact.tags || []).join(', ') || 'None'}

Recent Activity:
${activitySummary || 'No recent activity'}

${attached_resources?.length ? `Resources to reference/attach:\n${attached_resources.join('\n')}` : ''}

${context ? `Specific instructions: ${context}` : 'Write an appropriate follow-up email based on their pipeline stage and recent activity.'}

Write a professional but warm email. Use their first name. Keep it concise (3-5 short paragraphs max). Do NOT use em dashes. Do NOT include the subject in the body.

Questions should orient forward toward emerging possibilities, not backward into past failures.

Return ONLY a JSON object with:
{
  "subject": "Email subject line",
  "body_html": "<p>HTML formatted email body</p>"
}

No markdown, no code blocks, just the JSON object.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await res.json()
    const text = data.content?.[0]?.text || ''

    // Parse JSON from response
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)

    return NextResponse.json({
      subject: parsed.subject || '',
      body_html: parsed.body_html || '',
    })
  } catch (e: any) {
    console.error('AI draft error:', e)
    return NextResponse.json({ error: `AI draft failed: ${e.message}` }, { status: 500 })
  }
}
