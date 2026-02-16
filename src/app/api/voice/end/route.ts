import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { logActivity, updateLastContacted } from '@/lib/crm-server'

// ═══════════════════════════════════════════════════════════════
// Voice Call End — Log completed call + trigger counter increment
// Called when browser dialer hangs up
// ═══════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const {
      contact_id,
      direction = 'outbound',
      duration_seconds = 0,
      recording_url,
      notes,
      twilio_call_sid,
    } = body

    if (!contact_id) return NextResponse.json({ error: 'contact_id required' }, { status: 400 })

    // Get contact for org_id
    const { data: contact } = await supabase
      .from('contacts').select('id, org_id, first_name, last_name').eq('id', contact_id).single()
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

    // Insert into call_logs (trigger auto-increments counters on contacts)
    const { data: callLog, error: logErr } = await supabase
      .from('call_logs')
      .insert({
        contact_id,
        direction,
        status: 'completed',
        duration_seconds,
        recording_url: recording_url || null,
        called_by: user.id,
        started_at: new Date(Date.now() - (duration_seconds * 1000)).toISOString(),
        ended_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (logErr) {
      console.error('Call log insert failed:', logErr)
      return NextResponse.json({ error: 'Failed to log call' }, { status: 500 })
    }

    // Add note if provided
    if (notes?.trim()) {
      await supabase.from('contact_notes').insert({
        contact_id,
        org_id: contact.org_id,
        author_id: user.id,
        body: notes.trim(),
        type: 'call_note',
        is_pinned: false,
      }).catch(e => console.warn('Note insert skipped:', e))
    }

    // Activity log
    try {
      await logActivity(supabase, {
        contact_id,
        org_id: contact.org_id,
        event_type: 'call_completed',
        event_data: {
          direction,
          duration_seconds,
          has_recording: !!recording_url,
          twilio_sid: twilio_call_sid,
        },
        ref_table: 'call_logs',
        ref_id: callLog.id,
        actor_id: user.id,
      })
      await updateLastContacted(supabase, contact_id)
    } catch (e) { console.warn('Activity log skipped:', e) }

    // Queue AI transcription if long enough call with recording
    if (duration_seconds > 30 && recording_url) {
      try {
        await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || ''}/api/transcript`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ call_log_id: callLog.id, recording_url }),
        })
      } catch (e) { console.warn('Transcription queue skipped:', e) }
    }

    return NextResponse.json({
      success: true,
      call_log_id: callLog.id,
    })
  } catch (e: any) {
    console.error('Voice end error:', e)
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 })
  }
}
