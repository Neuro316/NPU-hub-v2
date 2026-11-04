import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { getOrgTwilioConfig, fetchTwilioRecording, twilioRecordingUrlFromSid } from '@/lib/twilio-org';
import { planRangeResponse, playbackMediaUrl } from '@/lib/recording-media';

// Per request: auth, then a live fetch from Twilio. Never cached.
export const dynamic = 'force-dynamic';

// Authenticated proxy for Twilio call recordings / voicemails.
// The browser <audio> points HERE, never at the raw Twilio URL: Twilio media
// requires account auth, and exposing it would leak Twilio creds. This route
// enforces a server-side org + staff gate (067-shape: superadmin OR admin/
// facilitator of the OWNING org) and streams the audio using the owning org's
// Twilio credentials, which never reach the client.

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // 1. Must be an authenticated Hub user.
  const supabaseUser = createServerSupabase();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const admin = createAdminSupabase();

  // 2. Load the call row (its owning org + recording pointer).
  //    recording_sid is a fallback for a row that has the SID but no URL: the
  //    maintenance/cleanup-recordings job nulls recording_url after 90 days and
  //    leaves recording_sid in place, and a <Dial> recording callback can land
  //    the SID before the URL. Either pointer is enough to stream the media.
  const { data: callLog } = await admin
    .from('call_logs')
    .select('id, org_id, recording_url, recording_sid')
    .eq('id', params.id)
    .maybeSingle();
  if (!callLog || (!callLog.recording_url && !callLog.recording_sid)) {
    return new NextResponse('Not found', { status: 404 });
  }

  // 3. Server-side org + staff gate — mirrors the 067 RLS shape exactly:
  //    superadmin OR (admin/facilitator AND a member of the owning org).
  //
  //    KNOWN COARSE CHECK, accepted deliberately. The role comes from
  //    profiles.role, which is platform wide and knows nothing about per org
  //    team_profiles grants, so "admin or facilitator of this org" is broader
  //    than the Hub's real authority model. That means anyone profiles.role
  //    calls an admin or facilitator in the owning org can play back a recorded
  //    client call. Narrowing it means rewriting the 067 policy family onto
  //    team_profiles, which needs platform coordination and must not be done as
  //    a side effect of a recording change. Reviewed and kept as is.
  const { data: profile } = await admin
    .from('profiles').select('role').eq('id', user.id).maybeSingle();
  const role = profile?.role ?? '';
  let allowed = role === 'superadmin';
  if (!allowed && (role === 'admin' || role === 'facilitator')) {
    const { data: membership } = await admin
      .from('org_members').select('id')
      .eq('user_id', user.id)
      .eq('organization_id', callLog.org_id)
      .maybeSingle();
    allowed = !!membership;
  }
  if (!allowed) return new NextResponse('Forbidden', { status: 403 });

  // 4. Fetch from Twilio with the OWNING org's creds and stream back. Creds are
  //    used only here on the server; the client only ever sees this proxy URL.
  //    fetchTwilioRecording owns the credential handling so a future
  //    transcription step cannot drift from what plays back here.
  let mediaUrl = callLog.recording_url as string | null;
  if (!mediaUrl && callLog.recording_sid) {
    const config = await getOrgTwilioConfig(admin, callLog.org_id);
    if (!config.account_sid) {
      return new NextResponse('Recording unavailable', { status: 502 });
    }
    mediaUrl = twilioRecordingUrlFromSid(config.account_sid, callLog.recording_sid);
  }
  if (!mediaUrl) return new NextResponse('Not found', { status: 404 });

  // 5. Byte ranges. A browser's <audio> asks for them and Safari will not play
  //    without them (recording-media.ts). Twilio is asked for the same range;
  //    if it sends the whole file instead, the slice is cut here.
  const range = request.headers.get('range');
  const media = await fetchTwilioRecording(callLog.org_id, playbackMediaUrl(mediaUrl), { range });
  if (!media.ok) {
    if (media.reason === 'timeout') return new NextResponse('Recording took too long to load', { status: 504 });
    return new NextResponse(
      media.reason === 'not_configured' ? 'Recording unavailable' : 'Recording fetch failed',
      { status: 502 }
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': media.contentType,
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': 'bytes',
  };

  if (media.status === 206 && media.contentRange) {
    headers['Content-Range'] = media.contentRange;
    if (media.contentLength) headers['Content-Length'] = media.contentLength;
    return new NextResponse(media.body, { status: 206, headers });
  }

  if (range) {
    const bytes = new Uint8Array(await new Response(media.body).arrayBuffer());
    const plan = planRangeResponse(range, bytes.byteLength);
    if (plan.status === 416) return new NextResponse(null, { status: 416, headers: { ...headers, ...plan.headers } });
    if (plan.status === 206) {
      return new NextResponse(bytes.slice(plan.start, plan.end + 1), { status: 206, headers: { ...headers, ...plan.headers } });
    }
    if (bytes.byteLength <= 4 * 1024 * 1024) {
      headers['Content-Length'] = String(bytes.byteLength);
      return new NextResponse(bytes, { status: 200, headers });
    }
    // Too large to send buffered: stream a fresh copy instead.
    const again = await fetchTwilioRecording(callLog.org_id, playbackMediaUrl(mediaUrl));
    if (!again.ok) return new NextResponse('Recording fetch failed', { status: 502 });
    if (again.contentLength) headers['Content-Length'] = again.contentLength;
    return new NextResponse(again.body, { status: 200, headers });
  }

  if (media.contentLength) headers['Content-Length'] = media.contentLength;
  return new NextResponse(media.body, { status: 200, headers });
}
