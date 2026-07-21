import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { logActivity, getOrCreateConversation, bumpConversation } from '@/lib/crm-server';

// Twilio recording-ready callback (recordingStatusCallback on <Record>).
// Stores the voicemail recording + duration on the call_logs row keyed by CallSid,
// flips status -> 'voicemail', and marks transcription pending. The transcript
// itself arrives SEPARATELY via Twilio's built-in transcription callback
// (/api/twilio/transcription).
//
// We deliberately do NOT transcribe here anymore. The old code handed Deepgram the
// auth-protected Twilio recording URL, which Deepgram can't fetch (401) — that was
// the transcription_status='failed'. Transcription now lives behind one seam
// (the /transcription route). To swap back to Deepgram later: download the
// recording with the org's Twilio creds (as /api/comms/recording does) and send the
// BYTES to Deepgram there — never hand it a URL it can't authenticate.

export async function POST(request: NextRequest) {
  let params: Record<string, string> = {};
  try {
    const text = await request.text();
    const searchParams = new URLSearchParams(text);
    searchParams.forEach((val, key) => { params[key] = val; });
  } catch (e) {
    console.error('recording-ready parse error:', e);
  }

  const supabase = createAdminSupabase();
  const recordingUrl = params.RecordingUrl;
  const recordingSid = params.RecordingSid;
  const callSid = params.CallSid;
  const durationSec = parseInt(params.RecordingDuration || '', 10);

  if (!recordingUrl || !callSid) {
    return NextResponse.json({ error: 'Missing RecordingUrl or CallSid' }, { status: 400 });
  }

  // Attribute by CallSid — exact. org_id is read from the row, so unknown-caller
  // (null contact) voicemails still work.
  const { data: callLog } = await supabase
    .from('call_logs')
    .select('id, org_id, contact_id')
    .eq('external_call_sid', callSid)
    .maybeSingle();

  if (!callLog) {
    // No row for this CallSid. No-op 200 so Twilio doesn't retry indefinitely.
    console.warn('recording-ready: no call_log for CallSid', callSid);
    return NextResponse.json({ ok: true, matched: false });
  }

  // Voicemail: store recording + duration, flip status, mark transcription pending.
  // Twilio's transcribeCallback (/api/twilio/transcription) fills in the transcript.
  await supabase
    .from('call_logs')
    .update({
      recording_url: `${recordingUrl}.mp3`,
      recording_sid: recordingSid,
      status: 'voicemail',
      transcription_status: 'pending',
      ...(Number.isFinite(durationSec) ? { duration_seconds: durationSec } : {}),
    })
    .eq('id', callLog.id);

  // Surface the voicemail in the Conversations pane. inbound-call already
  // find-or-created this conversation and previewed it as "Incoming call"; now
  // that the call actually ended in a voicemail, re-bump so the list shows what
  // it really was and floats it back to the top. getOrCreateConversation is
  // idempotent, so this also self-heals a call row whose conversation was never
  // created (e.g. one that landed before this fix shipped).
  if (callLog.org_id && callLog.contact_id) {
    try {
      const conversation = await getOrCreateConversation(
        supabase, callLog.contact_id, 'voice', callLog.org_id
      );
      await bumpConversation(supabase, conversation.id, {
        preview: '\u{1F4E7} Voicemail',
        direction: 'inbound',
        // Not incremented: inbound-call already counted this call as unread.
        // Bumping again would double-count one interaction.
        incrementUnread: false,
      });
    } catch (e) {
      console.warn('voicemail conversation bump skipped:', e);
    }
  }

  // Lightweight timeline entry (only when we know the contact).
  if (callLog.org_id && callLog.contact_id) {
    try {
      await logActivity(supabase, {
        contact_id: callLog.contact_id,
        org_id: callLog.org_id,
        event_type: 'voicemail_received',
        event_data: {
          recording_sid: recordingSid,
          duration_seconds: Number.isFinite(durationSec) ? durationSec : null,
        },
        ref_table: 'call_logs',
        ref_id: callLog.id,
      });
    } catch (e) {
      console.warn('voicemail activity log skipped:', e);
    }
  }

  return NextResponse.json({ success: true });
}
