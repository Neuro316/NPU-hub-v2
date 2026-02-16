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

  if (!recordingUrl) {
    return NextResponse.json({ error: 'No recording URL' }, { status: 400 });
  }

  // Find the most recent call log without a recording
  const { data: callLog } = await supabase
    .from('call_logs')
    .select('*, contacts!inner(org_id)')
    .is('recording_url', null)
    .eq('status', 'completed')
    .order('ended_at', { ascending: false })
    .limit(1)
    .single();

  if (!callLog) {
    return NextResponse.json({ error: 'No matching call log' }, { status: 404 });
  }

  // Store recording URL immediately
  await supabase
    .from('call_logs')
    .update({ recording_url: `${recordingUrl}.mp3` })
    .eq('id', callLog.id);

  const orgId = (callLog as any).contacts?.org_id;

  // Process asynchronously (in production, use a queue)
  // For now, process inline
  try {
    // 1. Transcribe
    const transcription = await transcribeRecording(`${recordingUrl}.mp3`);

    // 2. AI Summary
    const aiSummary = transcription ? await generateCallSummary(transcription, orgId) : null;

    // 3. Sentiment
    const sentiment = transcription ? await analyzeSentiment(transcription, orgId) : null;

    // 4. Update call log
    await supabase
      .from('call_logs')
      .update({
        transcription,
        ai_summary: aiSummary,
        sentiment,
      })
      .eq('id', callLog.id);

    // 5. Extract tasks (store for review — don't auto-create)
    if (transcription) {
      const tasks = await extractTasks(transcription, orgId);
      if (tasks.length > 0 && orgId) {
        // Store extracted tasks in activity log for the review modal to pick up
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

    // 6. Log activity
    if (orgId) {
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
  }

  return NextResponse.json({ success: true });
}
