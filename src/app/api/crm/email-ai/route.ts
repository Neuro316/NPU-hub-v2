import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase'
import { userInOrg } from '@/lib/api-guard'
import { readOrgSetting } from '@/lib/org-vault'

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { org_id, instruction, current_html } = await request.json()
  if (!instruction) return NextResponse.json({ error: 'No instruction' }, { status: 400 })

  // AI key: Vault, service role, only for staff of that org (2026-11-08)
  const admin = createAdminSupabase()
  const aiConfig = (await userInOrg(admin, user.id, org_id)) ? await readOrgSetting<any>(admin, org_id, 'crm_ai').catch(() => null) : null
  const apiKey = aiConfig?.api_key || process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI not configured. Add API key in CRM Settings > AI.' }, { status: 400 })

  const prompt = `You generate EMAIL-SAFE HTML for a marketing/CRM email body. The HTML must render correctly in Gmail and Outlook, so:
- Use ONLY inline styles (style="..."), never <style> blocks or CSS classes.
- Use web-safe fonts and simple layout. Tables for layout are fine.
- Buttons are styled <a> tags (inline-block, padding, background color, border-radius, color, text-decoration:none).
- Links are <a> tags with an href and an inline color.
- Images are <img> with a src URL and inline max-width:100%;height:auto.
- For a YouTube or Vimeo video, output a clickable thumbnail: an <a> linking to the video wrapping an <img> of the video's public thumbnail (YouTube: https://img.youtube.com/vi/VIDEOID/maxresdefault.jpg ; Vimeo: https://vumbnail.com/VIDEOID.jpg) with a play triangle overlay.
- Do NOT include <html>, <head>, <body>, or DOCTYPE — only the inner body HTML.
- Do NOT use em dashes.
- Support merge tags {{first_name}} and {{last_name}} if the user references personalization.

Current email body HTML (may be empty):
${current_html || '(empty)'}

User instruction: ${instruction}

Return ONLY a JSON object: {"html": "<the full new email body HTML>"}. No markdown, no code fences.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
    })
    const data = await res.json()
    if (!res.ok) {
      console.error('Anthropic API error:', res.status, data)
      return NextResponse.json({ error: `AI API error ${res.status}: ${data?.error?.message || JSON.stringify(data)}` }, { status: 500 })
    }
    const text = data.content?.[0]?.text || ''
    if (!text) {
      console.error('Anthropic empty response:', data)
      return NextResponse.json({ error: 'AI returned an empty response' }, { status: 500 })
    }
    const clean = text.replace(/```json|```/g, '').trim()
    let parsed: any
    try { parsed = JSON.parse(clean) } catch { return NextResponse.json({ error: 'AI returned non-JSON: ' + clean.slice(0, 200) }, { status: 500 }) }
    return NextResponse.json({ html: parsed.html || '' })
  } catch (e: any) {
    console.error('email-ai error:', e)
    return NextResponse.json({ error: `AI failed: ${e.message}` }, { status: 500 })
  }
}
