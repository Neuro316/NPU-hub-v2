import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const maxDuration = 30

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const PLATFORM_KNOWLEDGE = `You are the NPU Hub help assistant. NPU Hub is a business operations platform for Neuro Progeny (nervous system training) and Sensorium Neuro Wellness (multi-location qEEG/HRV monitoring).

PLATFORM MODULES:
- Dashboard (/) — KPIs: contacts, sessions, pipeline value, tasks, campaigns
- CRM (/crm) — Contact management with 23 configurable columns, pipelines, import/export
  - Contacts (/crm/contacts) — Full contact list with search, tags, pipeline stages, slideout detail panel
  - Pipelines (/crm/pipelines) — Visual pipeline boards for deal tracking
  - Conversations (/crm/conversations) — Unified SMS/call/email inbox. "New Conversation" button to start messaging a contact
  - Sequences (/crm/sequences) — Automated multi-step SMS/email drip campaigns. Create sequence → add steps → enroll contacts
  - Client Tasks (/crm/tasks) — Contact-linked follow-ups and action items
  - Network Intel (/crm/network) — AI-powered relationship mapping
  - Import (/crm/import) — CSV upload with field mapping and duplicate detection
  - CRM Settings (/crm/settings) — Twilio, email, AI, pipeline, tags, compliance configuration
- Campaigns (/campaigns) — Marketing campaign builder with flow steps
- Analytics (/analytics) — Dashboard with charts for contacts, calls, emails, revenue
- Project Board (/tasks) — Internal team kanban board with customizable columns, drag-and-drop
- Journey Builder (/journeys) — Multi-phase customer lifecycle journeys
- Social Media (/social) — Content creation with canvas designer, brand guide integration
- Calendar (/calendar) — Scheduling with Google Calendar integration
- EHR Sessions (/ehr/sessions) — Clinical session notes with 9 modality protocols, voice dictation
- EHR Forms (/ehr/forms) — Form builder with AI generation, WYSIWYG editor
- EHR Accounting (/ehr/accounting) — Invoicing with insurance split, waterfall payments
- Settings (/settings) — Brand, integrations, appearance customization
- Team (/team) — Team member management with role-based permissions

COMMON WORKFLOWS:
1. Add a contact: CRM → Contacts → "+ Add Contact" button (top right)
2. Send SMS: CRM → Conversations → "+" button → search contact → type message → Send
3. Create a sequence: CRM → Sequences → "New Sequence" → add steps → toggle Active → Enroll Contact
4. Track a deal: CRM → Pipelines → drag contact card between stages
5. Create a task: Project Board → click column → "Add Task" or click "+" in column header
6. Create a session note: EHR → Sessions → "New Session" → select client → fill modality protocols
7. Send a campaign: Campaigns → "New Campaign" → build steps → launch

TIPS:
- Use the org switcher (top of sidebar) to switch between Neuro Progeny and Sensorium
- The notification bell (top of sidebar) shows recent CRM activity (admin only)
- Activity Log (Admin section) shows all platform events with team member filtering
- Use the search bar on any list page to filter results
- Most pages support keyboard shortcuts: Escape to close modals

WHEN ANSWERING:
- Be concise and specific — give the exact navigation path
- If you don't know, say so and suggest checking Settings or asking an admin
- If the question reveals a missing feature, acknowledge it honestly
- Always provide the page path in parentheses so users can navigate directly`

// POST /api/ai/help-bot — Answer user questions about the platform
export async function POST(request: NextRequest) {
  const supabase = createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ANTHROPIC_API_KEY) return NextResponse.json({ error: 'AI not configured' }, { status: 500 })

  const { question, page_context, org_id, history } = await request.json()

  if (!question?.trim()) return NextResponse.json({ error: 'No question provided' }, { status: 400 })

  // Build conversation history for multi-turn
  const messages = [
    ...(history || []).slice(-6), // Last 3 exchanges
    { role: 'user' as const, content: `[User is currently on page: ${page_context || 'unknown'}]\n\n${question}` },
  ]

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
        max_tokens: 1000,
        system: PLATFORM_KNOWLEDGE,
        messages,
      }),
    })

    const aiResult = await response.json()
    const answer = aiResult.content?.[0]?.text || 'Sorry, I could not generate an answer.'

    // Auto-categorize the question
    const q = question.toLowerCase()
    let category = 'general'
    if (q.includes('how') || q.includes('where') || q.includes('how do i')) category = 'how_to'
    else if (q.includes('error') || q.includes('broken') || q.includes('not working') || q.includes('bug')) category = 'bug'
    else if (q.includes('find') || q.includes('navigate') || q.includes('where is')) category = 'navigation'
    else if (q.includes('connect') || q.includes('integrate') || q.includes('setup')) category = 'integration'
    else if (q.includes('what is') || q.includes('what does') || q.includes('explain')) category = 'feature'

    // Log to help_requests table
    await supabase.from('help_requests').insert({
      org_id,
      user_id: user.id,
      question: question.trim(),
      answer,
      page_context,
      category,
      resolved: true,
    })

    return NextResponse.json({ answer, category })
  } catch (err: any) {
    console.error('Help bot error:', err)
    return NextResponse.json({ error: 'Failed to get answer' }, { status: 500 })
  }
}
