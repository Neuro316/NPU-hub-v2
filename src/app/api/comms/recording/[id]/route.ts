import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { getOrgTwilioConfig } from '@/lib/twilio-org';

// Authenticated proxy for Twilio call recordings / voicemails.
// The browser <audio> points HERE, never at the raw Twilio URL: Twilio media
// requires account auth, and exposing it would leak Twilio creds. This route
// enforces a server-side org + staff gate (067-shape: superadmin OR admin/
// facilitator of the OWNING org) and streams the audio using the owning org's
// Twilio credentials, which never reach the client.

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  // 1. Must be an authenticated Hub user.
  const supabaseUser = createServerSupabase();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const admin = createAdminSupabase();

  // 2. Load the call row (its owning org + recording URL).
  const { data: callLog } = await admin
    .from('call_logs')
    .select('id, org_id, recording_url')
    .eq('id', params.id)
    .maybeSingle();
  if (!callLog?.recording_url) {
    return new NextResponse('Not found', { status: 404 });
  }

  // 3. Server-side org + staff gate — mirrors the 067 RLS shape exactly:
  //    superadmin OR (admin/facilitator AND a member of the owning org).
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
  const config = await getOrgTwilioConfig(admin, callLog.org_id);
  if (!config.account_sid || !config.auth_token) {
    return new NextResponse('Recording unavailable', { status: 502 });
  }
  const authHeader = 'Basic ' + Buffer.from(`${config.account_sid}:${config.auth_token}`).toString('base64');

  let twilioRes: Response;
  try {
    twilioRes = await fetch(callLog.recording_url, { headers: { Authorization: authHeader } });
  } catch {
    return new NextResponse('Recording fetch failed', { status: 502 });
  }
  if (!twilioRes.ok || !twilioRes.body) {
    return new NextResponse('Recording fetch failed', { status: 502 });
  }

  const headers: Record<string, string> = {
    'Content-Type': twilioRes.headers.get('content-type') || 'audio/mpeg',
    'Cache-Control': 'private, no-store',
  };
  const len = twilioRes.headers.get('content-length');
  if (len) headers['Content-Length'] = len;

  return new NextResponse(twilioRes.body, { status: 200, headers });
}
