// src/app/api/meetings/create-gdoc/route.ts
// Creates a Google Doc from a meeting agenda or blank template
// and returns the shareable Google Doc URL

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminSupabase } from '@/lib/supabase'
import { createGoogleDoc } from '@/lib/google-drive'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const BRAND_BLUE = '#386797'
const BRAND_TEAL = '#2A9D8F'

async function getRefreshToken(orgId: string): Promise<string | null> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data } = await supabase
    .from('org_settings')
    .select('setting_value')
    .eq('org_id', orgId)
    .eq('setting_key', 'google_drive')
    .single()
  return data?.setting_value?.refresh_token || null
}

function agendaToHtml(title: string, dateStr: string, duration: number, sections: any[]): string {
  const totalMins = sections.reduce((s: number, x: any) => s + (x.duration_min || 0), 0)

  const sectionRows = sections.map((s: any) => {
    const prompts = [...(s.prompts || []), ...(s.talking_points || [])]
    const promptsHtml = prompts.length > 0
      ? `<ul style="margin:4px 0 0 0;padding-left:18px;">
          ${prompts.map((p: string) => `<li style="color:#6B7280;font-size:11pt;margin:2px 0;">${p}</li>`).join('')}
         </ul>`
      : ''
    return `
      <tr>
        <td style="padding:8px 12px;border:1px solid #CCCCCC;background:#EEF4FA;vertical-align:top;">
          <strong style="color:#1A1A2E;font-size:11pt;">${s.section}</strong>
          ${promptsHtml}
        </td>
        <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center;vertical-align:middle;color:${BRAND_BLUE};font-weight:bold;white-space:nowrap;">
          ${s.duration_min} min
        </td>
        <td style="padding:8px 12px;border:1px solid #CCCCCC;color:#9CA3AF;font-size:10pt;">
          ${s.notes || '&nbsp;'}
        </td>
      </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#1A1A2E;">

  <div style="border-bottom:3px solid ${BRAND_BLUE};padding-bottom:12px;margin-bottom:20px;">
    <h1 style="color:${BRAND_BLUE};font-size:22pt;margin:0 0 4px 0;">${title}</h1>
    <p style="color:#6B7280;font-size:11pt;margin:0;">${dateStr} &nbsp;·&nbsp; ${duration} minutes &nbsp;·&nbsp; ${sections.length} sections &nbsp;·&nbsp; ${totalMins} min planned</p>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:32px;">
    <thead>
      <tr style="background:${BRAND_BLUE};">
        <th style="padding:10px 12px;color:white;text-align:left;border:1px solid ${BRAND_BLUE};width:55%;">Agenda Item / Discussion Prompts</th>
        <th style="padding:10px 12px;color:white;text-align:center;border:1px solid ${BRAND_BLUE};width:15%;">Time</th>
        <th style="padding:10px 12px;color:white;text-align:left;border:1px solid ${BRAND_BLUE};width:30%;">Notes</th>
      </tr>
    </thead>
    <tbody>
      ${sectionRows}
      <tr style="background:${BRAND_BLUE};">
        <td style="padding:8px 12px;color:white;font-weight:bold;text-align:right;border:1px solid ${BRAND_BLUE};">TOTAL</td>
        <td style="padding:8px 12px;color:white;font-weight:bold;text-align:center;border:1px solid ${BRAND_BLUE};">${totalMins} min</td>
        <td style="border:1px solid ${BRAND_BLUE};"></td>
      </tr>
    </tbody>
  </table>

  <h2 style="color:${BRAND_TEAL};border-bottom:2px solid ${BRAND_TEAL};padding-bottom:6px;font-size:15pt;">Meeting Notes</h2>
  <div style="min-height:180px;"></div>

  <h2 style="color:${BRAND_BLUE};border-bottom:2px solid ${BRAND_BLUE};padding-bottom:6px;font-size:15pt;">Action Items</h2>
  <table style="width:100%;border-collapse:collapse;">
    <thead>
      <tr style="background:${BRAND_BLUE};">
        <th style="padding:8px 12px;color:white;text-align:left;border:1px solid ${BRAND_BLUE};width:55%;">Task / Description</th>
        <th style="padding:8px 12px;color:white;text-align:left;border:1px solid ${BRAND_BLUE};width:25%;">Owner</th>
        <th style="padding:8px 12px;color:white;text-align:left;border:1px solid ${BRAND_BLUE};width:20%;">Due Date</th>
      </tr>
    </thead>
    <tbody>
      ${[...Array(6)].map(() => `
        <tr>
          <td style="padding:10px 12px;border:1px solid #CCCCCC;">&nbsp;</td>
          <td style="padding:10px 12px;border:1px solid #CCCCCC;">&nbsp;</td>
          <td style="padding:10px 12px;border:1px solid #CCCCCC;">&nbsp;</td>
        </tr>`).join('')}
    </tbody>
  </table>

  <p style="color:#9CA3AF;font-size:9pt;margin-top:32px;border-top:1px solid #E5E7EB;padding-top:8px;">
    Generated by NPU Hub &nbsp;·&nbsp; Neuro Progeny &nbsp;·&nbsp; ${new Date().toLocaleDateString()}
  </p>
</body>
</html>`
}

const TEMPLATE_SECTIONS: Record<string, any[]> = {
  level_10: [
    { section: 'Segue', duration_min: 5, notes: '', prompts: ['Share one personal and one professional good news.'] },
    { section: 'Scorecard Review', duration_min: 5, notes: '', prompts: ['Which metrics are off track?', 'Who owns the fix?'] },
    { section: 'Rock Review', duration_min: 5, notes: '', prompts: ['Is each rock on track or off track?', 'What needs to change?'] },
    { section: 'To-Do Review', duration_min: 5, notes: '', prompts: ['What was completed?', 'What carried over and why?'] },
    { section: 'IDS (Identify, Discuss, Solve)', duration_min: 60, notes: '', prompts: ['What is the real issue?', 'What are the possible solutions?', 'Who owns the to-do?'] },
    { section: 'Conclude', duration_min: 5, notes: '', prompts: ['Key takeaways?', 'Rate this meeting 1-10.'] },
  ],
  one_on_one: [
    { section: 'Check-in', duration_min: 5, notes: '', prompts: ['How are you doing personally?', 'Anything on your mind?'] },
    { section: 'Updates & Wins', duration_min: 10, notes: '', prompts: ['What wins happened this week?', 'What progress was made?'] },
    { section: 'Challenges & Support', duration_min: 10, notes: '', prompts: ['Where are you stuck?', 'What support do you need?'] },
    { section: 'Action Items', duration_min: 5, notes: '', prompts: ['What are the 3 most important things for next week?'] },
  ],
  standup: [
    { section: 'Yesterday', duration_min: 5, notes: '', prompts: ['What did you accomplish?'] },
    { section: 'Today', duration_min: 5, notes: '', prompts: ['What will you work on today?'] },
    { section: 'Blockers', duration_min: 5, notes: '', prompts: ['Is anything blocking your progress?'] },
  ],
  quarterly: [
    { section: 'Review Previous Quarter', duration_min: 60, notes: '', prompts: ['What worked?', "What didn't?", 'What did we learn?'] },
    { section: 'SWOT Analysis', duration_min: 60, notes: '', prompts: ['Strengths?', 'Weaknesses?', 'Opportunities?', 'Threats?'] },
    { section: 'Set New Rocks', duration_min: 120, notes: '', prompts: ['What are the 3-7 most important things for next quarter?'] },
    { section: 'Team Health Check', duration_min: 30, notes: '', prompts: ['Rate team health 1-10.', 'What would make it a 10?'] },
  ],
  custom: [
    { section: 'Opening', duration_min: 5, notes: '', prompts: ['How is everyone doing?'] },
    { section: 'Main Topic', duration_min: 20, notes: '', prompts: ['What is the agenda?', 'What decisions need to be made?'] },
    { section: 'Action Items & Close', duration_min: 5, notes: '', prompts: ['Who owns what?', 'What are next steps?'] },
  ],
}

export async function POST(req: NextRequest) {
  try {
    const { org_id, meeting_id, use_ai, ai_description } = await req.json()
    if (!org_id) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

    const refreshToken = await getRefreshToken(org_id)
    if (!refreshToken) {
      return NextResponse.json({
        error: 'Google Drive not connected. Go to Settings → Integrations to connect your Drive.',
        needs_auth: true,
      }, { status: 403 })
    }

    const sb = createAdminSupabase()
    let title = 'Meeting Agenda Template'
    let dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    let duration = 60
    let sections: any[] = TEMPLATE_SECTIONS.custom

    if (meeting_id) {
      const { data: m } = await sb.from('meetings').select('*').eq('id', meeting_id).single()
      if (m) {
        title = m.title
        dateStr = m.scheduled_at
          ? new Date(m.scheduled_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
          : dateStr
        duration = m.duration_minutes || 60

        if (use_ai && ai_description) {
          // AI builds the agenda
          const anthropic = new Anthropic()
          const templateHints: Record<string, string> = {
            level_10: 'Level 10 (EOS L10) — Segue, Scorecard, Rock Review, To-Do Review, IDS, Conclude',
            one_on_one: 'One-on-One — Check-in, Updates & Wins, Challenges & Support, Action Items',
            standup: 'Standup — Yesterday, Today, Blockers',
            quarterly: 'Quarterly Planning — Review Previous Quarter, SWOT, Set Rocks, Team Health',
            custom: 'Custom meeting',
          }
          const msg = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2048,
            system: `You are a meeting facilitation expert. Build a structured agenda as a JSON array. Each item must have: section (string), duration_min (number), notes (empty string), prompts (array of 2-4 specific discussion questions), talking_points (array of 2-3 key points). Total duration_min must sum to exactly ${duration} minutes. Return ONLY valid JSON array, no markdown.`,
            messages: [{
              role: 'user',
              content: `Meeting: "${title}"\nTemplate: ${templateHints[m.template] || 'Custom'}\nDuration: ${duration} minutes\nContext: ${ai_description}`,
            }],
          })
          const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
          const clean = text.replace(/```json|```/g, '').trim()
          sections = JSON.parse(clean)

          // Save AI agenda back to meeting
          await sb.from('meetings').update({
            agenda: sections,
            updated_at: new Date().toISOString(),
          }).eq('id', meeting_id)
        } else if (m.agenda?.length > 0) {
          sections = m.agenda
        } else {
          sections = TEMPLATE_SECTIONS[m.template as string] || TEMPLATE_SECTIONS.custom
        }
      }
    }

    const html = agendaToHtml(title, dateStr, duration, sections)
    const result = await createGoogleDoc(refreshToken, title, html)

    return NextResponse.json({
      success: true,
      url: result.webViewLink,
      doc_id: result.id,
      sections_saved: use_ai ? sections.length : 0,
    })
  } catch (e: any) {
    console.error('create-gdoc error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
