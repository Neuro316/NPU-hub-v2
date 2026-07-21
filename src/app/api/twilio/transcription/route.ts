import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';

// Twilio built-in transcription callback (from <Record transcribe transcribeCallback>).
// Twilio transcribes its OWN recording (so there is no auth-fetch problem the way
// Deepgram-by-URL had) and POSTs the result here. We write TranscriptionText +
// status onto the call_logs row keyed by CallSid.
//
// This route is the single transcription "seam": to move to a better engine later
// (e.g. Deepgram on downloaded bytes), change what fills transcript /
// transcription_status here — the recording capture and the UI are unchanged.
// Built-in transcription is English-only + best-effort (v1 choice); good enough to
// prove the path, swappable when we want higher accuracy.

export async function POST(request: NextRequest) {
  let params: Record<string, string> = {};
  try {
    const text = await request.text();
    const sp = new URLSearchParams(text);
    sp.forEach((v, k) => { params[k] = v; });
  } catch (e) {
    console.error('transcription parse error:', e);
  }

  const callSid = params.CallSid;
  const twStatus = params.TranscriptionStatus; // 'completed' | 'failed'
  const transcriptText = params.TranscriptionText || '';

  if (!callSid) {
    return NextResponse.json({ error: 'Missing CallSid' }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  const { data: callLog } = await supabase
    .from('call_logs')
    .select('id')
    .eq('external_call_sid', callSid)
    .maybeSingle();

  if (!callLog) {
    console.warn('transcription: no call_log for CallSid', callSid);
    return NextResponse.json({ ok: true, matched: false });
  }

  const completed = twStatus === 'completed';
  await supabase
    .from('call_logs')
    .update({
      transcript: completed ? transcriptText : null,
      transcription_status: completed ? 'completed' : 'failed',
    })
    .eq('id', callLog.id);

  return NextResponse.json({ ok: true });
}
