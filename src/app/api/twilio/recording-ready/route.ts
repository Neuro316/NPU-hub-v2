import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { logActivity, getOrCreateConversation, bumpConversation } from '@/lib/crm-server';
import { toE164 } from '@/lib/phone';
import { validateTwilioSignatureWithToken } from '@/lib/twilio';
import { resolveVoiceWebhookAuth, voiceSignatureUrl } from '@/lib/twilio-voice-signature';

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

  // ── Signature verification gates the ENTIRE handler ──
  // A forged callback would attach arbitrary audio to a client's call history,
  // so verify before any DB access. ENFORCING, not log only: unlike inbound-call
  // this route is new to validation and has no legacy traffic shape to protect,
  // and a rejected callback costs nothing because Twilio retries.
  const signature = request.headers.get('x-twilio-signature') || '';
  const url = voiceSignatureUrl('/api/twilio/recording-ready');
  if (!url || !signature) {
    console.error('recording-ready: missing NEXT_PUBLIC_APP_URL or X-Twilio-Signature; rejecting');
    return new NextResponse('Forbidden', { status: 403 });
  }
  // Wrapped because resolveVoiceWebhookAuth reads org_settings and
  // crm_twilio_numbers and can therefore throw on a database hiccup, and
  // validateTwilioSignatureWithToken can throw on malformed input. Unwrapped,
  // that would surface as an unhandled 500. This route stays FAIL CLOSED either
  // way: a request whose signature could not be checked is rejected with the same
  // 403 as one that failed the check. Twilio retries a failed callback, so the
  // recording is not lost if the error was transient.
  try {
    const { authToken, source } = await resolveVoiceWebhookAuth(params.To, params.From);
    if (!validateTwilioSignatureWithToken(authToken, url, params, signature)) {
      const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '(none)';
      const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
      console.error(
        '[recording-ready] SIGNATURE REJECTED.',
        'reconstructed_url=', url,
        '| twilio_called_host=', `${forwardedProto}://${forwardedHost}${request.nextUrl.pathname}`,
        '| NEXT_PUBLIC_APP_URL=', process.env.NEXT_PUBLIC_APP_URL || '(UNSET)',
        '| token_source=', source
      );
      return new NextResponse('Forbidden', { status: 403 });
    }
  } catch (e: any) {
    console.error('[recording-ready] signature check errored, rejecting:', e?.message ?? String(e));
    return new NextResponse('Forbidden', { status: 403 });
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
    .select('id, org_id, contact_id, to_number, status')
    .eq('external_call_sid', callSid)
    .maybeSingle();

  if (!callLog) {
    // No row for this CallSid. No-op 200 so Twilio doesn't retry indefinitely.
    console.warn('recording-ready: no call_log for CallSid', callSid);
    return NextResponse.json({ ok: true, matched: false });
  }

  // ── Which kind of recording is this? ────────────────────────────────────────
  // Two callbacks now arrive here and they need opposite handling.
  //
  //  <Record> (voicemail)  RecordingSource = 'RecordVerb'. The caller left a
  //                        message. Keep the historical behaviour exactly:
  //                        flip status to 'voicemail' and mark a transcript
  //                        pending, which Twilio's transcribeCallback fills in.
  //
  //  <Dial record=...>     RecordingSource = 'DialVerb' (also 'OutboundAPI' or
  //  (answered call)       'StartCallRecordingAPI' for other origins). The call
  //                        was ANSWERED and recorded. Attach the media only.
  //                        Touching status here would relabel a real conversation
  //                        as a voicemail, and marking a transcript pending would
  //                        strand it forever, because transcription of answered
  //                        calls is deliberately not built yet.
  //
  // Fail safe when RecordingSource is absent: treat it as a voicemail ONLY if
  // the row still looks like one. A row already closed as 'completed' by
  // ring-complete or call-status is an answered call, so the media-only branch
  // is correct for it even without the hint.
  const recordingSource = params.RecordingSource || '';
  const isRecordVerb = recordingSource
    ? recordingSource === 'RecordVerb'
    : !['completed', 'in_progress', 'in-progress'].includes(String(callLog.status || ''));

  const mediaFields = {
    recording_url: `${recordingUrl}.mp3`,
    recording_sid: recordingSid,
    ...(Number.isFinite(durationSec) ? { recording_duration_seconds: durationSec } : {}),
  };

  // Verify by ROW COUNT, not by `error`: an RLS filtered update returns error
  // null and zero rows. This runs as service_role so it should always match one
  // row; a zero here means the row vanished between the select and the update.
  const { count: updated, error: updateErr } = await supabase
    .from('call_logs')
    .update(
      isRecordVerb
        ? {
            ...mediaFields,
            status: 'voicemail',
            transcription_status: 'pending',
            // Voicemail kept writing the message length to duration_seconds, and
            // the timeline reads that for its "0:08" label. Preserved.
            ...(Number.isFinite(durationSec) ? { duration_seconds: durationSec } : {}),
          }
        : mediaFields,
      { count: 'exact' }
    )
    .eq('id', callLog.id);

  if (updateErr) {
    console.error('recording-ready: update failed:', updateErr.message);
  } else if (!updated) {
    console.warn('recording-ready: update matched 0 rows for call_log', callLog.id);
  }

  console.log('recording-ready:', JSON.stringify({
    call_log_id: callLog.id,
    recording_source: recordingSource || '(absent)',
    branch: isRecordVerb ? 'voicemail' : 'answered-call-media-only',
    rows_updated: updated ?? null,
  }));

  // An answered call is not a voicemail: no status change, no transcription
  // pending, no voicemail preview on the thread, no voicemail_received activity.
  // The thread is already floated by inbound-call or voice/token, and
  // conversations.last_activity_at is maintained by migration 209's triggers.
  if (!isRecordVerb) {
    return NextResponse.json({ success: true, branch: 'answered_call' });
  }

  // Surface the voicemail in the Conversations pane. inbound-call already
  // find-or-created this conversation and previewed it as "Incoming call"; now
  // that the call actually ended in a voicemail, re-bump so the list shows what
  // it really was and floats it back to the top. getOrCreateConversation is
  // idempotent, so this also self-heals a call row whose conversation was never
  // created (e.g. one that landed before this fix shipped).
  if (callLog.org_id && callLog.contact_id) {
    try {
      // The line is the number that was dialled, carried on the call row, so a
      // voicemail bump keeps the thread on the line the caller actually used.
      const lineE164 = toE164(callLog.to_number || '') || null;
      const conversation = await getOrCreateConversation(
        supabase, callLog.contact_id, 'voice', callLog.org_id, lineE164
      );
      await bumpConversation(supabase, conversation.id, {
        preview: '\u{1F4E7} Voicemail',
        direction: 'inbound',
        // Not incremented: inbound-call already counted this call as unread.
        // Bumping again would double-count one interaction.
        incrementUnread: false,
        lineE164,
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
