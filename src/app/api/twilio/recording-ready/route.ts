import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { transcribeRecording } from '@/lib/deepgram';
import { generateCallSummary, analyzeSentiment, extractTasks } from '@/lib/crm-ai';
import { logActivity } from '@/lib/crm-server';

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

  if (!recordingUrl || !callSid) {
    return NextResponse.json({ error: 'Missing RecordingUrl or CallSid' }, { status: 400 });
  }

  // Attribute by CallSid — exact, not the old "most recent completed" heuristic
  // (which mis-attributed and, via contacts!inner, dropped unknown-caller rows).
  // org_id is read from the call row itself, so null-contact voicemails still work.
  const { data: callLog } = await supabase
    .from('call_logs')
    .select('id, org_id, contact_id')
    .eq('external_call_sid', callSid)
    .maybeSingle();

  if (!callLog) {
    // No row for this CallSid (e.g. a flow that didn't pre-insert one). No-op 200
    // so Twilio doesn't retry indefinitely.
    console.warn('recording-ready: no call_log for CallSid', callSid);
    return NextResponse.json({ ok: true, matched: false });
  }

  // This recording is a voicemail: store URL + SID, flip status, mark transcription pending.
  await supabase
    .from('call_logs')
    .update({
      recording_url: `${recordingUrl}.mp3`,
      recording_sid: recordingSid,
      status: 'voicemail',
      transcription_status: 'pending',
    })
    .eq('id', callLog.id);

  const orgId = callLog.org_id;

  // Process asynchronously (in production, use a queue)
  // For now, process inline
  try {
    // 1. Transcribe
    const transcription = await transcribeRecording(`${recordingUrl}.mp3`);

    // 2. AI Summary
    const aiSummary = transcription ? await generateCallSummary(transcription, orgId) : null;

    // 3. Sentiment
    const sentiment = transcription ? await analyzeSentiment(transcription, orgId) : null;

    // 4. Update call log. Column is `transcript` (NOT `transcription` — the old
    //    code wrote a nonexistent column, so this update always errored).
    await supabase
      .from('call_logs')
      .update({
        transcript: transcription,
        ai_summary: aiSummary,
        sentiment,
        transcription_status: transcription ? 'completed' : 'failed',
      })
      .eq('id', callLog.id);

    // 5. Extract tasks (store for review — don't auto-create). Needs a contact to
    //    attach to; unknown-caller voicemails (contact_id null) skip this.
    if (transcription && orgId && callLog.contact_id) {
      const tasks = await extractTasks(transcription, orgId);
      if (tasks.length > 0) {
        await logActivity(supabase, {
          contact_id: callLog.contact_id,
          org_id: orgId,
          event_type: 'ai_tasks_extracted',
          event_data: { tasks, source_call_log_id: callLog.id },
          ref_table: 'call_logs',
          ref_id: callLog.id,
        });
      }
    }

    // 6. Log activity (only when we know the contact)
    if (orgId && callLog.contact_id) {
      await logActivity(supabase, {
        contact_id: callLog.contact_id,
        org_id: orgId,
        event_type: 'call_transcribed',
        event_data: {
          has_transcription: !!transcription,
          has_summary: !!aiSummary,
          sentiment,
        },
        ref_table: 'call_logs',
        ref_id: callLog.id,
      });
    }
  } catch (err) {
    console.error('Recording processing error:', err);
    await supabase
      .from('call_logs')
      .update({ transcription_status: 'failed' })
      .eq('id', callLog.id);
  }

  return NextResponse.json({ success: true });
}
