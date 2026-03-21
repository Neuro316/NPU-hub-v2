// src/app/api/webhooks/read-ai/route.ts
// Receives Read AI webhook after a meeting ends.
// Matches the meeting by title + date, saves transcript, summary,
// action items and participants into the meeting's read_ai_data field.
//
// Setup in Read AI:
//   https://app.read.ai/analytics/integrations/webhooks
//   URL: https://hub.neuroprogeny.com/api/webhooks/read-ai
//   Add READAI_WEBHOOK_SECRET to Vercel env vars

import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { createAdminSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Verify Read AI HMAC-SHA256 signature
function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const computed = createHmac('sha256', secret).update(rawBody).digest('hex')
  // Timing-safe comparison
  if (computed.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-read-signature') || ''
  const secret = process.env.READAI_WEBHOOK_SECRET || ''

  // Verify signature if secret is configured
  if (secret && signature) {
    if (!verifySignature(rawBody, signature, secret)) {
      console.error('Read AI webhook: invalid signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    session_id,
    request_id,
    trigger,
    title,
    start_time,
    end_time,
    participants,
    owner,
    summary,
    action_items,
    key_topics,
    chapter_summaries,
    transcript,
    video_url,
    platform,
  } = payload

  if (!title || !start_time) {
    return NextResponse.json({ error: 'Missing title or start_time' }, { status: 400 })
  }

  const sb = createAdminSupabase()

  // ── Find matching meeting ──────────────────────────────────────────
  // Match by title (case-insensitive) within ±24h of start_time
  const startWindow = new Date(new Date(start_time).getTime() - 24 * 60 * 60 * 1000).toISOString()
  const endWindow   = new Date(new Date(start_time).getTime() + 24 * 60 * 60 * 1000).toISOString()

  const { data: meetings } = await sb
    .from('meetings')
    .select('id, title, scheduled_at, read_ai_data')
    .gte('scheduled_at', startWindow)
    .lte('scheduled_at', endWindow)

  let targetMeeting = null

  if (meetings?.length) {
    // Exact title match first
    targetMeeting = meetings.find(
      m => m.title.toLowerCase().trim() === title.toLowerCase().trim()
    )
    // Fuzzy match — title contains or is contained
    if (!targetMeeting) {
      targetMeeting = meetings.find(
        m => m.title.toLowerCase().includes(title.toLowerCase().substring(0, 20)) ||
             title.toLowerCase().includes(m.title.toLowerCase().substring(0, 20))
      )
    }
    // Last resort — first meeting in window
    if (!targetMeeting) targetMeeting = meetings[0]
  }

  // ── Normalize transcript ───────────────────────────────────────────
  let transcriptText = ''
  if (transcript && Array.isArray(transcript)) {
    // Read AI format: [{speaker_name, words: [{text, start_time, end_time}]}]
    transcriptText = transcript
      .map((seg: any) => {
        const speaker = seg.speaker_name || seg.name || 'Speaker'
        const text = Array.isArray(seg.words)
          ? seg.words.map((w: any) => w.text || w.word || '').join(' ')
          : (seg.text || seg.content || '')
        return `${speaker}: ${text}`
      })
      .join('\n')
  } else if (typeof transcript === 'string') {
    transcriptText = transcript
  }

  // ── Normalize action items ─────────────────────────────────────────
  const normalizedActions = (action_items || []).map((a: any) => ({
    description: a.text || a.description || a.action || '',
    assignee: a.assignee || a.owner || null,
  })).filter((a: any) => a.description)

  // ── Normalize topics ───────────────────────────────────────────────
  const normalizedTopics = (key_topics || []).map((t: any) =>
    typeof t === 'string' ? t : (t.topic || t.name || t.title || '')
  ).filter(Boolean)

  // ── Build read_ai_data ─────────────────────────────────────────────
  const readAiData = {
    session_id,
    request_id,
    trigger,
    source: 'read_ai_webhook',
    platform: platform || null,
    original_filename: `${title} — Read AI`,
    summary: summary || null,
    transcript: transcriptText || null,
    action_items: normalizedActions,
    key_topics: normalizedTopics,
    chapter_summaries: chapter_summaries || [],
    attendees: (participants || []).map((p: any) => ({
      name: p.name,
      email: p.email || null,
    })),
    owner: owner ? { name: owner.name, email: owner.email } : null,
    video_url: video_url || null,
    start_time,
    end_time,
    uploaded_at: new Date().toISOString(),
    auto_imported: true,
  }

  if (targetMeeting) {
    // Merge with any existing data (don't overwrite manual video uploads)
    const existing = targetMeeting.read_ai_data || {}
    const merged = {
      ...existing,
      ...readAiData,
      // Preserve manually uploaded video if webhook doesn't have one
      video_url: readAiData.video_url || existing.video_url || null,
      video_storage_path: existing.video_storage_path || null,
      video_filename: existing.video_filename || null,
    }

    await sb.from('meetings').update({
      read_ai_data: merged,
      updated_at: new Date().toISOString(),
    }).eq('id', targetMeeting.id)

    console.log(`Read AI webhook: matched meeting "${targetMeeting.title}" (${targetMeeting.id})`)
    return NextResponse.json({ success: true, matched_meeting_id: targetMeeting.id })
  } else {
    // No match — store as an unmatched record for manual review
    const { data: unmatched } = await sb
      .from('read_ai_unmatched')
      .insert({
        session_id,
        title,
        start_time,
        payload: readAiData,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    console.warn(`Read AI webhook: no matching meeting found for "${title}" at ${start_time}`)
    return NextResponse.json({
      success: true,
      matched: false,
      message: 'No meeting found — stored for manual review',
      unmatched_id: unmatched?.id,
    })
  }
}
